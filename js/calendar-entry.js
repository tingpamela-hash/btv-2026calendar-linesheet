(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./calendar-csv'));
  else root.BtvCalendarEntry=factory(root.BtvCalendarCSV);
})(typeof globalThis!=='undefined'?globalThis:this,function(csv){
  function dateOf(entry){return entry && (entry.launchDate||entry.openingDate||entry.targetOpenDate||entry.etaISO||entry.startDateISO||entry.date)||'';}
  function shiftDraft(entry,targetWeek){
    var draft=JSON.parse(JSON.stringify(entry)),start=dateOf(entry);
    var target=csv.monday(targetWeek),delta=start?(Date.parse(target)-Date.parse(csv.monday(start)))/86400000:0;
    function shift(value){if(!value)return '';var date=new Date(Date.parse(csv.date(value))+delta*86400000);return date.toISOString().slice(0,10);}
    if(start){['launchDate','openingDate','targetOpenDate','etaISO','startDateISO','endDateISO','closingDate'].forEach(function(key){if(entry[key])draft[key]=shift(entry[key]);});}
    else if(entry.section==='store_openings')draft.targetOpenDate=target;
    else draft.launchDate=target;
    draft.weekId=target;
    return draft;
  }
  function store(entry,year){
    var result=Object.assign({},entry);
    if(!['popup','permanent'].includes(result.storeType))throw new Error('Choose Pop-up or Permanent store.');
    if(!['SG','TH','ID','PH','JP','CN'].includes(result.market))throw new Error('Choose a country.');
    ['storeName','storeAddress'].forEach(function(key){result[key]=String(result[key]||'').trim();if(!result[key])throw new Error(key==='storeName'?'Store Name is required.':'Address is required.');});
    if(!result.openingDate && !result.targetOpenDate)throw new Error('Opening Date is required.');
    result.openingDate=csv.date(result.openingDate||result.targetOpenDate);
    if(+result.openingDate.slice(0,4)!==+year)throw new Error('Opening Date must be in '+year+'.');
    result.targetOpenDate=result.openingDate;
    result.closingDate=result.storeType==='popup' && result.closingDate?csv.date(result.closingDate):'';
    if(result.closingDate && result.closingDate<result.openingDate)throw new Error('Closing Date cannot be before Opening Date.');
    result.weekId=csv.monday(result.openingDate);
    return result;
  }
  return {dateOf:dateOf,shiftDraft:shiftDraft,store:store};
});
