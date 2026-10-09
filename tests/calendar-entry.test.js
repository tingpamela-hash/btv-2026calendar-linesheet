const test=require('node:test');
const assert=require('node:assert/strict');
const {dateOf,shiftDraft,store}=require('../js/calendar-entry');
const json=require('../js/calendar-json');
const exporter=require('../js/calendar-export');

test('drag drafts preserve weekday, original date, identity and popup duration',()=>{
  const entry={id:'launch',section:'global',launchDate:'2026-10-09',weekId:'2026-10-05'};
  const draft=shiftDraft(entry,'2026-10-19');
  assert.equal(draft.launchDate,'2026-10-23');
  assert.equal(dateOf(entry),'2026-10-09');assert.equal(draft.id,entry.id);
  const popup={section:'store_openings',openingDate:'2026-10-09',targetOpenDate:'2026-10-09',closingDate:'2026-11-01'};
  const moved=shiftDraft(popup,'2026-10-19');
  assert.equal(moved.openingDate,'2026-10-23');assert.equal(moved.targetOpenDate,moved.openingDate);
  assert.equal(moved.closingDate,'2026-11-15');assert.equal(popup.closingDate,'2026-11-01');
});
test('missing historical dates are not invented by dateOf',()=>{
  assert.equal(dateOf({weekId:'2026-10-05'}),'');
  assert.equal(shiftDraft({section:'global'},'2026-10-19').launchDate,'2026-10-19');
});
const popup={section:'store_openings',storeType:'popup',market:'SG',storeName:' Test Store ',storeAddress:' 123 Street ',openingDate:'2026-10-09',closingDate:'2027-01-03'};
test('store validation derives weeks and accepts optional or cross-year popup closing dates',()=>{
  const saved=store(popup,2026);assert.equal(saved.weekId,'2026-10-05');assert.equal(saved.storeName,'Test Store');
  assert.equal(saved.closingDate,'2027-01-03');assert.equal(saved.targetOpenDate,saved.openingDate);
  assert.equal(store({...popup,closingDate:''},2026).closingDate,'');
  assert.equal(store({...popup,storeType:'permanent'},2026).closingDate,'');
  for(const [change,pattern] of [[{market:''},/country/],[{storeName:''},/Name/],[{storeAddress:''},/Address/],
    [{openingDate:''},/Opening Date/],[{openingDate:'2027-01-01'},/2026/],[{closingDate:'2026-10-08'},/before/]]){
    assert.throws(()=>store({...popup,...change},2026),pattern);
  }
});
test('store JSON imports retain identity and full fields; PDF/Excel card model includes popup details',()=>{
  const entry={...store(popup,2026),id:'store',workflowStatus:'published'};
  const state={store_openings:{[entry.weekId]:[entry]}};
  const file=JSON.parse(json.serialize(state,2026));
  assert.equal(file.entries.length,1);assert.equal(file.entries[0].closingDate,'2027-01-03');
  const roundtrip=json.plan(JSON.stringify(file),state,2026);assert.equal(roundtrip.unchanged,1);
  file.entries[0].openingDate='2026-10-20';file.entries[0].targetOpenDate='2026-10-20';
  const result=json.plan(JSON.stringify(file),state,2026).changes[0].entry;
  assert.equal(result.id,'store');assert.equal(result.weekId,'2026-10-19');
  const model=exporter.card('store_openings',entry);
  assert.equal(model.groups[0].category,'Pop-up');assert.equal(model.groups[0].products[0].colour,'123 Street');
  assert.ok(model.metadata.some(text=>text.startsWith('Closes:')));
});
