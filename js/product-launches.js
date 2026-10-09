(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BtvProductLaunches=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const DAY=86400000;
  function validDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return false;
    const time=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
  }
  function todayISO(now=new Date()){
    const parts=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get=type=>parts.find(p=>p.type===type).value;
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function shiftDate(date,days){
    return validDate(date)?new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10):'';
  }
  function daysUntilDue(date,today,leadDays=30){
    return validDate(date)&&validDate(today)?(Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/DAY-leadDays:null;
  }
  const clean=value=>String(value||'').trim().toLowerCase();
  const identity=(name,colour)=>JSON.stringify([clean(name),clean(colour)]);
  const sizes=value=>new Set((Array.isArray(value)?value:String(value||'').split(/[,;]/)).map(clean).filter(Boolean));
  function createIndex(rows,today=todayISO()){
    if(!validDate(today)) throw new Error('A valid scheduling date is required.');
    const ready=Array.isArray(rows),byIdentity=new Map(),byColour=new Map(),cache=new WeakMap();
    function add(map,key,row){if(!map.has(key))map.set(key,[]);map.get(key).push(row);}
    (ready?rows:[]).forEach(row=>{
      if(!row||row.calRemoved||(row.calSection&&!['global','china'].includes(row.calSection)))return;
      if(row.productName)add(byIdentity,identity(row.productName,row.colour),row);
      if(row.calColourId)add(byColour,String(row.calColourId),row);
    });
    function dateFor(product){
      if(cache.has(product))return cache.get(product);
      const wanted=sizes(product.sizing);
      const matches=new Set([...(byIdentity.get(identity(product.name,product.variant))||[]),...(byColour.get(String(product.calColourId||''))||[])]);
      const dates=Array.from(new Set(Array.from(matches).filter(row=>!wanted.size||!row.size||wanted.has(clean(row.size))).map(row=>row.launchDate).filter(validDate))).sort();
      const date=product.calRemoved?'':dates.find(date=>date>=today)||dates[dates.length-1]||(!ready&&validDate(product.launchDate)?product.launchDate:'');
      cache.set(product,date);
      return date;
    }
    return {dateFor,ready};
  }
  return {validDate,todayISO,shiftDate,daysUntilDue,createIndex};
});
