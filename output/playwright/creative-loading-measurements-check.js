async page=>{
  const base=new URL(page.url()).origin,contexts=[],errors=[];
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  try{
    for(const mode of ['creative','global']){
      const context=await page.context().browser().newContext();contexts.push(context);
      await context.route('**/*',route=>{
        const url=route.request().url();
        if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient(){throw new Error("Fixture presence unavailable");}};'});
        return url.startsWith(base+'/')?route.continue():route.abort();
      });
      const tab=await context.newPage();tab.on('pageerror',e=>errors.push(e.message));
      await tab.goto(base+'/btv_calendar_linesheet_files/global%20calendar.html?mode='+mode);
      const started=Date.now();
      await tab.evaluate(async mode=>{
        const data=[{id:'S',group_id:'fixture',data:{id:'S',groupId:'fixture',name:'Measured Shirt',variant:'Blue',size:'S',sku:'S-CODE',measurementMatrix:[]}},{id:'M',group_id:'fixture',data:{id:'M',groupId:'fixture',name:'Measured Shirt',variant:'Blue',size:'M',sku:'M-CODE',measurementMatrix:[{point:'Chest',tolerance:0,values:{S:{inch:'18',cm:'45.72'},M:{inch:'20',cm:'50.8'}}}]}}];
        const entry={id:'measure-launch',launchTitle:'Measured Launch',launchDate:'2026-10-07',markets:['SG'],lines:[{productName:'Measured Shirt',colour:'Blue',size:'S,M'}]};
        window.fixtureCalls=[];
        const sb={from(table){
          const b={select(){return b;},in(){return b;},eq(){return b;},order(){return b;},range(){return b;},upsert(){return Promise.resolve({error:null});},then(resolve,reject){
            fixtureCalls.push(table);
            if(table==='app_state' && mode==='creative')return new Promise(()=>{});
            if(table==='global_cal_entries')return Promise.reject(new Error('Fixture Creative read failure')).then(resolve,reject);
            const value=table==='marketing_entries'?[{id:'event',market:'SG',data:{id:'event',row:'Brand Events',status:'published',title:'Marketing still loads',startDateISO:'2026-10-07',endDateISO:'2026-10-07'}}]:table==='linesheet_products'?data:table==='calendar_entries'?[{section:'global',week_id:'2026-10-05',data:entry}]:[];
            return Promise.resolve({data:value,error:null}).then(resolve,reject);
          }};return b;
        },channel(){return {on(){return this;},subscribe(){return this;},unsubscribe(){}};}};
        await btvSyncStart({user:{id:'fixture',email:'fixture@example.test'}},sb,true,true);
      },mode);
      assert(Date.now()-started<20000,'Settings read stalled calendar startup');
      assert(await tab.locator('.view-panel.active tbody tr').count()>0,'Calendar did not render');
      assert(await tab.locator('.view-panel.active').innerText().then(text=>text.includes('Marketing still loads')),'Failed Creative read prevented Marketing loading');
      await tab.evaluate(()=>btvShowLaunchDetail('measure-launch'));
      assert(await tab.locator('#btvLDBody .btv-ld-card').count()===1,'Preview split sizes');
      const text=await tab.locator('.btv-ld-measurewrap').innerText();
      for(const value of ['Chest','S','M','45.72cm','50.8cm'])assert(text.includes(value),mode+' measurement omitted '+value);
      assert(await tab.locator('.btv-ld-measuretable tbody tr').count()===2,'Sizes are not rows');
      await tab.locator('.btv-ld-unit input').check();
      assert((await tab.locator('.btv-ld-measurewrap').innerText()).includes('18in'),'IN toggle failed');
      await tab.locator('.btv-ld-unit input').uncheck();
      assert((await tab.locator('.btv-ld-tolerance').innerText()).includes('Chest: 0'),'Tolerance lost');
      await tab.screenshot({path:'output/playwright/'+mode+'-measurements-desktop.png'});
      await tab.setViewportSize({width:390,height:844});
      assert(await tab.evaluate(()=>document.getElementById('btvLDOverlay').scrollWidth<=innerWidth+1),'Mobile preview overflow');
      await tab.locator('.btv-ld-measurewrap').scrollIntoViewIfNeeded();
      await tab.screenshot({path:'output/playwright/'+mode+'-measurements-mobile.png'});
      await tab.evaluate(async()=>{
        const st=loadBtvCalState(),entry=Object.values(st.global).flat().find(e=>e.id==='measure-launch');
        entry.lines.unshift({productName:'Zebra Bag',colour:'Cherry'});
        localStorage.setItem(BTV_CAL_STORAGE_KEY,JSON.stringify(st));
        const original=window._btvSb.from;
        window._btvSb.from=function(table){
          const query=original.call(this,table);
          if(table==='linesheet_products'){
            const then=query.then;
            query.then=(resolve,reject)=>then(result=>{result.data.push({id:'Z',data:{id:'Z',name:'Zebra Bag',variant:'Cherry',size:'One Size',sku:'Z-CODE'}});return resolve(result);},reject);
          }
          return query;
        };
        await btvShowLaunchDetail('measure-launch');
      });
      const names=await tab.locator('.btv-ld-pname').allTextContents();
      assert(names[0].includes('Zebra Bag')&&names[1].includes('Measured Shirt'),'Cards ignored management product order');
    }
    assert(!errors.length,errors.join(';'));
    return {passed:true,checks:['stalled settings timeout','Creative read failure does not block Marketing','Global/Creative launch measurements including legacy maps','empty first row recovery','desktop/mobile preview']};
  }finally{for(const context of contexts)await context.close();}
}
