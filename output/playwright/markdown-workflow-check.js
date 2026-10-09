async page=>{
  const base=new URL(page.url()).origin,contexts=[],tabs=[],errors=[],db=new Map(),locks=new Map(),webhooks=[],writes=[];
  let failWrites=false,failLocks=false;
  let holdNextLock=false,requestWaiting=false,releaseLockRequest;
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const rows=table=>{if(!db.has(table))db.set(table,new Map());return db.get(table);};
  const legacy={id:'legacy',title:'Legacy Sale',startDate:'2026-10-09',endDate:'2026-10-11',markets:['SG']};
  rows('app_state').set('calendar-2026-markdown-bars-v1',{key:'calendar-2026-markdown-bars-v1',value:{legacy},updated_at:'2026-10-01T00:00:00.000Z'});
  rows('app_state').set('btv-admin-config-v1',{key:'btv-admin-config-v1',value:{stores:[{market:'SG',name:'NAC'},{market:'SG',name:'Jewel'}],categories:['BAGS']}});
  async function open(user,path,canEdit=true){
    const context=await page.context().browser().newContext({timezoneId:'Asia/Singapore'});contexts.push(context);
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url==='https://webhook.example.test/fixture'){webhooks.push(JSON.parse(route.request().postData()));return route.fulfill({contentType:'application/json',body:'{}'});}
      if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient(){throw new Error("Fixture presence unavailable");}};'});
      return url.startsWith(base+'/')?route.continue():route.abort();
    });
    await context.exposeFunction('fixtureQuery',({table,op,filters,data,single,options})=>{
      const store=rows(table),matched=[...store.values()].filter(row=>Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));
      if(op!=='select'){
        writes.push({user,table,op,data});
        if(table==='calendar_entries'&&failWrites)return {error:{message:'Fixture write failure'}};
        if(table==='calendar_entries'&&op==='update'&&matched.some(row=>locks.get(row.id)!==user))return {error:{message:'Fixture lock denial'}};
      }
      if(op==='upsert'||op==='insert'){
        for(const row of Array.isArray(data)?data:[data]){
          const key=row.id || row.key || 'audit-'+store.size;
          if(store.has(key)&&options?.ignoreDuplicates)continue;
          if(store.has(key)&&op==='insert')return {error:{message:'Duplicate ID'}};
          store.set(key,structuredClone(row));
        }
        return {data:structuredClone(Array.isArray(data)?data:[data]),error:null};
      }
      if(op==='update'){matched.forEach(row=>store.set(row.id,structuredClone(data)));return {data:matched.length?[structuredClone(data)]:[],error:null};}
      if(op==='delete'){matched.forEach(row=>store.delete(row.id));return {error:null};}
      return {data:structuredClone(single?(matched[0] || null):matched),error:null};
    });
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
    return tab;
  }
  async function deliver(row){for(const tab of tabs)await tab.evaluate(row=>fixtureHandlers.calendar_entries.forEach(cb=>cb({eventType:'UPDATE',new:row,old:{}})),row);}
  try{
    const a=await open('A','input calendar-2026.html'),b=await open('B','input calendar-2026.html');
    const global=await open('G','global calendar.html?mode=global',false),creative=await open('C','global calendar.html?mode=creative',false);
    assert(await a.evaluate(()=>btvMarkdownLoadLocal().legacy.title)==='Legacy Sale','Legacy markdown missing');
    await a.evaluate(()=>openMarkdownEditor());await a.click('#confirmBtn');
    assert((await a.locator('#btv-md-status').innerText()).includes('Title'),'Missing title did not validate');
    await a.fill('#mdTitle','New Sale');await a.fill('#mdStartDate','2026-10-09');await a.fill('#mdEndDate','2026-10-11');
    await a.check('input[name="mdMarkets"][value="SG"]');await a.uncheck('.md-all-stores');await a.check('.md-store[value="NAC"]');
    await a.click('#confirmBtn');await a.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    const created=[...rows('calendar_entries').values()].find(row=>row.data.title==='New Sale');
    assert(created?.data.days===3&&created.data.weekendDays===2,'Duration calculations wrong');assert(created.data.stores.SG[0]==='NAC','Store not saved');
    await deliver(created);
    for(const tab of [b,global,creative])await tab.waitForFunction(()=>Object.values(btvMarkdownLoadLocal()).some(md=>md.title==='New Sale'));
    await global.evaluate(id=>openMarkdownSummary(id),created.data.id);
    assert((await global.locator('#vm-body').innerText()).includes('SG: NAC'),'Global summary omitted store');
    assert((await global.locator('#vm-body').innerText()).includes('A Test'),'Summary omitted actor');
    await a.waitForTimeout(650);assert(JSON.stringify(webhooks).includes('A Test'),'Webhook omitted actor');
    await a.evaluate(()=>openMarkdownEditor('legacy'));await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await b.evaluate(()=>openMarkdownEditor('legacy'));await b.waitForFunction(()=>document.getElementById('btv-md-status')?.textContent.includes('A@example.test'));
    assert(await b.locator('#confirmBtn').isDisabled(),'Second editor got lock');
    assert(await b.locator('#deleteBtn').isDisabled(),'Locked user could delete');
    await a.fill('#mdTitle','Updated Legacy');
    const before=webhooks.length;failWrites=true;await a.click('#confirmBtn');
    await a.waitForFunction(()=>document.getElementById('btv-md-status')?.textContent.includes('Fixture write failure'));
    assert(await a.inputValue('#mdTitle')==='Updated Legacy','Failed save discarded draft');
    assert(webhooks.length===before,'Failed save notified Teams');
    assert(rows('calendar_entries').get('markdown::2026::legacy').data.title==='Legacy Sale','Failed save changed shared record');
    failWrites=false;await a.click('#confirmBtn');await a.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    await b.waitForFunction(()=>!document.getElementById('confirmBtn').disabled,{},{timeout:12000});
    assert(await b.inputValue('#mdTitle')==='Updated Legacy','Handover did not load fresh data');
    await b.screenshot({path:'output/playwright/markdown-desktop.png'});
    await b.setViewportSize({width:390,height:844});await b.screenshot({path:'output/playwright/markdown-mobile.png'});
    assert(await b.evaluate(()=>document.getElementById('modal').scrollWidth<=innerWidth+1),'Mobile modal overflow');
    await b.click('#duplicateBtn');await b.fill('#mdTitle','Duplicate Sale');await b.click('#confirmBtn');
    await b.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    assert([...rows('calendar_entries').values()].some(row=>row.data.title==='Duplicate Sale'),'Duplicate did not save independently');
    assert(rows('calendar_entries').get('markdown::2026::legacy').data.title==='Updated Legacy','Duplicate changed source');
    await b.evaluate(()=>openMarkdownEditor('legacy'));await b.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await b.click('#deleteBtn');await b.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    const deleted=rows('calendar_entries').get('markdown::2026::legacy');assert(deleted.data.deleted,'Deletion lacks tombstone');
    await deliver(deleted);
    assert(await global.evaluate(()=>btvMarkdownLoadLocal().legacy===undefined),'Deleted legacy markdown resurrected');
    await b.evaluate(()=>btvMarkdownReload());assert(await b.evaluate(()=>btvMarkdownLoadLocal().legacy===undefined),'Reload resurrected legacy');
    assert(rows('app_state').get('calendar-2026-markdown-bars-v1').value.legacy.title==='Legacy Sale','Legacy backup overwritten');
    await deliver({...created,updated_at:'2026-01-01T00:00:00.000Z',data:{...created.data,title:'Stale Sale'}});
    assert(await a.evaluate(id=>btvMarkdownLoadLocal()[id].title,created.data.id)==='New Sale','Delayed event overwrote newer cache');
    await a.evaluate(id=>openMarkdownEditor(id),created.data.id);await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await a.fill('#mdTitle','Unsaved year-switch draft');
    await a.evaluate(()=>{window.confirm=()=>false;switchCalYear(2027);});
    assert(await a.evaluate(()=>CAL_YEAR)===2026,'Cancelled year change lost draft');
    assert(await a.inputValue('#mdTitle')==='Unsaved year-switch draft','Cancelled year change replaced draft');
    await a.evaluate(()=>{window.confirm=()=>true;switchCalYear(2027);});
    assert(await a.evaluate(()=>CAL_YEAR===2027&&!document.getElementById('modal').classList.contains('show')),'Year change kept old edit session');
    for(let tries=0;locks.has(created.id)&&tries<50;tries++)await a.waitForTimeout(20);
    assert(!locks.has(created.id),'Year change did not release lock');
    await a.evaluate(()=>switchCalYear(2026));await a.evaluate(()=>btvMarkdownReload());
    await a.evaluate(id=>openMarkdownEditor(id),created.data.id);await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    await a.evaluate(()=>{document.getElementById('cancelBtn').click();openMarkdownEditor(Object.values(btvMarkdownLoadLocal()).find(md=>md.title==='New Sale').id);});
    await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    assert(locks.get(created.id)==='A','Immediate reopen lost lock');await a.click('#cancelBtn');
    holdNextLock=true;await a.evaluate(id=>openMarkdownEditor(id),created.data.id);
    for(let tries=0;!requestWaiting&&tries<50;tries++)await a.waitForTimeout(20);
    assert(requestWaiting,'Pending lock fixture did not start');
    await a.evaluate(()=>{document.getElementById('cancelBtn').click();openMarkdownEditor(Object.values(btvMarkdownLoadLocal()).find(md=>md.title==='New Sale').id);});
    releaseLockRequest();await a.waitForFunction(()=>!document.getElementById('confirmBtn').disabled);
    assert(locks.get(created.id)==='A','Cancelled pending acquisition released a newer editor lock');await a.click('#cancelBtn');
    failLocks=true;await a.evaluate(id=>openMarkdownEditor(id),created.data.id);
    await a.waitForFunction(()=>document.getElementById('btv-md-status')?.textContent.includes('lock service unavailable'));
    assert(await a.locator('#confirmBtn').isDisabled(),'Unavailable lock service failed open');await a.click('#cancelBtn');failLocks=false;
    const viewer=await open('V','input calendar-2026.html',false);await viewer.evaluate(()=>openMarkdownEditor());
    assert(await viewer.evaluate(()=>fixtureAlert.includes('permission')),'Viewer could open editor');
    assert(!writes.some(w=>w.table==='app_state'&&[].concat(w.data || []).some(row=>/^calendar-\d+-markdown-bars-v1$/.test(row.key || ''))),'Whole-year markdown blob was written');
    assert([...rows('change_log').values()].some(row=>row.key?.startsWith('markdown:')),'Confirmed changes missing from shared audit');
    assert(!errors.length,errors.join(';'));
    return {passed:true,checks:['legacy compatibility','stores and date validation','individual-row saves','Global/Creative and second-user refresh','actor notifications','lock denial and fresh handover','failed-save draft retention','duplicate and tombstone deletion','year-switch draft guard and lock release','immediate reopen ownership','stale event rejection','lock failure closed','viewer denied','no legacy blob writes','shared audit','desktop/mobile']};
  }finally{for(const context of contexts)await context.close();}
}
