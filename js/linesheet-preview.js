(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.BtvLinesheetPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function normal(value){return String(value || '').trim().toLowerCase().replace(/\s+/g,' ');}
  function launchOrder(products,lines){
    var names=new Map(),colours=new Map();
    function key(value){return normal(value).replace(/[^a-z0-9]/g,'');}
    (lines||[]).forEach(function(line,index){
      var name=key(line.productName||line.productTitle);
      if(!name)return;
      if(!names.has(name))names.set(name,index);
      String(line.colour||'').split(',').map(key).filter(function(colour){return colour && !/^\d+$/.test(colour);}).forEach(function(colour){var id=name+'|'+colour;if(!colours.has(id))colours.set(id,index);});
    });
    function rank(product){
      var name=key(product.name),exact=String(product.variant||'').split(',').map(function(colour){return colours.get(name+'|'+key(colour));}).filter(function(index){return index!==undefined;});
      return exact.length?Math.min.apply(null,exact):(names.get(name)??Infinity);
    }
    return products.map(function(product,index){return {product:product,index:index,rank:rank(product)};}).sort(function(a,b){return (a.rank===b.rank?0:a.rank-b.rank)||a.index-b.index;}).map(function(item){return item.product;});
  }
  function measurements(records){
    var points=new Map();
    records.forEach(function(record){
      (Array.isArray(record.measurementMatrix)?record.measurementMatrix:[]).forEach(function(row){
        var label=row.point||row.label||'';
        if(!label)return;
        var key=normal(label);
        if(!points.has(key))points.set(key,{point:label,tolerance:row.tolerance??'',values:new Map()});
        var point=points.get(key);
        if(point.tolerance==='' && row.tolerance!=null)point.tolerance=row.tolerance;
        var values=Array.isArray(row.values)?row.values:Object.entries(row.values||{}).map(function(pair){return Object.assign({size:pair[0]},pair[1]);});
        values.forEach(function(value){
          var size=value.size && value.size!=='_default'?value.size:(record.size || 'One Size');
          var sizeKey=normal(size);
          if(!point.values.has(sizeKey))point.values.set(sizeKey,{size:size,inch:'',cm:''});
          var target=point.values.get(sizeKey);
          ['inch','cm'].forEach(function(unit){if(target[unit]==='' && value[unit]!=null && value[unit]!=='')target[unit]=value[unit];});
        });
      });
    });
    return Array.from(points.values()).map(function(point){return {point:point.point,tolerance:point.tolerance,values:Array.from(point.values.values())};});
  }
  function groupProducts(products){
    var groups = new Map(),names=new Map();
    products.forEach(function(product){
      var name=normal(product.name);
      if(!names.has(name))names.set(name,[]);
      names.get(name).push(product);
      var key = JSON.stringify([normal(product.name),normal(product.variant)]);
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(product);
    });
    var matrices=new Map(Array.from(names.entries()).map(function(pair){return [pair[0],measurements(pair[1])];}));
    return Array.from(groups.values()).map(function(records){
      var product = Object.assign({},records[0]);
      var sizes = new Map();
      records.forEach(function(record){
        Object.keys(record).forEach(function(key){
          if (product[key] == null || product[key] === '') product[key] = record[key];
        });
        var keys = record.size ? [record.size] : String(record.sizing || '').split(',').map(function(v){return v.trim();}).filter(Boolean);
        keys = keys.concat(Object.keys(record.sizeSKUs || {}),Object.keys(record.sizeBarcodes || {}));
        if (!keys.length) keys = ['One Size'];
        keys.forEach(function(size){
          var key = normal(size);
          if (!sizes.has(key)) sizes.set(key,{size:String(size).trim(),skus:new Set(),barcodes:new Set()});
          var row = sizes.get(key);
          function add(map,target){
            Object.keys(map || {}).filter(function(v){return normal(v)===key;}).forEach(function(v){if(map[v])target.add(String(map[v]));});
          }
          add(record.sizeSKUs,row.skus);add(record.sizeBarcodes,row.barcodes);
          if ((record.size && normal(record.size)===key) || new Set(keys.map(normal)).size===1) {
            if (record.sku) row.skus.add(String(record.sku));
            if (record.barcode) row.barcodes.add(String(record.barcode));
          }
        });
      });
      var order = ['xxs','xs','s','m','l','xl','xxl','xxxl'];
      product.previewSizes = Array.from(sizes.values()).sort(function(a,b){
        var ai=order.indexOf(normal(a.size)),bi=order.indexOf(normal(b.size));
        if(ai>=0 && bi>=0)return ai-bi;
        return a.size.localeCompare(b.size,undefined,{numeric:true});
      }).map(function(row){return {size:row.size,sku:Array.from(row.skus).join(' / '),barcode:Array.from(row.barcodes).join(' / '),conflict:row.skus.size>1 || row.barcodes.size>1};});
      product.sizing = product.previewSizes.map(function(row){return row.size;}).join(', ');
      product.measurementMatrix=matrices.get(normal(product.name));
      product.measurementSizes=Array.from(new Set(product.measurementMatrix.flatMap(function(row){return row.values.map(function(value){return value.size;});})));
      ['generalApprovals','variantApprovals'].forEach(function(scope){
        product[scope]=Object.fromEntries(['designer','sc','merch'].map(function(role){return [role,{approved:records.every(function(row){return !!row[scope]?.[role]?.approved;})}];}));
      });
      ['designer','sc','merch'].forEach(function(role,i){product[['approvedDesigner','approvedSC','approvedMerch'][i]]=product.generalApprovals[role].approved && product.variantApprovals[role].approved;});
      ['calMarkets','calStores'].forEach(function(key){product[key]=Array.from(new Set(records.flatMap(function(row){return row[key] || [];})));});
      product.productImg = product.productImgUrl || product.productImg;
      product.lookbookImg = product.lookbookImgUrl || product.lookbookImg;
      return product;
    });
  }
  function measurementValue(value,unit){
    var result = value[unit],suffix = unit === 'cm' ? 'cm' : 'in';
    if(result === '' || result == null){
      var other = value[unit === 'cm' ? 'inch' : 'cm'];
      if(other === '' || other == null || !Number.isFinite(Number(other))) return '—';
      result = Number((Number(other)*(unit === 'cm' ? 2.54 : 1/2.54)).toFixed(2));
    }
    return String(result) + (/^[+-]?\d+(\.\d+)?$/.test(String(result).trim()) ? suffix : '');
  }
  return {groupProducts:groupProducts,measurements:measurements,launchOrder:launchOrder,measurementValue:measurementValue};
});
