(function(){
  'use strict';
  let _sb=null,_uid=null,_active=false,_writer=null,_catchupTimer,_calBridgeDebounce,_catchupBusy=false,_sequence=0;
  const _channels=[],_versions={global_cal_entries:new Map(),marketing_entries:new Map()},_seen={global_cal_entries:new Set(),marketing_entries:new Set()},_pending=new Map();
  const copy=value=>JSON.parse(JSON.stringify(value));
  const key=(table,id)=>table+':'+id;
  const currentUser=()=>window.btvGetCurrentActor();
  function _showCcBar(message){
    const form=document.getElementById('entryModal')?.classList.contains('show')?'modalErr':document.getElementById('marketingModal')?.classList.contains('show')?'mModalErr':null;
    if(form){document.getElementById(form).textContent=message;return;}
    let bar=document.getElementById('btv-cc-write-fail-bar');
    if(!bar){
      bar=document.createElement('div');bar.id='btv-cc-write-fail-bar';
      bar.style.cssText='position:fixed;bottom:16px;left:50%;transform:translateX(-50%);max-width:90vw;background:#a22b2b;color:#fff;padding:10px 16px;border-radius:6px;z-index:9999;display:flex;align-items:center;gap:12px;font-size:12px';
      const text=document.createElement('span');text.id='btv-cc-write-fail-msg';bar.append(text);
      const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>_pending.size?window.btvCcRetryPending():window.btvCcClearNotice();bar.append(retry);document.body.append(bar);
    }
    document.getElementById('btv-cc-write-fail-msg').textContent=message;bar.style.display='flex';
  }
  function _hideCcBar(){const bar=document.getElementById('btv-cc-write-fail-bar');if(bar && !_pending.size)bar.style.display='none';}
  window.btvCcClearNotice=function(){const bar=document.getElementById('btv-cc-write-fail-bar');if(bar)bar.style.display='none';};
  function persist(table){
    _ccApplyingRemote=true;
    try{
      if(table==='global_cal_entries'){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));_prevStateJson=JSON.stringify(state);}
      else{localStorage.setItem(MARKETING_STORAGE_KEY,JSON.stringify(marketingState));_prevMktStateJson=JSON.stringify(marketingState);}
    }finally{_ccApplyingRemote=false;}
  }
  function apply(table,row,id){
    _seen[table].add(id);
    const previous=_versions[table].get(id);
    if(row && previous && Date.parse(previous.updated_at)>Date.parse(row.updated_at))return;
    if(row)_versions[table].set(id,copy(row));else _versions[table].delete(id);
    const target=table==='global_cal_entries'?state:marketingState;
    Object.keys(target).forEach(m=>{if(Array.isArray(target[m]))target[m]=target[m].filter(entry=>entry.id!==id);});
    if(row){target[row.market]=target[row.market] || [];target[row.market].unshift({...row.data,id:row.id,market:row.market});}
    persist(table);
  }
  window.btvCcBaseline=(table,id)=>_versions[table]?.has(id)?copy(_versions[table].get(id)):undefined;
  window.btvCcApplyPendingToState=function(){};
  window.btvCcPendingSaveCount=()=>_pending.size;
  window.btvCcWriteBusy=()=>Array.from(_pending.values()).some(item=>item.busy);
  window.btvCcCommit=async function(table,entry,baseline,remove){
    if(!_active || !_writer || !_uid || CC_IS_GLOBAL_VIEW || window._btvCanEdit!==true)throw new Error('Reconnect with Creative edit permission before saving.');
    const id=key(table,entry.id),signature=JSON.stringify({entry,baseline:baseline?.updated_at,remove:!!remove});
    let pending=_pending.get(id);
    if(pending?.busy)throw new Error('This entry is still saving.');
    if(!pending || pending.signature!==signature){
      pending={attempt:_writer.prepare(table,entry,baseline,remove),signature,busy:false};
      _pending.set(id,pending);
    }
    pending.busy=true;
    const actorId=_uid;
    try{
      const row=await _writer.commit(pending.attempt);
      if(!_active || actorId!==_uid)throw new Error('The active session changed. Reopen the calendar to load the confirmed result.');
      _sequence++;apply(table,row,entry.id);_pending.delete(id);_hideCcBar();
      if(window.btvRender)window.btvRender();
      return row;
    }catch(error){
      pending.error=error;_showCcBar(error.message);
      if(error.code==='conflict')_pending.delete(id);
      throw error;
    }finally{pending.busy=false;}
  };
  window.btvCcForgetDraft=function(table,id){if(!_pending.get(key(table,id))?.busy){_pending.delete(key(table,id));_hideCcBar();}};
  window.btvCcRetryPending=async function(){
    // Open forms own their drafts and must not be saved by an unrelated background retry.
    if(document.getElementById('entryModal')?.classList.contains('show') || document.getElementById('marketingModal')?.classList.contains('show')){
      _showCcBar('Your draft remains open. Retry using its Save button, or close and reopen after a conflict.');return;
    }
    for(const pending of Array.from(_pending.values())){
      if(pending.busy)continue;
      const attempt=pending.attempt;
      try{await window.btvCcCommit(attempt.table,attempt.row.data,attempt.baseline,attempt.remove);}catch(_){}
    }
  };
  async function batch(table,entries,remove){
    let ok=true;
    for(const entry of entries){
      const baseline=window.btvCcBaseline(table,entry.id);
      try{await window.btvCcCommit(table,entry,baseline || (remove || _seen[table].has(entry.id)?undefined:null),remove);}catch(_){ok=false;}
    }
    if(!ok)await _fetchAll();
    return ok;
  }
  window.btvCcUpsertEntries=entries=>batch('global_cal_entries',entries,false);
  window.btvMktUpsertEntries=entries=>batch('marketing_entries',entries,false);
  window.btvCcDeleteEntries=ids=>batch('global_cal_entries',ids.map(id=>({id,market:window.btvCcBaseline('global_cal_entries',id)?.market})),true);
  window.btvMktDeleteEntries=ids=>batch('marketing_entries',ids.map(id=>({id,market:window.btvCcBaseline('marketing_entries',id)?.market})),true);
  window.addEventListener('beforeunload',event=>{if(_pending.size){event.preventDefault();event.returnValue='';}});

  async function _refreshCalEntriesBridge(){
    if (!_sb) return;
    // Scoped to the currently viewed year — BTV_CAL_STORAGE_KEY is itself
    // year-scoped (see _ccApplyYearKeys), so this keeps the two consistent.
    // Switching years (switchCcYear) calls this again with the new year already
    // applied.
    var yr = window.CC_YEAR || new Date().getFullYear();
    var res = await window.btvReadWithTimeout(_sb.from('calendar_entries').select('section,week_id,data').eq('year', yr),'Management launches');
    if (res.error) {
      console.error('[BTV Cal Bridge] calendar_entries fetch error:', res.error.message);
      _showCcBar('Could not load Management launches. Check the shared database connection and calendar year migration, then reload.');
      return;
    }
    if (yr !== (window.CC_YEAR || new Date().getFullYear())) return;
    var blob = {};
    (res.data || []).forEach(function(row){
      if(row.section === 'markdown')return;
      blob[row.section] = blob[row.section] || {};
      (blob[row.section][row.week_id] = blob[row.section][row.week_id] || []).push(row.data);
    });
    var snapshot = JSON.stringify(blob);
    if (localStorage.getItem(BTV_CAL_STORAGE_KEY) === snapshot) return;
    localStorage.setItem(BTV_CAL_STORAGE_KEY, snapshot);
    if (typeof window.btvRender === 'function') window.btvRender();
  }

  // Debounced — a burst of individual entry saves in Input Calendar (per-field webhook
  // saves fire per keystroke-equivalent) would otherwise trigger a full refetch each time.
  function _scheduleCalEntriesBridgeRefresh(){
    clearTimeout(_calBridgeDebounce);
    _calBridgeDebounce = setTimeout(_refreshCalEntriesBridge, 600);
  }

  // Called by switchCcYear() (outside this IIFE) after CC_YEAR/BTV_CAL_STORAGE_KEY
  // have already been updated — refetches immediately rather than waiting on the
  // debounce, since this is a deliberate year switch, not a burst of saves.
  window.btvCcRefreshBridgeForYear = function(){ _refreshCalEntriesBridge(); window.btvMarkdownReload(); };

  // Lets pushMarketingToBtvCalendar (outside this IIFE) persist its synthetic "events"
  // entry through calendar_entries too, instead of only this browser's localStorage —
  // otherwise the next bridge refresh above would silently wipe it back out, and no
  // other device would ever see the link. Always deletes first (covers unpublish and
  // re-publish-to-a-different-week, since the id is fixed but week_id can change), then
  // re-inserts only if entryData is given.
  window.btvPushMarketingEventEntry = async function(entryId, weekId, entryData){
    if (!_sb) return;
    try {
      await _sb.from('calendar_entries').delete().eq('id', entryId);
      if (entryData) {
        // year is derived from the week's own date, not window.CC_YEAR — the
        // entry belongs to whatever year its actual week falls in, regardless
        // of which year happens to be selected on screen right now.
        var yr = (weekId && parseInt(String(weekId).slice(0, 4), 10)) || window.CC_YEAR || new Date().getFullYear();
        await _sb.from('calendar_entries').upsert([{
          id: entryId, section: 'events', week_id: weekId, data: entryData, year: yr,
          updated_at: new Date().toISOString(), updated_by: _uid
        }], { onConflict: 'id' });
      }
    } catch(e) { console.error('[BTV Cal Bridge] push marketing event failed:', e); }
  };


  async function _fetchAll(){
    if(!_active || !_sb)return;
    const token=++_sequence,yr=window.CC_YEAR,user=_uid;
    const snapshot=[];
    for(const table of ['global_cal_entries','marketing_entries']){
      const res=await window.btvReadWithTimeout(_sb.from(table).select('id,market,data,updated_at,updated_by'),'Shared calendar entries');
      if(!_active || token!==_sequence || yr!==window.CC_YEAR || user!==_uid)return;
      if(res.error){_showCcBar('Could not refresh '+(table==='marketing_entries'?'marketing':'Creative')+' entries. Existing data is retained.');continue;}
      snapshot.push([table,res.data || []]);
    }
    if(!_active || token!==_sequence || yr!==window.CC_YEAR || user!==_uid)return;
    let changed=false;
    for(const [table,rows] of snapshot){
      const target=table==='global_cal_entries'?state:marketingState,next={};
      rows.forEach(row=>{(next[row.market] ||= []).push({...row.data,id:row.id,market:row.market});});
      changed=changed || JSON.stringify(target)!==JSON.stringify(next);
      _versions[table].clear();rows.forEach(row=>{_versions[table].set(row.id,copy(row));_seen[table].add(row.id);});
      Object.keys(target).forEach(m=>delete target[m]);Object.assign(target,next);persist(table);
    }
    if(changed && window.btvRender)window.btvRender();
  }
  function realtime(table,payload){
    if(!_active)return;_sequence++;
    if(payload.eventType==='DELETE'){
      // A late delete may belong to an older incarnation of this ID. Re-read authoritative state.
      _fetchAll();return;
    }
    const row=payload.new;if(!row?.id)return;
    apply(table,row,row.id);
    // Another user's update is never confirmation of this user's pending attempt.
    if(window.btvRender)window.btvRender();
  }
  window.btvCcEntriesInit=async function(session){
    if(!window._btvSb)return;
    if(_uid && _uid!==session.user.id){_pending.clear();Object.values(_versions).forEach(map=>map.clear());Object.values(_seen).forEach(set=>set.clear());}
    _sb=window._btvSb;_uid=session.user.id;_active=true;
    _writer=BtvCalendarRecords.createClient({sb:_sb,actor:currentUser,canEdit:()=>_active && !CC_IS_GLOBAL_VIEW && window._btvCanEdit===true});
    await _fetchAll();if(!_active)return;await _refreshCalEntriesBridge();if(!_active)return;
    if(!_channels.length)for(const table of ['global_cal_entries','marketing_entries','calendar_entries']){
      try{
        _channels.push(_sb.channel('btv_safe_'+table).on('postgres_changes',{event:'*',schema:'public',table},
          payload=>table==='calendar_entries'?_scheduleCalEntriesBridgeRefresh():realtime(table,payload)).subscribe());
      }catch(error){console.warn('[BTV Calendar] Realtime unavailable:',error.message);}
    }
    clearInterval(_catchupTimer);_catchupTimer=setInterval(async()=>{
      if(_catchupBusy || document.hidden)return;_catchupBusy=true;
      try{await _fetchAll();await _refreshCalEntriesBridge();}finally{_catchupBusy=false;}
    },15000);
  };
  window.btvCcRefreshEntries=_fetchAll;
  window.btvCcEntriesTeardown=function(){
    _active=false;_sequence++;clearInterval(_catchupTimer);clearTimeout(_calBridgeDebounce);
    _channels.splice(0).forEach(channel=>{try{channel.unsubscribe();}catch(_){}});
  };
  window.addEventListener('online',()=>_fetchAll());
})();
