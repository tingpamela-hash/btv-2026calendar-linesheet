const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../js/linesheet-approvals.js');
const actor={id:'u',name:'Nora',email:'nora@example.test'};
const flags={designer:true,sc:true,merch:true};

test('general and variant approvals are independent and include the approver',()=>{
  const approved=api.next({},flags,false,actor);
  const row={generalApprovals:approved,variantApprovals:{},selectedForLinesheet:true};
  api.derive(row);
  assert.equal(row.linesheetComplete,false);assert.equal(row.selectedForLinesheet,false);
  row.variantApprovals=api.next({},flags,false,actor);api.derive(row);
  assert.equal(row.linesheetComplete,true);assert.equal(row.approvedSC,true);
  assert.equal(row.generalApprovals.sc.actorName,'Nora');assert.ok(row.variantApprovals.sc.at);
});
test('changed scopes reset approvals unless explicitly reviewed again',()=>{
  const previous=api.next({},flags,false,actor);
  const changed=api.next(previous,flags,true,actor,{sc:true});
  assert.equal(changed.designer.approved,false);assert.equal(changed.sc.approved,true);
  assert.equal(changed.merch.approved,false);
  const unchanged=api.next(previous,flags,false,{id:'other',name:'Other'});
  assert.deepEqual(unchanged,previous);
});
test('scope signatures exclude unrelated fields and ignore map ordering',()=>{
  const row={description:'Shared',sizeSKUs:{M:'M',S:'S'},sgd:69};
  assert.equal(api.signature(row,'general'),api.signature({...row,sizeSKUs:{S:'changed'},sgd:'69'},'general'));
  assert.equal(api.signature(row,'variant'),api.signature({...row,description:'Other',sizeSKUs:{S:'S',M:'M'}},'variant'));
  assert.notEqual(api.signature(row,'variant'),api.signature({...row,sizeSKUs:{S:'changed'}},'variant'));
});
test('legacy whole-product flags do not silently grant either new approval scope',()=>{
  const row={approvedDesigner:true,approvedSC:true,approvedMerch:true};
  assert.equal(api.ready(row),false);api.derive(row);assert.equal(row.approvedDesigner,false);
});
