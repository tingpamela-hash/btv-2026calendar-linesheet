async page=>{
  const base=new URL(page.url()).origin,contexts=[],tabs=[],errors=[],db=new Map(),locks=new Map(),webhooks=[],writes=[];
  let failWrites=false,failLocks=false;
  let holdNextLock=false,requestWaiting=false,releaseLockRequest;
  let holdWrite=false,writeWaiting=false,releaseWrite;
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const rows=table=>{if(!db.has(table))db.set(table,new Map());return db.get(table);};
  const legacy={id:'legacy',title:'Legacy Sale',startDate:'2026-10-09',endDate:'2026-10-11',markets:['SG']};

  rows('app_state').set('btv-admin-config-v1',{key:'btv-admin-config-v1',value:{stores:[{market:'SG',name:'NAC'},{market:'SG',name:'Jewel'}],categories:['BAGS']}});
  async function open(user,path,canEdit=true){
    const context=await page.context().browser().newContext({timezoneId:'Asia/Singapore'});contexts.push(context);
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url==='https://webhook.example.test/fixture'){webhooks.push(JSON.parse(route.request().postData()));return route.fulfill({contentType:'application/json',body:'{}'});}
      if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient(){throw new Error("Fixture presence unavailable");}};'});
      return url.startsWith(base+'/')?route.continue():route.abort();
    });
    await context.exposeFunction('fixtureQuery',async({table,op,filters,data,single,options})=>{
      if(user==='CA'&&table==='global_cal_entries'&&op==='update'&&holdWrite){holdWrite=false;writeWaiting=true;await new Promise(resolve=>releaseWrite=resolve);writeWaiting=false;}
      const store=rows(table),matched=[...store.values()].filter(row=>Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));
      if(op!=='select'){
        writes.push({user,table,op,data});
        if(['calendar_entries','global_cal_entries','marketing_entries'].includes(table)&&failWrites)return {error:{message:'Fixture write failure'}};
        if(table==='calendar_entries'&&op==='update'&&matched.some(row=>locks.get(row.id)!==user))return {error:{message:'Fixture lock denial'}};
      }
      if(op==='upsert'||op==='insert'){
        for(const row of Array.isArray(data)?data:[data]){
          const key=row.id || row.key || 'audit-'+store.size;
          if(store.has(key)&&options?.ignoreDuplicates)continue;
          if(store.has(key)&&op==='insert')return {error:{code:'23505',message:'Duplicate ID'}};
          store.set(key,structuredClone(row));
        }
        return {data:structuredClone(Array.isArray(data)?data:[data]),error:null};
      }
      if(op==='update'){matched.forEach(row=>store.set(row.id,structuredClone(data)));return {data:matched.length?[structuredClone(data)]:[],error:null};}
      if(op==='delete'){matched.forEach(row=>store.delete(row.id));return {data:structuredClone(matched),error:null};}
      return {data:structuredClone(single?(matched[0] || null):matched),error:null};
    });
    await context.exposeFunction('fixtureNotify',message=>webhooks.push(message));
    await context.exposeFunction('fixtureRpc',async({name,args})=>{
      if(failLocks)return {error:{message:'Fixture lock service unavailable'}};
      if(name==='try_lock_calendar_entry'){
        if(user==='A'&&holdNextLock){holdNextLock=false;requestWaiting=true;await new Promise(resolve=>releaseLockRequest=resolve);requestWaiting=false;}
        if(locks.has(args.p_id)&&locks.get(args.p_id)!==user)return {data:false,error:null};
        locks.set(args.p_id,user);rows('calendar_entries').get(args.p_id).locked_by_email=user+'@example.test';return {data:true,error:null};
      }
      if(name==='refresh_calendar_entry_lock')return {data:locks.get(args.p_id)===user,error:null};
      if(locks.get(args.p_id)===user)locks.delete(args.p_id);return {data:true,error:null};
    });
    const tab=await context.newPage();tabs.push(tab);tab.on('pageerror',e=>errors.push(user+': '+e.message));
    await tab.goto(base+'/btv_calendar_linesheet_files/'+path);
    await tab.evaluate(async({user,canEdit})=>{
      window.confirm=()=>true;window.alert=message=>window.fixtureAlert=message;window.fixtureHandlers={};
      const sb={from(table){
        const q={table,op:'select',filters:{}};
        const b={select(){return b;},eq(key,value){q.filters[key]=value;return b;},in(key,value){q.filters[key]=value;return b;},
          order(){return b;},range(){return b;},limit(){return b;},maybeSingle(){q.single=true;return b;},
          upsert(data,options){q.op='upsert';q.data=data;q.options=options;return b;},insert(data){q.op='insert';q.data=data;return b;},
          update(data){q.op='update';q.data=data;return b;},delete(){q.op='delete';return b;},then(resolve,reject){return fixtureQuery(q).then(resolve,reject);}};return b;
      },rpc(name,args){return fixtureRpc({name,args});},channel(){return {on(type,filter,cb){if(filter.table)(fixtureHandlers[filter.table]||=[]).push(cb);return this;},subscribe(){return this;}};},removeChannel(){}};
      await btvSyncStart({user:{id:user,email:user+'@example.test',user_metadata:{full_name:user+' Test'}}},sb,canEdit,true);
      if(window.btvConfigCalWebhook){window.prompt=()=> 'https://webhook.example.test/fixture';btvConfigCalWebhook();}
    },{user,canEdit});
    if(path.includes('global calendar'))await tab.evaluate(()=>{ccSendMarketingWebhook=(item,changes)=>fixtureNotify({actor:item.updatedBy,changes});});
    return tab;
  }
  async function deliver(row){const table=row.section?'calendar_entries':(row.data.startDateISO?'marketing_entries':'global_cal_entries');for(const tab of tabs)await tab.evaluate(({row,table})=>(fixtureHandlers[table] || []).forEach(cb=>cb({eventType:'UPDATE',new:row,old:{}})),{row,table});}
  try{
    const launch={id:'launch',section:'global',weekId:'2026-10-05',launchTitle:'Original Launch',launchDate:'2026-10-09',workflowStatus:'published',noLaunchMarkets:['TH','ID','PH','JP','CN'],noLaunchChannelsCollapsed:[],lines:[{id:'line',category:'BAGS',productName:'Test Bag',colour:'Blue',size:'One Size',price:'69'}]};
    rows('calendar_entries').set('launch',{id:'launch',section:'global',week_id:'2026-10-05',year:2026,data:launch,updated_at:'2026-10-01T00:00:00.000Z'});
    const content={id:'content',market:'SG',row:'ig_grid',title:'Original Content',week:41,date:'2026-10-09',workflowStatus:'published',status:'Not Started',brief:'Original brief',links:[]};
    rows('global_cal_entries').set('content',{id:'content',market:'SG',data:content,updated_at:'2026-10-01T00:00:00.000Z'});
    const activation={id:'activation',market:'SG',row:'Brand Events',title:'Original Activation',weekId:'2026-10-05',startDateISO:'2026-10-09',startDate:'9-Oct (Fri)',status:'published',objective:'Original objective',images:[],links:[]};
    rows('marketing_entries').set('activation',{id:'activation',market:'SG',data:activation,updated_at:'2026-10-01T00:00:00.000Z'});
    const a=await open('A','input calendar-2026.html'),b=await open('B','input calendar-2026.html');
    await a.evaluate(()=>openEditor('global','2026-10-05','launch'));await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await b.evaluate(()=>openEditor('global','2026-10-05','launch'));await b.waitForFunction(()=>document.getElementById('btv-cal-lock-banner')?.textContent.includes('A@example.test'));
    for(const id of ['confirmBtn','deleteBtn','duplicateBtn','copyToChinaBtn'])if(await b.locator('#'+id).count())assert(await b.locator('#'+id).isDisabled(),'Contested Management control enabled: '+id);
    failWrites=true;await a.fill('#launchTitle','Confirmed Launch');const hookCount=webhooks.length;await a.click('#confirmBtn');
    await a.waitForFunction(()=>document.getElementById('btv-cal-lock-banner')?.textContent.includes('Fixture write failure'));
    assert(await a.inputValue('#launchTitle')==='Confirmed Launch','Failed Management save lost draft');
    assert(rows('calendar_entries').get('launch').data.launchTitle==='Original Launch','Failed Management save changed DB');
    assert(webhooks.length===hookCount,'Failed Management save notified');
    failWrites=false;await a.click('#confirmBtn');await a.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    await b.waitForFunction(()=>!document.getElementById('confirmBtn').disabled,null,{timeout:12000});
    assert(await b.inputValue('#launchTitle')==='Confirmed Launch','Management handover kept stale fields');
    locks.set('launch','A');await b.fill('#launchTitle','Lost lock draft');await b.click('#confirmBtn');
    await b.waitForFunction(()=>document.getElementById('btv-cal-lock-banner')?.textContent.includes('lock was released'));
    assert(await b.locator('#confirmBtn').isDisabled(),'Lost ownership did not disable save');await b.click('#cancelBtn');locks.delete('launch');
    failLocks=true;await a.evaluate(()=>openEditor('global','2026-10-05','launch'));
    await a.waitForFunction(()=>document.getElementById('btv-cal-lock-banner')?.textContent.includes('lock service unavailable'));
    assert(await a.locator('#confirmBtn').isDisabled(),'Lock RPC failure enabled editing');
    await a.click('#cancelBtn');failLocks=false;
    holdNextLock=true;await a.evaluate(()=>openEditor('global','2026-10-05','launch'));
    for(let tries=0;!requestWaiting&&tries<50;tries++)await a.waitForTimeout(20);
    assert(requestWaiting,'Delayed lock did not start');
    await a.click('#cancelBtn');await a.evaluate(()=>openEditor('global','2026-10-05','launch'));
    assert(await a.locator('#confirmBtn').isDisabled(),'Reopen enabled before delayed lock cleanup');
    releaseLockRequest();await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await a.click('#cancelBtn');
    for(let tries=0;locks.has('launch')&&tries<50;tries++)await a.waitForTimeout(20);
    assert(!locks.has('launch'),'Cancelled delayed editor left a lock behind');
    holdNextLock=true;await a.evaluate(()=>openEditor('global','2026-10-05','launch'));
    await a.waitForFunction(()=>document.getElementById('btv-cal-lock-banner')?.textContent.includes('timed out'),null,{timeout:9000});
    assert(await a.locator('#confirmBtn').isDisabled(),'Stalled lock request failed open');
    releaseLockRequest();await a.click('#cancelBtn');
    await a.waitForTimeout(100);locks.delete('launch');
    const same=await open('A','input calendar-2026.html');
    await a.evaluate(()=>openEditor('global','2026-10-05','launch'));await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await same.evaluate(()=>openEditor('global','2026-10-05','launch'));await same.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await a.fill('#launchTitle','Newer same-account launch');await a.click('#confirmBtn');await a.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    await a.waitForTimeout(100);locks.set('launch','A');
    await same.fill('#launchTitle','Stale same-account launch');await same.click('#confirmBtn');
    await same.waitForFunction(()=>document.getElementById('btv-cal-lock-banner')?.textContent.includes('changed or was removed'));
    assert(rows('calendar_entries').get('launch').data.launchTitle==='Newer same-account launch','Same-account stale Management overwrite');
    assert(await same.inputValue('#launchTitle')==='Stale same-account launch','Management conflict lost draft');await same.click('#cancelBtn');
    await a.waitForTimeout(150);
    const imported=await a.evaluate(async()=>{
      const rows=BtvCalendarCSV.parse(BtvCalendarCSV.serialize(window._btvState));
      const date=rows[0].indexOf('Launch Date');
      rows.slice(1).filter(row=>row[0]==='launch').forEach(row=>row[date]='2026-10-10');
      const csv=rows.map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\r\n');
      return _btvCalImportEntries(csv,'CSV');
    });
    assert(imported.updated===1&&!imported.pending&&rows('calendar_entries').get('launch').data.launchDate==='2026-10-10','CSV existing-launch edit failed after conditional-save rollout');
    const ca=await open('CA','global calendar.html?mode=creative'),cb=await open('CB','global calendar.html?mode=creative');
    await ca.evaluate(()=>openEditModal('content','SG'));await cb.evaluate(()=>openEditModal('content','SG'));
    await ca.fill('#fBrief','Authoritative brief');await ca.click('#fSaveBtn');await ca.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));
    const fresh=rows('global_cal_entries').get('content');await deliver(fresh);
    await cb.fill('#fBrief','Stale brief');await cb.click('#fSaveBtn');
    await cb.waitForFunction(()=>document.getElementById('modalErr').textContent.includes('changed or was removed'));
    assert(await cb.inputValue('#fBrief')==='Stale brief','Creative conflict lost draft');
    assert(rows('global_cal_entries').get('content').data.brief==='Authoritative brief','Creative stale save overwrote newer value: '+JSON.stringify(rows('global_cal_entries').get('content')));
    await cb.click('#deleteBtn');await cb.waitForFunction(()=>document.getElementById('modalErr').textContent.includes('changed or was removed'));
    assert(rows('global_cal_entries').has('content'),'Stale delete removed newer content');
    await cb.evaluate(()=>closeModal());await cb.evaluate(()=>openEditModal('content','SG'));
    assert(await cb.inputValue('#fBrief')==='Authoritative brief','Reopen omitted fresh content');
    await cb.fill('#fBrief','Second confirmed brief');await cb.click('#fSaveBtn');await cb.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));
    await ca.evaluate(()=>btvCcRefreshEntries());await ca.evaluate(()=>openEditModal('content','SG'));
    await cb.evaluate(()=>openEditModal('content','SG'));await cb.click('#deleteBtn');await cb.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));
    await ca.fill('#fBrief','Deleted stale draft');await ca.click('#fSaveBtn');
    await ca.waitForFunction(()=>document.getElementById('modalErr').textContent.includes('changed or was removed'));
    assert(!rows('global_cal_entries').has('content'),'Stale update resurrected deleted content');await ca.evaluate(()=>closeModal());
    assert(await ca.evaluate(entry=>btvCcUpsertEntries([entry]),content)===false,'Deleted known ID was treated as a new insert');
    assert(!rows('global_cal_entries').has('content'),'Background stale replay resurrected deleted content');
    for(const [tab,title] of [[ca,'Independent A'],[cb,'Independent B']]){
      await tab.evaluate(()=>openAddModal('SG','ig_grid',41,'2026-10-09'));await tab.fill('#fTitle',title);
    }
    await Promise.all([ca.click('#fSaveBtn'),cb.click('#fSaveBtn')]);
    for(const tab of [ca,cb])await tab.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));
    assert([...rows('global_cal_entries').values()].filter(row=>row.data.title.startsWith('Independent')).length===2,'Independent concurrent records lost data');
    await ca.evaluate(()=>openMarketingViewModal('activation','SG'));await cb.evaluate(()=>openMarketingViewModal('activation','SG'));
    await ca.fill('#mObjective','Confirmed objective');await ca.click('#mSaveBtn');await ca.waitForFunction(()=>!document.getElementById('marketingModal').classList.contains('show'));
    const marketing=rows('marketing_entries').get('activation');await deliver(marketing);
    await cb.fill('#mObjective','Stale objective');const marketingHooks=webhooks.length;await cb.click('#mSaveBtn');
    await cb.waitForFunction(()=>document.getElementById('mModalErr').textContent.includes('changed or was removed'));
    assert(rows('marketing_entries').get('activation').data.objective==='Confirmed objective','Activation stale save overwrote data');
    assert(webhooks.length===marketingHooks,'Conflicting activation notified Teams');
    await cb.screenshot({path:'output/playwright/calendar-conflict-desktop.png'});
    await cb.setViewportSize({width:390,height:844});await cb.locator('#mModalErr').scrollIntoViewIfNeeded();await cb.screenshot({path:'output/playwright/calendar-conflict-mobile.png'});
    assert(await cb.evaluate(()=>document.getElementById('marketingModal').scrollWidth<=innerWidth+1),'Mobile conflict modal overflow');
    assert(await cb.locator('#marketingModal .f-actions').evaluate(el=>Array.from(el.children).every(button=>{const r=button.getBoundingClientRect();return !r.width || r.left>=0&&r.right<=innerWidth;})),'Mobile actions clipped');
    await cb.evaluate(()=>closeMarketingModal());await cb.evaluate(()=>openMarketingViewModal('activation','SG'));
    await cb.fill('#mObjective','Retried objective');failWrites=true;await cb.click('#mSaveBtn');
    await cb.waitForFunction(()=>document.getElementById('mModalErr').textContent.includes('Fixture write failure'));
    assert(await cb.inputValue('#mObjective')==='Retried objective','Failed activation save lost draft');
    assert(rows('marketing_entries').get('activation').data.objective==='Confirmed objective','Failed activation changed DB');
    failWrites=false;await cb.click('#mSaveBtn');await cb.waitForFunction(()=>!document.getElementById('marketingModal').classList.contains('show'));
    assert(rows('marketing_entries').get('activation').data.objective==='Retried objective','Activation retry failed');
    const delayed=[...rows('global_cal_entries').values()].find(row=>row.data.title==='Independent A');
    await cb.evaluate(()=>btvCcRefreshEntries());
    await ca.evaluate(id=>openEditModal(id,'SG'),delayed.id);await cb.evaluate(id=>openEditModal(id,'SG'),delayed.id);
    await ca.fill('#fBrief','Delayed draft');holdWrite=true;await ca.click('#fSaveBtn');
    for(let tries=0;!writeWaiting&&tries<50;tries++)await ca.waitForTimeout(20);
    assert(writeWaiting,'Delayed write did not start');
    await cb.fill('#fBrief','Concurrent winner');await cb.click('#fSaveBtn');await cb.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));
    await deliver(rows('global_cal_entries').get(delayed.id));
    assert(await ca.evaluate(()=>btvCcPendingSaveCount())===1,'Another user realtime falsely confirmed this pending save');
    assert(await ca.evaluate(()=>closeModal())===false,'Close released an in-flight form');
    releaseWrite();await ca.waitForFunction(()=>document.getElementById('modalErr').textContent.includes('changed or was removed'));
    assert(await ca.inputValue('#fBrief')==='Delayed draft','Delayed conflict lost draft');
    assert(rows('global_cal_entries').get(delayed.id).data.brief==='Concurrent winner','Delayed request overwrote winner');await ca.evaluate(()=>closeModal());
    const global=await open('G','global calendar.html');
    const communicationRows=await ca.evaluate(()=>ROW_DEFS.filter(row=>row.group==='communication').map(row=>row.key));
    for(const row of communicationRows){
      const title='Publication fixture '+row;
      await ca.evaluate(row=>openAddModal('SG',row,dateToWeekNum('2026-10-09'),'2026-10-09'),row);
      await ca.fill('#fTitle',title);await ca.selectOption('#fStatus','Approved');await ca.fill('#fBrief','Publication brief');
      await ca.click('#fSaveBtn');await ca.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));
      let saved=[...rows('global_cal_entries').values()].find(entry=>entry.data.title===title);await deliver(saved);
      assert(saved.data.workflowStatus==='draft'&&saved.data.status==='Approved','Draft changed production status');
      assert(await global.locator('#globalTable .chip').filter({hasText:title}).count()===0,'Draft leaked into Global');
      await ca.evaluate(id=>openEditModal(id,'SG'),saved.id);await ca.click('#fPublishBtn');
      await ca.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));
      saved=rows('global_cal_entries').get(saved.id);await deliver(saved);
      assert(saved.data.workflowStatus==='published'&&saved.data.brief==='Publication brief','Publish lost content');
      assert(await global.locator('#globalTable .chip').filter({hasText:title}).count()===1,'Published content missing from Global: '+row);
    }
    const source=[...rows('global_cal_entries').values()].find(row=>row.data.title==='Publication fixture edm');
    await ca.evaluate(id=>openEditModal(id,'SG'),source.id);await ca.click('#duplicateBtn');await ca.selectOption('#dupMarket','TH');
    await ca.locator('#duplicateModal .btn-primary').click();await ca.waitForFunction(()=>!document.getElementById('duplicateModal').classList.contains('show'));
    const duplicate=[...rows('global_cal_entries').values()].find(row=>row.market==='TH'&&row.data.title===source.data.title);
    assert(duplicate&&duplicate.data.brief===source.data.brief&&duplicate.data.workflowStatus==='published','Market duplication lost content/publication');await deliver(duplicate);
    assert(await global.locator('#globalTable .chip').filter({hasText:source.data.title}).count()===1,'Identical market copies split Global summary');
    await ca.evaluate(id=>openEditModal(id,'SG'),source.id);await ca.selectOption('#fPublication','draft');await ca.click('#fSaveBtn');
    await ca.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));await deliver(rows('global_cal_entries').get(source.id));
    assert(await global.locator('#globalTable .chip').filter({hasText:source.data.title}).count()===1,'Unpublishing SG hid published TH copy');
    await ca.evaluate(id=>openEditModal(id,'TH'),duplicate.id);await ca.selectOption('#fPublication','draft');await ca.click('#fSaveBtn');
    await ca.waitForFunction(()=>!document.getElementById('entryModal').classList.contains('show'));await deliver(rows('global_cal_entries').get(duplicate.id));
    assert(await global.locator('#globalTable .chip').filter({hasText:source.data.title}).count()===0,'Unpublished copies remained on Global');
    assert(!writes.some(w=>['global_cal_entries','marketing_entries'].includes(w.table)&&w.op==='upsert'),'Creative unconditional upsert remains');
    assert(!errors.length,errors.join(';'));
    return {passed:true,checks:['Management lock denial, failed/stalled RPC closed','cancelled delayed lock and immediate reopen','confirmed save and failed-draft retention','fresh Management handover','lost ownership protection','same-account stale Management CAS','editable CSV existing-launch update','Creative and Activation stale save/delete protection','realtime cannot confirm another users pending save','deleted rows cannot resurrect from forms/background replay','independent simultaneous creates','confirmed-only notifications','retry after failure','publication across all communication rows','market duplication merges Global summary','per-market unpublish','desktop/mobile action layout'],backend:'mocked; production requests blocked'};
  }finally{for(const context of contexts)await context.close();}
}
