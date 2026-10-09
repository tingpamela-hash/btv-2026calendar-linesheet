const {test}=require('node:test');
const assert=require('node:assert/strict');
const identity=require('../js/linesheet-identity.js');
const row={productName:'Crunch Carryall 0.5',colour:'Cherry',size:'One Size',calColourId:'line-1'};

test('legacy calendar/editor rows use stable form IDs, never random IDs',()=>{
  assert.equal(identity.formId({id:'p_line-1'}),'p_line-1');
  assert.equal(identity.formId({id:'p_line-1',calColourId:'line-1'}),'line-1');
  assert.equal(identity.formId({variantLocalId:'form::one size'}),'form');
});
test('enriched exact variant survives calendar refresh without another row',()=>{
  const p={id:'product_existing',uniqueId:'original',name:row.productName,variant:'Cherry',size:'One Size',sku:'CHERRY-SKU',approvedSC:true};
  const result=identity.calendarRecords(row,[p],'p_line-1');
  assert.equal(result.length,1);
  assert.equal(result[0].id,p.id);
  assert.equal(result[0].existing.sku,p.sku);
  assert.equal(result[0].existing.approvedSC,true);
  assert.deepEqual(result[0].consumedIds,[p.id]);
  assert.equal(p.variantFormId,undefined);
});
test('blank duplicate consolidates into enriched record without losing complementary data',()=>{
  const blank={id:'p_line-1',name:row.productName,variant:'Cherry',sizing:'One Size',description:'',sku:'',approvedDesigner:true};
  const filled={id:'product_existing',name:row.productName,variant:'Cherry',size:'One Size',sku:'CHERRY-SKU',description:'Useful bag',approvedSC:true,productImgUrl:'https://example.invalid/photo'};
  const result=identity.calendarRecords(row,[blank,filled],'p_line-1');
  assert.equal(result.length,1);
  assert.equal(result[0].id,filled.id);
  assert.equal(result[0].existing.description,filled.description);
  assert.equal(result[0].existing.productImgUrl,filled.productImgUrl);
  assert.equal(result[0].existing.approvedDesigner,true);
  assert.equal(result[0].existing.approvedSC,true);
  assert.equal(result[0].consumedIds.length,2);
});
test('conflicting entered SKUs or images are never silently discarded',()=>{
  for(const field of ['sku','productImgUrl','description']){
    const a={id:'a',name:row.productName,variant:'Cherry',size:'One Size',[field]:'A'};
    const b={...a,id:'b',[field]:'B'};
    const result=identity.calendarRecords(row,[a,b],'p_line-1');
    assert.equal(result.length,2);
    assert.ok(result.every(p=>p.conflict));
    assert.deepEqual(result.map(p=>p.existing[field]).sort(),['A','B']);
  }
});
test('size-level records retain IDs, per-size codes and a shared stable form',()=>{
  const rows=['S','M'].map(size=>({id:'product-'+size,variantFormId:'form',variantLocalId:'form::'+size.toLowerCase(),name:row.productName,variant:'Cherry',size,sku:'SKU-'+size}));
  const result=identity.calendarRecords({...row,size:'S,M'},rows,'p_line-1');
  assert.deepEqual(result.map(p=>p.id),['product-S','product-M']);
  assert.deepEqual(result.map(p=>p.existing.sku),['SKU-S','SKU-M']);
});
test('legacy multi-size rows expand deterministically and have distinct unique IDs',()=>{
  const p={id:'legacy',name:row.productName,variant:'Cherry',sizing:'S,M',sizeSKUs:{S:'SKU-S',M:'SKU-M'}};
  const result=identity.calendarRecords({...row,size:'S,M'},[p],'p_line-1');
  assert.equal(result[0].id,'legacy');
  assert.equal(result[1].existing.uniqueId,result[1].id);
  assert.equal(result[0].existing.variantFormId,result[1].existing.variantFormId);
  assert.deepEqual(result.map(p=>p.existing.sku),['SKU-S','SKU-M']);
  assert.deepEqual(result.map(p=>p.id),identity.calendarRecords({...row,size:'S,M'},[p],'p_line-1').map(p=>p.id));
});
test('stable calendar colour link survives rename and other colours are not matched',()=>{
  const p={id:'edited',name:'Old Name',variant:'Old Colour',calColourId:row.calColourId,size:'One Size',sku:'SAME'};
  const result=identity.calendarRecords(row,[p,{id:'other',name:row.productName,variant:'Dark Plum',sku:'OTHER'}],'p_line-1');
  assert.equal(result[0].id,p.id);
  assert.equal(result[0].existing.sku,'SAME');
});
test('new variants receive deterministic IDs across independent clients',()=>{
  const a=identity.calendarRecords({...row,size:'S,M'},[],'p_line-1');
  const b=identity.calendarRecords({...row,size:'S,M'},[],'p_line-1');
  assert.deepEqual(a,b);
  assert.notEqual(a[0].id,a[1].id);
});
test('conflicting multi-size records are retained once, not duplicated per size',()=>{
  const a={id:'a',name:row.productName,variant:'Cherry',sizing:'S,M',description:'First'};
  const b={...a,id:'b',description:'Second'};
  const result=identity.calendarRecords({...row,size:'S,M'},[a,b],'p_line-1');
  assert.equal(result.length,2);
  assert.deepEqual(result.map(p=>p.id).sort(),['a','b']);
  assert.ok(result.every(p=>p.conflict));
});
test('size casing does not duplicate rows or erase legacy size-specific codes',()=>{
  const p={id:'legacy',name:row.productName,variant:'Cherry',sizing:'s,m',sizeSKUs:{s:'SMALL',m:'MEDIUM'}};
  const result=identity.calendarRecords({...row,size:'S,s,M'},[p],'p_line-1');
  assert.equal(result.length,2);
  assert.deepEqual(result.map(p=>p.existing.sku),['SMALL','MEDIUM']);
});
