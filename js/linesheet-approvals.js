(function(root,factory){
  var api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.BtvLinesheetApprovals=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  var roles=['designer','sc','merch'];
  var generalFields=['name','category','description','fabric','washcare','sizing','weightGrams','measurementMatrix','measurementInch','measurementCm','sgd','sgdNoGST','jp','idRrp','th','ph','cn','hscode','hscode10'];
  var variantFields=['variant','sizeSKUs','sizeBarcodes','productImg','lookbookImg'];
  function stable(value){
    if(Array.isArray(value))return value.map(stable);
    if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(function(key){return [key,stable(value[key])];}));
    return value==null?'':String(value);
  }
  function signature(row,scope){return JSON.stringify((scope==='general'?generalFields:variantFields).map(function(key){return stable(row[key]);}));}
  function next(previous,flags,changed,actor,confirmed){
    var result={};
    roles.forEach(function(role){
      var old=previous && previous[role];
      if(!flags[role] || (changed && !(confirmed||{})[role])){result[role]={approved:false};return;}
      result[role]=!changed && old && old.approved?old:{approved:true,actorId:actor.id,actorName:actor.name,actorEmail:actor.email,at:new Date().toISOString()};
    });
    return result;
  }
  function ready(row){return ['generalApprovals','variantApprovals'].every(function(scope){return roles.every(function(role){return !!(row[scope] && row[scope][role] && row[scope][role].approved);});});}
  function derive(row){
    roles.forEach(function(role,i){row[['approvedDesigner','approvedSC','approvedMerch'][i]]=!!(row.generalApprovals && row.generalApprovals[role]?.approved && row.variantApprovals && row.variantApprovals[role]?.approved);});
    row.linesheetComplete=ready(row);
    if(!row.linesheetComplete)row.selectedForLinesheet=false;
    return row;
  }
  return {roles:roles,signature:signature,next:next,ready:ready,derive:derive};
});
