(function(){
  let channel,timer,sequence=0,active=false,busy=false;
  const year=()=>window.CAL_YEAR || window.CC_YEAR || new Date().getFullYear();
  const notify=()=>{if(window.btvMarkdownOnChange)window.btvMarkdownOnChange();else if(window.btvRender)window.btvRender();};
  window.btvMarkdownCacheRow=function(row){
    const key=BtvMarkdown.cacheKey(row.year);
    let rows;try{rows=JSON.parse(localStorage.getItem(key)) || [];}catch(_){rows=[];}
    const previous=rows.find(r=>r.id===row.id);
    if(previous && Date.parse(previous.updated_at)>Date.parse(row.updated_at))return;
    if(previous?.updated_at===row.updated_at && JSON.stringify(previous.data)===JSON.stringify(row.data))return;
    sequence++;
    localStorage.setItem(key,JSON.stringify(rows.filter(r=>r.id!==row.id).concat(row)));
    if(row.year===year())notify();
  };
  window.btvMarkdownLoadLocal=function(){
    try{return BtvMarkdown.merge(JSON.parse(localStorage.getItem(BtvMarkdown.legacyKey(year()))) || {},
      JSON.parse(localStorage.getItem(BtvMarkdown.cacheKey(year()))) || []);}catch(_){return {};}
  };
  window.btvMarkdownReload=async function(){
    if(!active || !window.btvMarkdownClient)return;
    const requestedYear=year(),token=++sequence;
    try{
      const snapshot=await window.btvMarkdownClient.read(requestedYear);
      if(!active || token!==sequence || requestedYear!==year())return;
      const legacyKey=BtvMarkdown.legacyKey(requestedYear),rowsKey=BtvMarkdown.cacheKey(requestedYear);
      const legacy=JSON.stringify(snapshot.legacy),rows=JSON.stringify(snapshot.rows);
      const changed=localStorage.getItem(legacyKey)!==legacy || localStorage.getItem(rowsKey)!==rows;
      localStorage.setItem(legacyKey,legacy);localStorage.setItem(rowsKey,rows);
      if(changed)notify();
    }catch(error){console.warn('[BTV Markdown] Shared read failed:',error.message);}
  };
  window.btvMarkdownInit=async function(){
    active=true;
    window.btvMarkdownClient=BtvMarkdown.createClient({sb:window._btvSb,actor:()=>window.btvGetCurrentActor(),
      canEdit:()=>active && window._btvCanEdit===true && decodeURIComponent(window.location.pathname).includes('input calendar')});
    await window.btvMarkdownReload();
    if(!active)return;
    if(!channel){try{channel=window._btvSb.channel('btv_markdown_rows_v1').on('postgres_changes',
      {event:'*',schema:'public',table:'calendar_entries'},payload=>{
        const row=payload.new;
        if(row?.section==='markdown' && row.year===year())window.btvMarkdownCacheRow(row);
        else if(payload.eventType==='DELETE')window.btvMarkdownReload();
      }).subscribe();}catch(error){console.warn('[BTV Markdown] Realtime unavailable:',error.message);}}
    clearInterval(timer);timer=setInterval(async()=>{
      if(busy || document.hidden)return;busy=true;
      try{await window.btvMarkdownReload();}finally{busy=false;}
    },15000);
  };
  window.btvMarkdownTeardown=function(){
    active=false;sequence++;clearInterval(timer);
    if(channel){try{window._btvSb.removeChannel(channel);}catch(_){}channel=null;}
    if(window.btvMarkdownSuspendEditor)window.btvMarkdownSuspendEditor();
  };
  window.addEventListener('online',()=>window.btvMarkdownReload());
})();
