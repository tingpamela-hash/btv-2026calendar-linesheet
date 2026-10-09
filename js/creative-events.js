(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.BtvCreativeEvents=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const metadata=new Set(['id','market','created','updated','updatedBy','updatedActor','createdBy','linkedMarketingId','workflowStatus','weekId','week','weekEnd','date','startDate','endDate','startDateISO','endDateISO']);
  function publication(entry){
    // Legacy content was visible before publication became an explicit property.
    return !entry.workflowStatus || entry.workflowStatus==='published'?'published':'draft';
  }
  function canonical(value){
    if(Array.isArray(value)) return value.map(canonical);
    if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    return typeof value==='string'?value.replace(/\r\n/g,'\n').trim():value;
  }
  function fingerprint(entry,range){
    const content={};
    Object.keys(entry).sort().forEach(key=>{
      if(metadata.has(key)||key.startsWith('_')) return;
      const value=canonical(entry[key]);
      if(value!==undefined && value!==null && value!=='' && !(Array.isArray(value)&&!value.length)) content[key]=value;
    });
    if(content.title) content.title=content.title.toLowerCase();
    return JSON.stringify([range,content]);
  }
  function iso(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) throw new Error('Choose a valid date.');
    const time=Date.parse(value+'T00:00:00Z');
    if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value) throw new Error('Choose a valid date.');
    return time;
  }
  function shiftedRange(start,end,target){
    const from=iso(start),to=iso(end||start),next=iso(target);
    if(to<from) throw new Error('The source end date is before its start date. Correct the event before duplicating it.');
    return {start:target,end:new Date(next+to-from).toISOString().slice(0,10)};
  }
  // Split at every interval boundary so overlapping events never hide later starts.
  function segments(groups,count){
    const ranges=groups.map(group=>({group,start:Math.max(1,Number(group.week)),end:Math.min(count,Number(group.weekEnd)||Number(group.week))})).filter(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start<=r.end);
    const boundaries=Array.from(new Set([1,count+1,...ranges.flatMap(r=>[r.start,r.end+1])])).sort((a,b)=>a-b);
    const result=[];
    for(let i=0;i<boundaries.length-1;i++){
      const start=boundaries[i],end=boundaries[i+1]-1;
      const active=ranges.filter(r=>r.start<=start&&r.end>=start).map(r=>r.group);
      if(active.length) result.push({start,end,groups:active});
      else for(let week=start;week<=end;week++) result.push({start:week,end:week,groups:[]});
    }
    return result;
  }
  return {publication,fingerprint,shiftedRange,segments};
});
