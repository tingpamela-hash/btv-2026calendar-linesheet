(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./calendar-csv'));
  else root.BtvCalendarRecords=factory(root.BtvCalendarCSV);
})(typeof globalThis==='undefined'?this:globalThis,function(csv){
  'use strict';
  const TABLES=new Set(['global_cal_entries','marketing_entries','calendar_entries']);
  const clone=value=>JSON.parse(JSON.stringify(value));
  function conflict(){return Object.assign(new Error('This entry changed or was removed after you opened it. Your draft is kept. Close and reopen the entry to review the latest saved information.'),{code:'conflict'});}
  function createClient(options){
    function user(){
      const actor=options.actor();
      if(!actor?.id || options.canEdit()!==true)throw new Error('Reconnect with calendar edit permission before saving.');
      return actor;
    }
    async function request(query){
      let timer;
      try{
        const result=await Promise.race([query,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shared request timed out. Your draft is kept; reconnect and retry.')),options.timeout || 10000);})]);
        if(result.error)throw Object.assign(new Error(result.error.message || 'Shared request failed.'),{code:result.error.code});
        return result.data;
      }finally{clearTimeout(timer);}
    }
    function table(name){if(!TABLES.has(name))throw new Error('Unsupported calendar table.');return options.sb.from(name);}
    const read=(name,id)=>request(table(name).select(name==='calendar_entries'?'id,section,week_id,year,data,updated_at,updated_by':'id,market,data,updated_at,updated_by').eq('id',id).maybeSingle());
    function prepare(name,entry,baseline,remove){
      const actor=user();table(name);
      const management=name==='calendar_entries';
      if(!entry?.id || (!management && !entry.market) || (management && (!entry.section || entry.section==='markdown' || !entry.weekId)))throw new Error('Missing entry identity or calendar location.');
      if(baseline===undefined || (baseline && (!baseline.updated_at || baseline.id!==entry.id)))throw conflict();
      if(remove && !baseline)throw conflict();
      const stamp=new Date(Math.max(Date.now(),Date.parse(baseline?.updated_at || 0)+1)).toISOString();
      const data=clone(entry);
      data.updatedActor=clone(actor);data.updatedBy=actor.email || '';data.updated=stamp;data._btvOperationId=csv.id('cal-change-');
      return {table:name,baseline:baseline?clone(baseline):null,remove:!!remove,actorId:actor.id,
        row:management?{id:entry.id,section:entry.section,week_id:entry.weekId,year:+(entry.launchDate || entry.openingDate || entry.targetOpenDate || entry.startDateISO || entry.weekId).slice(0,4),data,updated_at:stamp,updated_by:actor.id}:
          {id:entry.id,market:entry.market,data,updated_at:stamp,updated_by:actor.id}};
    }
    async function commit(attempt){
      const actor=user();
      if(actor.id!==attempt.actorId)throw new Error('This draft belongs to a different signed-in user. Reopen it before saving.');
      const {row,baseline,remove}=attempt;
      if(baseline && attempt.table==='calendar_entries'){
        if(await request(options.sb.rpc('refresh_calendar_entry_lock',{p_id:row.id}))!==true)throw new Error('Your edit lock was released. Your draft is kept; reopen the entry before saving.');
      }
      try{
        let query=table(attempt.table);
        if(baseline)query=(remove?query.delete():query.update(row)).eq('id',row.id).eq('updated_at',baseline.updated_at).select();
        else query=query.insert([row]).select();
        const written=await request(query);
        if(!written?.length)throw conflict();
        return remove?null:written[0];
      }catch(error){
        // Keep the same operation identity on retry after an uncertain response.
        if(!remove){
          const current=await read(attempt.table,row.id).catch(()=>null);
          if(current?.data?._btvOperationId===row.data._btvOperationId)return current;
        }
        if(error.code==='23505' || error.code==='conflict')throw conflict();
        throw error;
      }
    }
    return {prepare,commit,read};
  }
  return {createClient,conflict};
});
