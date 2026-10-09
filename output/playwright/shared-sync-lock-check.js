async page => {
  const base=new URL(page.url()).origin, contexts=[], tabs=[], db=new Map(), locks=new Map();
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const rows=table=>{if(!db.has(table))db.set(table,new Map());return db.get(table);};
  const checks=[], rejectedWrites=[],webhooks=[];
  async function open(user,path){
    const context=await page.context().browser().newContext(); contexts.push(context);
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url==='https://webhook.example.test/fixture'){webhooks.push(JSON.parse(route.request().postData()));return route.fulfill({contentType:'application/json',body:'{}'});}
      if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:function(){throw new Error("Mock presence unavailable");}};'});
      return url.startsWith(base+'/') ? route.continue() : route.abort();
    });
    await context.exposeFunction('fixtureQuery',async ({table,filters,op,data,single})=>{
      if(table==='app_state'){
        if(user==='B')throw new Error('Mock app_state network failure');
        return {data:null,error:{message:'Mock app_state denied'}};
      }
      if(table==='linesheet_product_locks'){
        if(Array.isArray(filters.group_id))return {data:filters.group_id.filter(id=>locks.has(id)).map(id=>({group_id:id,locked_by:locks.get(id),locked_at:new Date().toISOString()})),error:null};
        return {data:locks.has(filters.group_id)?{locked_by_email:locks.get(filters.group_id)+'@example.test'}:null,error:null};
      }
      const store=rows(table);
      if(op==='insert'){
        const inserted=[];
        for(const row of Array.isArray(data)?data:[data]){
          const id=table==='change_log'?'audit-'+store.size:row.id;
          if(store.has(id))return {error:{code:'23505',message:'Duplicate ID'}};
          const saved={...structuredClone(row),id};store.set(id,saved);inserted.push(saved);
        }
        return {data:structuredClone(inserted),error:null};
      }
      if(op==='upsert'){
        if(table==='linesheet_products' && data.some(row=>locks.has(row.group_id)&&locks.get(row.group_id)!==user)) {
          rejectedWrites.push({user,ids:data.map(row=>row.id)});
          return {error:{code:'42501',message:'This product is locked by another user (fixture@example.test).'}};
        }
        if(table==='linesheet_products'&&user==='L1')await new Promise(resolve=>setTimeout(resolve,750));data.forEach(row=>store.set(row.id,structuredClone(row)));return {error:null};
      }
      const selected=[...store.values()].filter(row=>Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));
      if(op==='update'){selected.forEach(row=>store.set(row.id,structuredClone(data)));return {data:selected.map(()=>structuredClone(data)),error:null};}
      if(op==='delete'){selected.forEach(row=>store.delete(row.id));return {data:structuredClone(selected),error:null};}
      return {data:single?(selected[0]||null):structuredClone(selected),error:null};
    });
    await context.exposeFunction('fixtureRpc',({name,args})=>{
      const id=args.p_group_id || args.p_id;
      if(name==='try_lock_calendar_entry'){
        if(locks.has(id)&&locks.get(id)!==user)return {data:false,error:null};
        locks.set(id,user);return {data:true,error:null};
      }
      if(name==='unlock_calendar_entry'&&locks.get(id)===user)locks.delete(id);
      if(name==='refresh_calendar_entry_lock')return {data:locks.get(id)===user,error:null};
      if(name==='try_lock_linesheet_group'){
        if(locks.has(id)&&locks.get(id)!==user)return {data:false,error:null};
        locks.set(id,user);return {data:true,error:null};
      }
      if(name==='refresh_linesheet_group_lock')return {data:locks.get(id)===user,error:null};
      if(name==='unlock_linesheet_group'&&locks.get(id)===user)locks.delete(id);
      return {data:true,error:null};
    });
    const tab=await context.newPage();tabs.push(tab);
    tab.on('pageerror',error=>checks.push(user+' page error: '+error.message));
    await tab.goto(base+'/btv_calendar_linesheet_files/'+path);
    await tab.evaluate(async user=>{
      window.confirm=()=>true;window.alert=msg=>{window.fixtureAlert=msg;};window.fixtureHandlers={};
      const sb={
        from(table){
          const q={table,filters:{},op:'select'};
          const b={select(){return b;},order(){return b;},range(){return b;},eq(key,value){q.filters[key]=value;return b;},in(key,value){q.filters[key]=value;return b;},limit(){return b;},maybeSingle(){q.single=true;return b;},insert(data){q.op='insert';q.data=data;return b;},upsert(data){q.op='upsert';q.data=data;return b;},update(data){q.op='update';q.data=data;return b;},delete(){q.op='delete';return b;},then(resolve,reject){return window.fixtureQuery(q).then(resolve,reject);}};return b;
        },
        rpc(name,args){return window.fixtureRpc({name,args});},
        channel(){return {on(type,filter,cb){if(filter.table)(window.fixtureHandlers[filter.table]||=[]).push(cb);return this;},subscribe(){return this;},unsubscribe(){}};}
      };
      await btvSyncStart({user:{id:user,email:user+'@example.test',user_metadata:{full_name:user+' Test'}}},sb,true,true);
    },user);
    return tab;
  }
  try {
    const a=await open('A','input calendar-2026.html'), b=await open('B','input calendar-2026.html');
    const c=await open('C','global calendar.html?mode=creative'), d=await open('D','global calendar.html?mode=creative');
    assert(await a.evaluate(()=>!!fixtureHandlers.calendar_entries),'Management row sync blocked by app_state error');
    assert(await c.evaluate(()=>!!fixtureHandlers.global_cal_entries && !!fixtureHandlers.marketing_entries),'Creative row sync blocked by app_state error');
    const launch={id:'fixture-launch',launchTitle:'Shared launch fixture',launchDate:'2026-10-07',markets:['SG'],workflowStatus:'published',lines:[]};
    await a.evaluate(launch=>btvCalUpsertEntries([{section:'global',weekId:'2026-10-05',entry:launch}]),launch);
    const row=rows('calendar_entries').get(launch.id);
    assert(row?.year===2026,'Management save did not persist its year');
    await b.evaluate(row=>fixtureHandlers.calendar_entries.forEach(cb=>cb({eventType:'INSERT',new:row,old:{}})),row);
    assert(await b.evaluate(()=>localStorage.getItem('calendar-2026-working-v5').includes('Shared launch fixture')),'Management realtime not applied');
    await c.evaluate(row=>fixtureHandlers.calendar_entries.forEach(cb=>cb({eventType:'INSERT',new:row,old:{}})),row);
    await c.waitForFunction(()=>JSON.stringify(loadBtvCalState()).includes('Shared launch fixture'));
    assert((await c.locator('body').textContent()).includes('Shared launch fixture'),'Management launch bridge did not render in Creative');
    checks.push('Management save, second-user realtime, Creative launch bridge, app_state failure isolation');
    row.data.lines=[{productName:'Move fixture',category:'BAGS',colour:'Black',size:'One Size',price:'69'}];
    row.data.noLaunchMarkets=['CN','ID','JP','PH','TH'];
    await a.evaluate(row=>{
      window.prompt=()=> 'https://webhook.example.test/fixture';btvConfigCalWebhook();
      row.data.lines=[{productName:'Move fixture',category:'BAGS',colour:'Black',size:'One Size',price:'69'}];
      row.data.noLaunchMarkets=['CN','ID','JP','PH','TH'];
      fixtureHandlers.calendar_entries.forEach(cb=>cb({eventType:'UPDATE',new:row,old:{}}));
      openEditor('global','2026-10-05','fixture-launch',{targetWeek:'2026-10-19'});
    },row);
    await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    assert(await a.inputValue('#launchDate')==='2026-10-21','Drag draft lost original weekday');
    assert(await a.evaluate(()=>JSON.parse(localStorage.getItem('calendar-2026-working-v5')).global['2026-10-05'][0].launchDate)==='2026-10-07','Drag changed source before Confirm');
    const beforeCancel=webhooks.length;
    await a.click('#cancelBtn');await a.waitForTimeout(500);
    assert(webhooks.length===beforeCancel,'Cancelled drag sent webhook');
    await b.evaluate(()=>openEditor('global','2026-10-05','fixture-launch'));
    await b.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await a.evaluate(()=>openEditor('global','2026-10-05','fixture-launch',{targetWeek:'2026-10-19'}));
    await a.waitForFunction(()=>document.getElementById('btv-cal-lock-banner'));
    assert(await a.locator('#confirmBtn').isDisabled(),'Locked drag could be confirmed');
    await a.click('#cancelBtn');await b.click('#cancelBtn');
    await a.evaluate(()=>{
      const entry=document.querySelector('.entry[data-entry-id="fixture-launch"]');
      const target=document.querySelector('.drop-zone[data-drop-section="global"][data-drop-week="2026-10-18"]') || document.querySelector('.drop-zone[data-drop-section="global"][data-drop-week="2026-10-19"]');
      const transfer=new DataTransfer();
      entry.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    });
    await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    assert(await a.inputValue('#launchDate')==='2026-10-21','Real drag treated UTC-shifted week key as Monday');
    await a.fill('#launchDate','2026-10-20');await a.click('#confirmBtn');
    await a.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    await a.waitForTimeout(800);
    assert(await a.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('calendar-2026-working-v5')).global).flat().find(e=>e.id==='fixture-launch').launchDate)==='2026-10-20','Confirmed move used wrong date');
    assert(JSON.stringify(webhooks).includes('2026-10-07')&&JSON.stringify(webhooks).includes('2026-10-20'),'Webhook omitted original or chosen date');
    assert(!JSON.stringify(webhooks).includes('2026-10-19'),'Webhook fabricated Monday as original date');
    checks.push('Draft move cancel leaves source intact; Confirm webhook uses original date, not target Monday');
    await a.evaluate(()=>openEditor('store_openings','2026-10-05'));
    await a.selectOption('#storeType','popup');await a.selectOption('#storeMarket','SG');
    await a.fill('#storeName','Fixture pop-up');await a.fill('#storeAddress','123 Fixture Street');
    await a.fill('#targetOpenDate','2026-10-09');await a.fill('#storeClosingDate','2026-10-08');
    await a.click('#confirmBtn');assert(await a.locator('#btv-modal-err').isVisible(),'Invalid closing date accepted');
    await a.fill('#storeClosingDate','2026-11-01');await a.click('#confirmBtn');
    await a.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    await a.waitForTimeout(400);
    const storeRow=[...rows('calendar_entries').values()].find(r=>r.section==='store_openings');
    assert(storeRow?.data.storeType==='popup'&&storeRow.data.storeAddress==='123 Fixture Street','Store fields not shared');
    await b.evaluate(row=>fixtureHandlers.calendar_entries.forEach(cb=>cb({eventType:'INSERT',new:row,old:{}})),storeRow);
    assert(await b.evaluate(()=>localStorage.getItem('calendar-2026-working-v5').includes('Fixture pop-up')),'Store missing on second computer');
    await c.evaluate(row=>fixtureHandlers.calendar_entries.forEach(cb=>cb({eventType:'INSERT',new:row,old:{}})),storeRow);
    await c.waitForFunction(()=>document.body.textContent.includes('Fixture pop-up'));
    assert((await c.locator('body').textContent()).includes('Fixture pop-up'),'Store missing in Creative bridge');
    await a.evaluate(()=>{const entry=Object.values(JSON.parse(localStorage.getItem('calendar-2026-working-v5')).store_openings).flat()[0];openEditor('store_openings',entry.weekId,entry.id);});
    await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    assert(await a.inputValue('#storeClosingDate')==='2026-11-01','Popup closing date failed to reload');
    await a.selectOption('#storeType','permanent');
    assert(!await a.locator('#storeClosingField').isVisible(),'Permanent store still shows closing field');
    await a.click('#confirmBtn');await a.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    assert(await a.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('calendar-2026-working-v5')).store_openings).flat()[0].closingDate)==='','Permanent store retained closing date');
    await a.setViewportSize({width:390,height:844});
    await a.evaluate(()=>{const entry=Object.values(JSON.parse(localStorage.getItem('calendar-2026-working-v5')).store_openings).flat()[0];openEditor('store_openings',entry.weekId,entry.id);});
    await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await a.screenshot({path:'output/playwright/store-opening-mobile.png'});await a.click('#cancelBtn');
    await a.setViewportSize({width:1440,height:1000});
    checks.push('Store validation, popup save, second-user sync, Creative bridge, reopening, permanent closing cleanup, mobile form');
    await a.waitForTimeout(800);webhooks.length=0;
    const event={id:'fixture-creative',market:'SG',row:'edm',title:'Shared creative fixture',date:'2026-10-07',weekId:'2026-10-05',status:'draft'};
    await c.evaluate(event=>btvCcUpsertEntries([event]),event);
    await d.evaluate(row=>fixtureHandlers.global_cal_entries.forEach(cb=>cb({eventType:'INSERT',new:row,old:{}})),rows('global_cal_entries').get(event.id));
    assert(await d.evaluate(()=>JSON.stringify(state).includes('Shared creative fixture')),'Creative realtime not applied');
    const marketing={...event,id:'fixture-marketing',row:'Brand Events',title:'Shared marketing fixture',startDateISO:'2026-10-07',endDateISO:'2026-10-07'};
    await c.evaluate(event=>btvMktUpsertEntries([event]),marketing);
    await d.evaluate(row=>fixtureHandlers.marketing_entries.forEach(cb=>cb({eventType:'INSERT',new:row,old:{}})),rows('marketing_entries').get(marketing.id));
    assert(await d.evaluate(()=>JSON.stringify(marketingState).includes('Shared marketing fixture')),'Marketing realtime not applied');
    assert((await d.locator('body').textContent()).includes('Shared marketing fixture'),'Shared marketing event did not render in Creative');
    checks.push('Creative and marketing saves reach an independent browser session');
    rows('calendar_entries').get(launch.id).data.launchTitle='Missed realtime recovered';
    rows('global_cal_entries').get(event.id).data.title='Creative missed realtime recovered';
    await b.waitForFunction(()=>localStorage.getItem('calendar-2026-working-v5').includes('Missed realtime recovered'),null,{timeout:25000});
    await d.waitForFunction(()=>JSON.stringify(state).includes('Creative missed realtime recovered'),null,{timeout:25000});
    await c.waitForFunction(()=>JSON.stringify(loadBtvCalState()).includes('Missed realtime recovered'),null,{timeout:25000});
    rows('calendar_entries').clear();rows('global_cal_entries').clear();rows('marketing_entries').clear();
    await b.waitForFunction(()=>!localStorage.getItem('calendar-2026-working-v5').includes('fixture-launch'),null,{timeout:25000});
    await d.waitForFunction(()=>!JSON.stringify(state).includes('fixture-creative')&&!JSON.stringify(marketingState).includes('fixture-marketing'),null,{timeout:25000});
    checks.push('Missed realtime recovery and authoritative empty snapshots');
    ['S','M'].forEach(size=>rows('linesheet_products').set('lock-'+size,{id:'lock-'+size,group_id:'lock-group',data:{id:'lock-'+size,groupId:'lock-group',name:'Lock fixture',variant:'Black',size,sizing:'S,M',variantFormId:'black-form',variantLocalId:'black-form::'+size.toLowerCase(),category:'BAGS',sgd:'69',sku:'',barcode:'',sizeSKUs:{[size]:''},sizeBarcodes:{[size]:''}}}));
    for(const row of rows('linesheet_products').values())row.data.measurementMatrix=[{point:'Chest',values:[{size:'S',cm:'38',inch:'15'},{size:'M',cm:'40',inch:'16'}]}];
    const l1=await open('L1','linesheet.html'), l2=await open('L2','linesheet.html');
    for(const tab of [l1,l2])await tab.evaluate(()=>{
      BTV_LS_WEBHOOK_URL='https://webhook.example.test/fixture';
      renderMaster();editGroup('lock-group');
    });
    await l1.waitForFunction(()=>_btvLsHeldLockId==='lock-group'&&!window._btvLsHardLockBlocked);
    await l2.waitForFunction(()=>document.getElementById('btv-ls-hardlock-banner'));
    await l2.evaluate(async()=>{
      window.fixtureAlert=null;
      const before=structuredClone(products),after=products.map(p=>({...p,sku:'STALE',sgd:'123'}));
      await _btvDiffAndSyncProducts(before,after);
      if(fixtureAlert || btvLsPendingCount())throw new Error('Locked background reconciliation produced an alert or replay queue');
      const lookup=window.btvLsActiveGroupLocks;
      window.btvLsActiveGroupLocks=async()=>new Set();
      try {
        const result=await btvLsUpsertProducts(after,{background:true});
        if(result!==false || fixtureAlert || btvLsPendingCount())throw new Error('Background lock race was retried or queued');
      } finally {window.btvLsActiveGroupLocks=lookup;}
    });
    assert(rejectedWrites.length===1,'Background lock race did not stop after one rejected write');
    assert(rows('linesheet_products').get('lock-S').data.sku==='','Locked background write changed shared data');
    await l2.evaluate(async()=>{
      const result=await btvLsUpsertProducts(products.map(p=>({...p,sku:'REJECTED'})));
      if(result!==false || btvLsPendingCount() || !fixtureAlert.includes('currently locked') || fixtureAlert.includes('migration.sql'))throw new Error('Manual conflict was queued or misdiagnosed');
      btvLsRetryPending();
    });
    assert(rejectedWrites.length===2,'Manual lock rejection was retried');
    checks.push('Locked background reconciliation is deferred; server lock races stop immediately without alerts or stale pending replay');
    assert(await l2.locator('#f_description').isDisabled(),'Second user can edit a locked product');
    await l2.evaluate(()=>{window.btvGetOnlineUsers=()=>[];_btvLsApplyFieldLocks('lock-group');});
    assert(await l2.locator('#f_description').isDisabled(),'Presence unlocked denied editor');
    await l2.screenshot({path:'output/playwright/shared-lock-desktop.png'});
    await l2.setViewportSize({width:390,height:844});
    await l2.screenshot({path:'output/playwright/shared-lock-mobile.png'});
    await l2.evaluate(()=>saveProductGroup());
    assert(await l2.evaluate(()=>!!fixtureAlert),'Direct save bypassed the lock');
    await l1.locator('.sku-input[data-size="S"]').fill('SAVED-S');
    await l1.locator('.sku-input[data-size="M"]').fill('SAVED-M');
    await l1.locator('.barcode-input[data-size="S"]').fill('001-S');
    await l1.locator('.barcode-input[data-size="M"]').fill('002-M');
    await l1.locator('#f_description').fill('Latest shared description');
    await l1.locator('#f_fabric').fill('Cotton');
    await l1.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
      const ctx=canvas.getContext('2d');
      for(let i=0;i<4096;i++){ctx.fillStyle='rgb('+(i*37%256)+','+(i*71%256)+','+(i*113%256)+')';ctx.fillRect(i%64,Math.floor(i/64),1,1);}
      const image=canvas.toDataURL('image/png');
      if(image.length<=512)throw new Error('Image fixture must exercise previous stripping threshold');
      document.querySelector('.variant-product-data').value=image;
      document.querySelector('.variant-lookbook-data').value=image;
      document.querySelector('#measurementTable .measure-label').value='Chest refreshed';
      _btvSetDirty(true);
    });
    for(const input of await l1.locator('[data-approval-role]').all())await input.check();
    await l1.evaluate(()=>saveProductGroup());
    assert(rows('linesheet_products').get('lock-S').data.generalApprovals.sc.actorName==='L1 Test' && rows('linesheet_products').get('lock-M').data.variantApprovals.sc.approved,'New scoped approvals were not saved for every size');
    assert(rows('linesheet_products').get('lock-S').data.lastEditedBy.name==='L1 Test','Product did not retain editor identity');
    await l1.waitForTimeout(300);
    assert(webhooks.length===1 && webhooks[0].message.includes('L1 Test') && webhooks[0].message.includes('L1@example.test') && webhooks[0].message.includes('SAVED-M'),'Webhook lacks editor or size-specific changes');
    assert(rows('change_log').size>0,'Confirmed save did not write shared audit entries');
    assert(rows('linesheet_products').get('lock-S').data.productImg.length>512,'Save stripped uploaded product image');
    // Deliberately deliver no row events: waiting view must read the shared group.
    await l2.waitForFunction(()=>document.querySelector('.sku-input[data-size="S"]').value==='SAVED-S',null,{timeout:15000});
    assert(await l2.locator('.barcode-input[data-size="M"]').inputValue()==='002-M','Live waiting form did not refresh colour size codes');
    assert(await l2.locator('#f_description').inputValue()==='Latest shared description','Live waiting form did not refresh general fields');
    assert(await l2.locator('.variant-product-data').inputValue()===rows('linesheet_products').get('lock-S').data.productImg,'Product image did not sync to waiting user');
    assert(await l2.locator('.variant-lookbook-data').inputValue()===rows('linesheet_products').get('lock-S').data.lookbookImg,'Lookbook image did not sync to waiting user');
    assert(await l2.locator('#measurementTable .measure-label').first().inputValue()==='Chest refreshed','Measurement table did not refresh');
    assert(await l2.locator('#generalApprovalControls input:checked').count()===3 && await l2.locator('.variant-card [data-approval-role]:checked').count()===3,'Waiting user did not receive scoped approvals');
    assert(await l2.locator('.variant-product-box img').evaluate(img=>img.complete && img.naturalWidth>0),'Synced product image did not render');
    await l2.locator('.variant-product-box').scrollIntoViewIfNeeded();
    await l2.screenshot({path:'output/playwright/linesheet-live-variant-mobile.png'});
    assert(await l2.locator('.sku-input[data-size="S"]').isDisabled() && locks.get('lock-group')==='L1','Live refresh unlocked waiting editor');
    checks.push('Without realtime row delivery, waiting product reads fresh SKUs, barcodes, product/lookbook images and measurements while remaining locked');
    await l1.evaluate(()=>{document.querySelector('.variant-product-data').value='';document.querySelector('.variant-lookbook-data').value='';_btvSetDirty(true);});
    await l1.evaluate(()=>saveProductGroup());
    await l2.waitForFunction(()=>document.querySelector('.variant-product-data').value==='' && document.querySelector('.variant-lookbook-data').value==='',null,{timeout:15000});
    assert(await l2.locator('.variant-product-box img').count()===0,'Removed image reappeared from local cache');
    assert(await l2.locator('.variant-card [data-approval-role]:checked').count()===0 && await l2.locator('#generalApprovalControls input:checked').count()===3,'Image change did not refresh only variant approval');
    checks.push('Image removals synchronize without restoring stale cached images');
    await l1.locator('#f_washcare').fill('Initial care');
    await l1.evaluate(()=>{window.fixtureSave=saveProductGroup();});
    await l1.waitForFunction(()=>window._btvLsSaving);
    await l1.evaluate(()=>switchView('master'));
    assert(await l1.evaluate(()=>window._btvCurrentGroupId==='lock-group'),'Lock released before save completed');
    await l1.evaluate(()=>btvSyncPause());
    assert(locks.get('lock-group')==='L1','Switching app tabs released the lock during save');
    await l1.evaluate(()=>window.fixtureSave);
    assert(rows('linesheet_products').get('lock-S').data.sku==='SAVED-S','First save lost scalar SKU');
    assert(await l1.evaluate(()=>window._btvCurrentGroupId===null),'Leaving the Linesheet tab did not close the saved product');
    await l2.waitForFunction(()=>_btvLsHeldLockId==='lock-group'&&!window._btvLsHardLockBlocked);
    checks.push('Waiting editor acquired released lock');
    assert(!await l2.locator('#f_description').isDisabled(),'Waiting editor did not unlock after acquiring ownership');
    assert(await l2.locator('.sku-input[data-size="S"]').inputValue()==='SAVED-S','Waiting editor retained stale S SKU');
    assert(await l2.locator('.sku-input[data-size="M"]').inputValue()==='SAVED-M','Waiting editor retained stale M SKU');
    assert(await l2.locator('.barcode-input[data-size="M"]').inputValue()==='002-M','Waiting editor retained stale barcode');
    assert(await l2.locator('#f_description').inputValue()==='Latest shared description','Shared description stale after handover');
    await l2.locator('#f_washcare').fill('Cold wash');
    await l2.evaluate(()=>saveProductGroup());
    for(const size of ['S','M'])assert(rows('linesheet_products').get('lock-'+size).data.sku==='SAVED-'+size,'Second save erased SKU '+size);
    await l2.evaluate(()=>{window.fixtureRealSave=btvLsUpsertProducts;window.btvLsUpsertProducts=async()=>false;});
    const auditBeforeFailure=rows('change_log').size,webhooksBeforeFailure=webhooks.length;
    await l2.locator('#f_fabric').fill('Unconfirmed draft');
    for(const row of rows('linesheet_products').values())await l2.evaluate(row=>fixtureHandlers.linesheet_products.forEach(cb=>cb({eventType:'UPDATE',new:row,old:{id:row.id}})),row);
    await l2.waitForTimeout(400);
    assert(await l2.locator('#f_fabric').inputValue()==='Unconfirmed draft','Live refresh replaced an active draft');
    await l2.evaluate(()=>saveProductGroup());
    assert(rows('change_log').size===auditBeforeFailure && webhooks.length===webhooksBeforeFailure,'Failed save wrote audit entries or sent a notification');
    assert(await l2.evaluate(()=>_btvFormDirty && _btvLsHeldLockId==='lock-group'),'Failed save marked the editor clean or released ownership');
    assert(rows('linesheet_products').get('lock-S').data.fabric==='Cotton','Failed save changed shared product');
    await l2.evaluate(()=>{window.btvLsUpsertProducts=window.fixtureRealSave;window.confirm=()=>false;});
    await l2.locator('#btv-product-back').evaluate(button=>button.click());
    await l2.waitForTimeout(200);
    assert(await l2.evaluate(()=>window._btvCurrentGroupId==='lock-group'),'Failed save did not retain unsaved-change protection');
    checks.push('Declined Back retains dirty draft');
    await l2.locator('#f_fabric').fill('Cotton');
    await l2.evaluate(()=>saveProductGroup());
    await l2.evaluate(()=>{window.confirm=()=>true;});
    await l2.getByRole('button',{name:'Back',exact:true}).click();
    await l2.waitForFunction(()=>document.getElementById('view-master').classList.contains('active'));
    assert(await l2.locator('#view-master').evaluate(el=>el.classList.contains('active')),'Back did not return to Master Data');
    await l2.evaluate(()=>editGroup('lock-group'));
    await l2.waitForFunction(()=>_btvLsHeldLockId==='lock-group'&&!window._btvLsHardLockBlocked);
    checks.push('Save completion gates exit; missed-realtime lock handover reloads sizes, SKUs, barcodes and shared fields; second save retains codes');
    const previewEntry={id:'preview-entry',launchTitle:'Launch preview fixture',launchDate:'2026-10-07',lines:[{productName:'Lock fixture',colour:'Black',size:'S,M',category:'BAGS',price:'69'}],workflowStatus:'published'};
    rows('calendar_entries').set(previewEntry.id,{id:previewEntry.id,year:2026,section:'global',week_id:'2026-10-05',data:previewEntry});
    await c.evaluate(async()=>btvCcRefreshBridgeForYear());
    await c.waitForFunction(()=>JSON.stringify(loadBtvCalState()).includes('preview-entry'));
    const g=await open('G','global calendar.html');
    for(const tab of [c,g]){
      await tab.evaluate(async()=>{localStorage.setItem('btv_linesheet_products','[]');await btvShowLaunchDetail('preview-entry');});
      assert(await tab.locator('#btvLDBody .btv-ld-card').count()===1,'Preview did not merge product name/colour sizes into one card');
      const text=await tab.locator('#btvLDBody').innerText();
      for(const code of ['SAVED-S','SAVED-M','001-S','002-M'])assert(text.includes(code),'Preview omitted '+code);
      const measurements=await tab.locator('.btv-ld-measurewrap').innerText();
      for(const value of ['Chest','38','40'])assert(measurements.includes(value),'Preview omitted measurement '+value);
      assert(await tab.locator('.btv-ld-sku tbody tr').count()===2,'Preview did not show one row per size');
      await tab.screenshot({path:'output/playwright/launch-preview-desktop.png'});
      await tab.setViewportSize({width:390,height:844});
      assert(await tab.evaluate(()=>{const o=document.getElementById('btvLDOverlay');return o.scrollWidth<=o.clientWidth+1;}),'Mobile preview overflows');
      await tab.screenshot({path:'output/playwright/launch-preview-mobile.png'});
      await tab.locator('.btv-ld-sku').scrollIntoViewIfNeeded();
      await tab.screenshot({path:'output/playwright/launch-preview-mobile-codes.png'});
    }
    checks.push('Global and Creative launch previews read fresh shared products, group name/colour into one card, and show each size SKU/barcode on desktop/mobile');
    locks.set('lock-group','L1');
    await l2.evaluate(()=>_btvLsRefreshHeldLock('lock-group'));
    await l2.waitForFunction(()=>window._btvLsHardLockBlocked);
    assert(await l2.locator('#f_description').isDisabled(),'Lost ownership left editor enabled');
    await l2.evaluate(async()=>{_btvLsStopLockTimers();window._btvSb.rpc=async()=>({error:{message:'RPC missing'}});const r=await _btvLsAcquireLock('x');if(r.acquired)throw new Error('RPC error failed open');});
    await l2.evaluate(()=>{
      window._btvSb.rpc=()=>new Promise(resolve=>window.fixtureResolveLock=resolve);
      _btvLsOpenWithHardLock('lock-group');window.btvGetOnlineUsers=()=>[];_btvLsApplyFieldLocks('lock-group');
    });
    assert(await l2.locator('#f_description').isDisabled(),'Presence unlocked a pending lock request');
    await l2.evaluate(()=>fixtureResolveLock({data:false,error:null}));
    await l2.evaluate(()=>{
      _btvLsStopLockTimers();_btvSetDirty(false);
      window._btvSb.rpc=async()=>({data:true,error:null});
      window.fixtureFrom=window._btvSb.from;
      window._btvSb.from=()=>({select(){return this;},eq(){return Promise.resolve({data:null,error:{message:'Mock read denied'}});}});
      _btvLsOpenWithHardLock('lock-group');
    });
    await l2.waitForFunction(()=>document.getElementById('btv-ls-hardlock-banner').textContent.includes('latest shared product'));
    assert(await l2.locator('#f_description').isDisabled(),'Failed handover fetch enabled stale editing');
    await l2.evaluate(()=>{_btvLsStopLockTimers();window._btvSb.from=window.fixtureFrom;});
    const e=await open('E','linesheet.html');
    await e.evaluate(()=>{
      localStorage.setItem('linesheetCalendarData',JSON.stringify([{productName:'Lock fixture',colour:'Black',size:'S,M',calColourId:'fixture-colour',calLineId:'fixture-line',calEntryId:'fixture-entry',category:'BAGS',sgdRrp:'99',launchDate:'2026-10-10'}]));
      loadFromCalendar(false);
    });
    assert(rows('linesheet_products').get('lock-S').data.sgd==='69','Deferred calendar metadata overwrote the active editor');
    locks.delete('lock-group');
    await e.waitForFunction(async()=>{
      const result=await fixtureQuery({table:'linesheet_products',filters:{id:'lock-S'}});
      return result.data[0]?.data.sgd==='99';
    },null,{timeout:30000});
    assert(rows('linesheet_products').get('lock-S').data.sku==='SAVED-S' && rows('linesheet_products').get('lock-M').data.sku==='SAVED-M','Deferred reconciliation replayed stale size codes');
    checks.push('Deferred calendar metadata rebuilds from fresh shared rows after unlock and retains both size codes');
    await e.evaluate(async()=>{
      const from=window._btvSb.from,calls=[];
      window._btvSb.from=table=>table==='linesheet_products'?{upsert:async rows=>{calls.push(rows);return {error:null};}}:from(table);
      try {
        const image='data:image/png;base64,'+'A'.repeat(600000);
        const result=await btvLsUpsertProducts([0,1].map(n=>({id:'byte-fixture-'+n,groupId:'byte-fixture',productImg:image,lookbookImg:''})));
        if(!result || calls.length!==2 || calls.some(chunk=>chunk.length!==1 || chunk[0].data.productImg!==image))throw new Error('Byte-limited image batches stripped data or exceeded the combined batch target');
      } finally {window._btvSb.from=from;}
    });
    checks.push('Large image-bearing saves use byte-limited batches and retain complete image data');
    checks.push('Two-user lock denial, presence cannot unlock, direct-save guard, lost ownership, RPC failure');
    assert(!checks.some(s=>s.includes('page error:')),'Unexpected browser errors: '+checks.filter(s=>s.includes('page error:')).join(';'));
    await page.evaluate(checks=>window.__sharedSyncResults={passed:true,checks,backend:'mocked; no production writes'},checks);
    return {passed:true,checks};
  } catch(error) {
    const states=[];
    for(const tab of tabs)if(!tab.isClosed() && tab.url().includes('linesheet.html'))states.push(await tab.evaluate(()=>({gid:window._btvCurrentGroupId,held:_btvLsHeldLockId,saving:window._btvLsSaving,checking:window._btvLsSaveChecking,dirty:_btvFormDirty,alert:window.fixtureAlert,confirm:String(window.confirm),views:Array.from(document.querySelectorAll('.view.active')).map(el=>el.id)})));
    throw new Error(error.message+'; completed checks: '+checks.join(' | ')+'; forms: '+JSON.stringify(states));
  } finally {for(const context of contexts)await context.close();}
}
