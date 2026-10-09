(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./calendar-csv'));
  else root.BtvMarkdown=factory(root.BtvCalendarCSV);
})(typeof globalThis==='undefined'?this:globalThis,function(csv){
  'use strict';
  const MARKETS=['SG','TH','ID','PH','JP','CN'];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const legacyKey=year=>'calendar-'+year+'-markdown-bars-v1';
  const cacheKey=year=>'btv-markdown-rows-'+year;
  const rowId=(year,id)=>'markdown::'+year+'::'+encodeURIComponent(id);
  function merge(legacy,rows){
    const result=Object.assign({},legacy || {});
    (rows || []).forEach(row=>{
      if(row.section!=='markdown' || !row.data?.id)return;
      if(row.data.deleted)delete result[row.data.id];
      else result[row.data.id]=clone(row.data);
    });
    return result;
  }
  function validate(input,year){
    const value=clone(input);
    value.title=String(value.title || '').trim();
    if(!value.title)throw new Error('Markdown Title is required.');
    if(!value.startDate || !value.endDate)throw new Error('Start Date and End Date are required.');
    value.startDate=csv.date(value.startDate);value.endDate=csv.date(value.endDate);
    if(value.endDate<value.startDate)throw new Error('End Date cannot be before Start Date.');
    if([value.startDate,value.endDate].some(date=>+date.slice(0,4)!==+year))throw new Error('Choose dates within the selected calendar year ('+year+').');
    value.markets=MARKETS.filter(m=>(value.markets || []).includes(m));
    if(!value.markets.length)throw new Error('Select at least one participating market.');
    value.stores=Object.fromEntries(value.markets.map(m=>{
      const stores=value.stores?.[m];
      if(stores!==undefined && (!Array.isArray(stores) || stores.some(s=>typeof s!=='string')))throw new Error('Invalid participating stores.');
      return [m,Array.from(new Set((stores || []).map(s=>s.trim()).filter(Boolean)))];
    }));
    value.days=(Date.parse(value.endDate)-Date.parse(value.startDate))/86400000+1;
    value.weekendDays=0;
    for(let date=Date.parse(value.startDate);date<=Date.parse(value.endDate);date+=86400000){
      if([0,6].includes(new Date(date).getUTCDay()))value.weekendDays++;
    }
    return value;
  }
  function scope(value){
    return (value.markets?.length?value.markets:MARKETS).map(m=>m+': '+(value.stores?.[m]?.length?value.stores[m].join(', '):'All stores')).join(' | ');
  }
  function changes(before,after){
    if(!before)return [{field:'Markdown Added',from:'—',to:after.title+' | '+after.startDate+' to '+after.endDate+' | '+scope(after)}];
    if(after.deleted)return [{field:'Markdown Deleted',from:before.title+' | '+before.startDate+' to '+before.endDate+' | '+scope(before),to:'—'}];
    return [['title','Markdown Title'],['startDate','Start Date'],['endDate','End Date']].map(([key,field])=>({field,from:before[key] || '',to:after[key] || ''}))
      .concat([{field:'Participating Markets / Stores',from:scope(before),to:scope(after)}]).filter(change=>change.from!==change.to);
  }
  function createClient(options){
    const sb=options.sb;
    const request=async query=>{
      let timer;
      try{
        const result=await Promise.race([query,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shared request timed out. Your draft remains open; reconnect and retry.')),options.timeout || 10000);})]);
        if(result.error)throw new Error(result.error.message || 'Shared database request failed.');
        return result.data;
      }finally{clearTimeout(timer);}
    };
    function actor(){const user=options.actor();if(!user?.id || options.canEdit()!==true)throw new Error('Sign in with Management edit permission before saving.');return user;}
    const readRow=id=>request(sb.from('calendar_entries').select('id,section,year,week_id,data,updated_at,locked_by_email').eq('id',id).maybeSingle());
    async function release(id){await request(sb.rpc('unlock_calendar_entry',{p_id:id}));}
    async function acquire(record,year){
      const user=actor(),id=rowId(year,record.id);
      let row=await readRow(id);
      if(!row){
        // Copy only the first legacy item opened for editing; never replace an existing row.
        await request(sb.from('calendar_entries').upsert([{id,section:'markdown',year,week_id:csv.monday(record.startDate),
          data:clone(record),updated_at:new Date().toISOString(),updated_by:user.id}],{onConflict:'id',ignoreDuplicates:true}));
      }
      const acquired=await request(sb.rpc('try_lock_calendar_entry',{p_id:id,p_email:user.email || ''}));
      if(acquired!==true){row=await readRow(id);return {acquired:false,email:row?.locked_by_email || 'Another user'};}
      try{
        row=await readRow(id);
        if(!row || row.data.deleted)throw new Error('This markdown was removed. Close this draft and refresh the calendar.');
        return {acquired:true,row};
      }catch(error){await release(id).catch(()=>{});throw error;}
    }
    async function save(input,year,baseline,remove){
      const user=actor(),data=remove?{...clone(baseline.data),deleted:true}:validate(input,year);
      const edits=changes(baseline?.data || null,data);
      if(!edits.length)return {row:baseline,changes:[]};
      const stamp=new Date(Math.max(Date.now(),Date.parse(baseline?.updated_at || 0)+1)).toISOString();
      data.updatedBy=user.email;data.updatedActor=user;data.changeId=csv.id('md-change-');
      data.history=(baseline?.data.history || []).slice(-49).concat([{id:data.changeId,at:stamp,actor:user,changes:edits}]);
      const row={id:rowId(year,data.id),section:'markdown',year,week_id:csv.monday(data.startDate),data,updated_by:user.id,updated_at:stamp};
      if(baseline){
        if(await request(sb.rpc('refresh_calendar_entry_lock',{p_id:baseline.id}))!==true)throw new Error('Your edit lock was released. Close and reopen this markdown to load the latest information.');
      }
      try{
        const written=await request(baseline?
          sb.from('calendar_entries').update(row).eq('id',baseline.id).eq('updated_at',baseline.updated_at).select():
          sb.from('calendar_entries').insert([row]).select());
        if(!written?.length)throw new Error('This markdown changed since you opened it. Your draft is kept; close and reopen to review the latest saved information.');
        return {row:written[0],changes:edits};
      }catch(error){
        // An interrupted response can follow a committed write. Confirm the operation ID before retrying.
        const current=await readRow(row.id).catch(()=>null);
        if(current?.data.changeId===data.changeId)return {row:current,changes:edits};
        throw error;
      }
    }
    return {acquire,release,save,readRow,heartbeat:id=>request(sb.rpc('refresh_calendar_entry_lock',{p_id:id})),
      async read(year){
        const legacy=await request(sb.from('app_state').select('value').eq('key',legacyKey(year)).maybeSingle());
        const rows=await request(sb.from('calendar_entries').select('id,section,year,week_id,data,updated_at').eq('section','markdown').eq('year',year));
        return {legacy:legacy?.value || {},rows:rows || []};
      }};
  }
  return {validate,merge,scope,changes,createClient,legacyKey,cacheKey,rowId};
});
