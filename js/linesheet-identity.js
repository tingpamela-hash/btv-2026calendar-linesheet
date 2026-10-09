(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.BtvLinesheetIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function normal(value){ return String(value || '').trim().toLowerCase(); }
  function sizes(product){
    if(product.size) return [String(product.size).trim()];
    var values = String(product.sizing || '').split(',').map(function(v){ return v.trim(); }).filter(Boolean);
    Object.keys(product.sizeSKUs || {}).concat(Object.keys(product.sizeBarcodes || {})).forEach(function(v){
      if(!values.some(function(size){ return normal(size) === normal(v); })) values.push(v);
    });
    return values.length ? values : ['One Size'];
  }
  function formId(product){
    return product.variantFormId || String(product.variantLocalId || product.calColourId || product.id).split('::')[0];
  }
  function blank(value){
    return value == null || value === '' || (Array.isArray(value) && !value.length) ||
      (typeof value === 'object' && !Object.keys(value).length);
  }
  function ordered(value){
    if(Array.isArray(value)) return value.map(ordered);
    if(value && typeof value === 'object') return Object.keys(value).sort().reduce(function(out,key){ out[key]=ordered(value[key]);return out; },{});
    return value;
  }
  function equal(a,b){ return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b)); }
  function merge(a,b){
    var result = Object.assign({},a);
    var ignored = /^(id|uniqueId|groupId|variantLocalId|variantFormId|name|variant|category|sizing|size|launchDate|launchTitle|workflowStatus|sgd|cal.*)$/;
    for(var key of Object.keys(b)){
      if(ignored.test(key)) continue;
      if(/^(approvedDesigner|approvedSC|approvedMerch|selectedForLinesheet|linesheetComplete)$/.test(key)){
        result[key] = a[key] === true || b[key] === true; continue;
      }
      if(blank(b[key])) continue;
      if(blank(result[key])) { result[key]=b[key];continue; }
      if(key === 'sizeSKUs' || key === 'sizeBarcodes'){
        var values = Object.assign({},result[key]);
        for(var size of Object.keys(b[key])){
          if(!blank(values[size]) && !blank(b[key][size]) && values[size] !== b[key][size]) return null;
          if(!blank(b[key][size])) values[size]=b[key][size];
        }
        result[key]=values;continue;
      }
      if(!equal(result[key],b[key])) return null;
    }
    return result;
  }
  function calendarRecords(row, products, baseId){
    var candidates = products.filter(function(p){
      return (row.calColourId && p.calColourId === row.calColourId) ||
        (normal(p.name) === normal(row.productName) && normal(p.variant) === normal(row.colour));
    });
    var requested = String(row.size || '').split(',').map(function(v){ return v.trim(); }).filter(Boolean);
    requested=requested.filter(function(v,i){return requested.findIndex(function(other){return normal(v)===normal(other);})===i;});
    if(!requested.length) candidates.forEach(function(p){ sizes(p).forEach(function(size){ if(!requested.some(function(v){return normal(v)===normal(size);})) requested.push(size); }); });
    if(!requested.length) requested=['One Size'];
    for(var requestedSize of requested){
      var overlap = candidates.filter(function(p){return sizes(p).some(function(v){return normal(v)===normal(requestedSize);});});
      var combined = overlap[0] || {};
      for(var other of overlap.slice(1)){
        combined=merge(combined,other);
        if(!combined) return candidates.map(function(p){return {existing:p,id:p.id,size:p.size || sizes(p)[0],consumedIds:[p.id],conflict:true};});
      }
    }
    var usedIds = new Set();
    return requested.flatMap(function(size,index){
      var matches = candidates.filter(function(p){ return sizes(p).some(function(v){return normal(v)===normal(size);}); });
      // Prefer enriched rows; deterministic tie breaking makes independent clients agree.
      matches.sort(function(a,b){
        function score(p){return Object.keys(p).filter(function(k){return !/^(id|uniqueId|groupId|variantLocalId|variantFormId|cal.*)$/.test(k)&&!blank(p[k]);}).length;}
        return score(b)-score(a) || String(a.id).localeCompare(String(b.id));
      });
      var existing = matches[0] || null;
      var consumed = [];
      if(existing){
        existing = Object.assign({},existing);
        for(var candidate of matches){
          var combined = merge(existing,candidate);
          existing=combined;consumed.push(candidate.id);
        }
      }
      var id = existing ? existing.id : (index === 0 && !candidates.some(function(p){return p.id===baseId;}) ? baseId : baseId+'__size_'+encodeURIComponent(normal(size)));
      if(usedIds.has(id)) id=baseId+'__size_'+encodeURIComponent(normal(size));
      usedIds.add(id);
      if(existing){
        var originalId = existing.id;
        var stableFormId = formId(existing);
        existing.variantFormId = stableFormId;
        existing.variantLocalId = stableFormId+'::'+normal(size);
        if(id !== originalId) existing.uniqueId=id;
        function code(map){var key=Object.keys(map || {}).find(function(v){return normal(v)===normal(size);});return key ? map[key] : '';}
        existing.sku = code(existing.sizeSKUs) || (sizes(existing).length===1 ? existing.sku : '') || '';
        existing.barcode = code(existing.sizeBarcodes) || (sizes(existing).length===1 ? existing.barcode : '') || '';
      }
      return [{existing:existing,id:id,size:size,consumedIds:consumed,conflict:false}];
    });
  }
  return {formId:formId,calendarRecords:calendarRecords};
});
