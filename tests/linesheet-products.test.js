const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../js/linesheet-products.js');
test('approval audit distinguishes general from colour approval without repeated size entries',()=>{
  const before=[{id:'S',name:'Bag',variant:'Blue'},{id:'M',name:'Bag',variant:'Blue'}];
  const after=before.map(p=>({...p,generalApprovals:{sc:{approved:true}},variantApprovals:{designer:{approved:true}}}));
  const entries=api.changes(before,after,{id:'u',name:'Nora'},10);
  assert.equal(entries.length,2);assert.equal(entries[0].variant,'(shared)');assert.equal(entries[1].variant,'Blue');
  assert.equal(entries[0].to,'Approved');
});
test('one summary per product name retains all colour/size identities despite filtering',()=>{
  const rows=[{id:'a',groupId:'g',name:'Bag',variant:'Black',size:'S',sku:'S',approvedDesigner:true},{id:'b',groupId:'g',name:' Bag ',variant:'Black',size:'M',sku:'M',approvedDesigner:false},{id:'c',groupId:'legacy',name:'bag',variant:'Red',size:'S',sku:'R',approvedDesigner:true}];
  const result=api.summaries([rows[0]],rows);
  assert.equal(result.length,1);assert.equal(result[0].variant,'2 colours');assert.deepEqual(result[0].memberIds,['a','b','c']);assert.deepEqual(result[0].groupIds,['g','legacy']);assert.equal(result[0].approvedDesigner,false);assert.equal(result[0].sku,'3 codes');assert.equal(rows[0].variant,'Black');
});
test('audit includes actor and every size-specific change without exposing image bytes',()=>{
  const actor={id:'user',name:'Wynn',email:'wynn@example.test'};
  const before=[{id:'a',name:'Bag',variant:'Black',size:'S',sku:'OLD',productImg:'old'}];
  const after=[{...before[0],sku:'NEW',productImg:'secret image bytes',sizeBarcodes:{S:'BC'}}];
  const log=api.changes(before,after,actor,123);
  assert.equal(log.length,3);assert.ok(log.every(e=>e.actorName==='Wynn'&&e.actorId==='user'&&e.ts===123));assert.ok(log.some(e=>e.field==='sku'&&e.from==='OLD'&&e.to==='NEW'&&e.variant==='Black / S'));assert.ok(!JSON.stringify(log).includes('secret image bytes'));assert.deepEqual(api.changes(after,after,actor,124),[]);
});
test('common edits are deduplicated while removed sizes are recorded',()=>{
  const before=[{id:'a',name:'Bag',description:'old'},{id:'b',name:'Bag',description:'old'},{id:'c',name:'Bag',variant:'Red',size:'M'}];
  const entries=api.changes(before,before.slice(0,2).map(p=>({...p,description:'new'})),{id:'u',name:'User',email:'u@example.test'},5);
  assert.equal(entries.filter(e=>e.field==='description').length,1);assert.equal(entries.find(e=>e.action==='delete').variant,'Red / M');
});
