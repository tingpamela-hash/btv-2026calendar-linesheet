(function(root,factory){
  var api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.BtvLinesheetProducts=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function nameKey(value){return String(value||'').trim().toLowerCase();}
  function summaries(list,all){
    var names=new Map(),members=new Map();
    list.forEach(function(p){if(!names.has(nameKey(p.name))) names.set(nameKey(p.name),p);});
    all.forEach(function(p){var key=nameKey(p.name);if(!members.has(key))members.set(key,[]);members.get(key).push(p);});
    return Array.from(names.entries()).map(function(pair){
      var rows=members.get(pair[0])||[];
      var p=Object.assign({},pair[1]);
      p.memberIds=rows.map(function(row){return row.id;});
      p.groupIds=Array.from(new Set(rows.map(function(row){return row.groupId;})));
      ['approvedDesigner','approvedSC','approvedMerch','selectedForLinesheet'].forEach(function(key){p[key]=rows.every(function(row){return !!row[key];});});
      p.linesheetComplete=p.approvedDesigner&&p.approvedSC&&p.approvedMerch;
      p.variant=Array.from(new Set(rows.map(function(row){return row.variant;}).filter(Boolean))).length+' colours';
      p.size=Array.from(new Set(rows.map(function(row){return row.size||row.sizing;}).filter(Boolean))).join(', ');
      p.sku=new Set(rows.flatMap(function(row){return [row.sku].concat(Object.values(row.sizeSKUs||{}));}).filter(Boolean)).size+' codes';
      p.barcode=new Set(rows.flatMap(function(row){return [row.barcode].concat(Object.values(row.sizeBarcodes||{}));}).filter(Boolean)).size+' codes';
      p.uniqueId=p.groupId;p.sizeSKUs={};p.sizeBarcodes={};
      p.calMarkets=Array.from(new Set(rows.flatMap(function(row){return row.calMarkets||[];})));
      p.calStores=Array.from(new Set(rows.flatMap(function(row){return row.calStores||[];})));
      return p;
    });
  }
  function changes(before,after,actor,ts){
    var old=new Map(before.map(function(p){return [p.id,p];})), result=[],seen=new Set();
    var keys=['name','category','description','fabric','washcare','sizing','weightGrams','measurementMatrix','sgd','sgdNoGST','jp','idRrp','th','ph','cn','hscode','hscode10','variant','sku','barcode','sizeSKUs','sizeBarcodes','productImg','lookbookImg'];
    function value(v){return v==null?'':typeof v==='object'?JSON.stringify(v):String(v);}
    after.forEach(function(p){
      var previous=old.get(p.id)||{};
      ['generalApprovals','variantApprovals'].forEach(function(scope){
        ['designer','sc','merch'].forEach(function(role){
          var from=!!previous[scope]?.[role]?.approved,to=!!p[scope]?.[role]?.approved;
          if(from===to)return;
          var variant=scope==='generalApprovals'?'(shared)':p.variant||'No colour';
          var field=(scope==='generalApprovals'?'General':'Variant')+' approval - '+({designer:'Design',sc:'Supply Chain',merch:'Merch'}[role]);
          var identity=JSON.stringify([variant,field,from,to]);if(seen.has(identity))return;seen.add(identity);
          result.push({ts:ts,productName:p.name,variant:variant,field:field,from:from?'Approved':'Pending',to:to?'Approved':'Pending',action:'update',actorId:actor.id,actorName:actor.name,actorEmail:actor.email});
        });
      });
      keys.forEach(function(key){
        var from=value(previous[key]),to=value(p[key]);
        if(from===to)return;
        var variant=['variant','sku','barcode','sizeSKUs','sizeBarcodes','productImg','lookbookImg'].includes(key)?[p.variant,p.size].filter(Boolean).join(' / '):'(shared)';
        var identity=JSON.stringify([variant,key,from,to]);if(seen.has(identity))return;seen.add(identity);
        if(key==='productImg'||key==='lookbookImg'){from=from?'Image present':'';to=to?'Image uploaded':'Image removed';}
        result.push({ts:ts,productName:p.name,variant:variant,field:key,from:from,to:to,action:'update',actorId:actor.id,actorName:actor.name,actorEmail:actor.email});
      });
    });
    before.filter(function(p){return !after.some(function(row){return row.id===p.id;});}).forEach(function(p){result.push({ts:ts,productName:p.name,variant:[p.variant,p.size].filter(Boolean).join(' / '),field:'Variant removed',from:p.sku||p.variant,to:'Removed',action:'delete',actorId:actor.id,actorName:actor.name,actorEmail:actor.email});});
    return result;
  }
  return {nameKey:nameKey,summaries:summaries,changes:changes};
});
