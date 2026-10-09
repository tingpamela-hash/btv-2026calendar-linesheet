const {test} = require('node:test');
const assert = require('node:assert/strict');
const csv = require('../js/calendar-csv');

function fixture() {
  return {global:{'2026-10-05':[{id:'launch-1',section:'global',weekId:'2026-10-05',
    launchTitle:'Test, "Launch"\nSecond line',launchDate:'2026-10-06',keyLevel:'brand',
    workflowStatus:'published',launchStatus:'on_time',noLaunchMarkets:['ID','PH','CN'],
    noLaunchChannelsCollapsed:['Ecomm'],lines:[{lineId:'product-1',category:'BAGS',
      productName:'Bag',colour:'Black, White',colourIds:['black-id','white-id'],size:'OS',price:'89',merchNote:'Keep this'},
    {lineId:'product-2',category:'ACC',productName:'Strap',colour:'Red',colourIds:['red-id'],size:'OS',price:'20'}]
  }]}};
}
function edit(state, mutate) {
  const rows = csv.parse(csv.serialize(state));
  const header = rows[0];
  const set = (row,key,value) => { row[header.indexOf(key)] = value; };
  mutate(rows,set);
  return '\uFEFF' + rows.map(row => row.map(v => '"' + v.replace(/"/g,'""') + '"').join(',')).join('\r\n');
}
test('title-free restocks round trip and move dates without category or price', () => {
  const e={id:'restock-1',section:'restocks',weekId:'2026-10-05',launchTitle:'',launchDate:'2026-10-06',keyLevel:'brand',workflowStatus:'draft',launchStatus:'on_time',noLaunchMarkets:['TH','ID','PH','JP','CN'],lines:[{lineId:'restock-product',productName:'Bag',colour:'Black',size:'OS',price:'',category:'',colourIds:['black']}]};
  const state={restocks:{[e.weekId]:[e]}};
  assert.equal(csv.plan(csv.serialize(state),state,2026).unchanged,1);
  const result=csv.plan(edit(state,(rows,set)=>{set(rows[1],'Launch Date','2026-10-19');set(rows[1],'Markets','JP SG');}),state,2026);
  assert.equal(result.updated,1);assert.equal(result.changes[0].entry.weekId,'2026-10-19');
  assert.equal(result.changes[0].entry.launchTitle,'');assert.equal(result.changes[0].entry.lines[0].lineId,'restock-product');
  const second=JSON.parse(JSON.stringify(e));second.id='restock-2';state.restocks[e.weekId].push(second);
  assert.throws(()=>csv.plan(edit(state,(rows,set)=>{rows.pop();set(rows[1],'Entry ID','');}),state,2026),/Ambiguous launch/);
});
test('export/import round trip preserves quoted multiline values and stable IDs', () => {
  const state = fixture();
  const result = csv.plan(csv.serialize(state), state,2026);
  assert.equal(result.unchanged,1); assert.equal(result.changes.length,0);
  assert.equal(csv.parse(csv.serialize(state))[1][2],state.global['2026-10-05'][0].launchTitle);
});
test('date edits move the same launch to its derived Monday and keep product metadata', () => {
  const state=fixture();
  const text=edit(state,(rows,set) => rows.slice(1).forEach(r => {
    set(r,'Launch Date','18/10/2026');set(r,'Launch Title','Renamed');set(r,'Markets','jp; sg; TH; SG');
  }));
  const result=csv.plan(text,state,2026), entry=result.changes[0].entry;
  assert.equal(result.updated,1);assert.equal(result.added,0);
  assert.equal(entry.id,'launch-1');assert.equal(entry.weekId,'2026-10-12');
  assert.deepEqual(entry.noLaunchMarkets,['ID','PH','CN']);
  assert.equal(entry.lines[0].merchNote,'Keep this');assert.deepEqual(entry.noLaunchChannelsCollapsed,['Ecomm']);
  assert.equal(state.global['2026-10-05'][0].launchTitle,'Test, "Launch"\nSecond line');
});
test('market order/case/duplicates do not change launch markets', () => {
  assert.deepEqual(csv.markets('jp, sg, TH, SG'),['SG','TH','JP']);
  assert.deepEqual(csv.markets('All Markets'),['SG','TH','ID','PH','JP','CN']);
});
test('partial product CSV preserves omitted products and reorders colour IDs by name', () => {
  const state=fixture();
  const text=edit(state,(rows,set) => {rows.pop();set(rows[1],'Colour','White, Black');set(rows[1],'SGD RRP','S$99');});
  const e=csv.plan(text,state,2026).changes[0].entry;
  assert.equal(e.lines.length,2);assert.equal(e.lines[0].price,'99');
  assert.deepEqual(e.lines[0].colourIds,['white-id','black-id']);assert.equal(e.lines[0].lineId,'product-1');
});
test('invalid dates, unknown markets, mismatched launch rows and wrong years fail without mutation', () => {
  for(const [key,value,pattern] of [['Launch Date','2026-02-30',/Invalid Launch Date/],
    ['Markets','SG, XX',/Unknown market/],['Launch Date','2027-01-05',/select that calendar year/],
    ['Entry ID','missing',/Entry ID not found/],['SGD RRP','abc',/Invalid SGD RRP/]]) {
    const state=fixture(),before=JSON.stringify(state);
    assert.throws(() => csv.plan(edit(state,(rows,set) => rows.slice(1).forEach(r=>set(r,key,value))),state,2026),pattern);
    assert.equal(JSON.stringify(state),before);
  }
  assert.throws(()=>csv.plan(edit(fixture(),(rows,set)=>set(rows[1],'Launch Title','Different')),fixture(),2026),/fields disagree/);
});
test('legacy export headers are mapped by name, derived year/week columns are ignored', () => {
  const text='Year,Section,Week No.,Week Dates,Launch Title,Launch Date,Category,Product Name,Colour,Size / SKUs,Price (USD),Markets,Status\n1999,Global,999,wrong,New,6-Oct-2026,BAGS,Bag,Red,OS,$89,"JP,SG",Draft';
  const result=csv.plan(text,{},2026),e=result.changes[0].entry;
  assert.equal(result.added,1);assert.equal(e.weekId,'2026-10-05');assert.equal(e.launchDate,'2026-10-06');
  assert.deepEqual(e.noLaunchMarkets,['TH','ID','PH','CN']);
});
test('new launches reimport without duplication and preserve identity', () => {
  const text='Launch Title,Launch Date,Section,Product Name,Markets\nNew,2026-01-01,global,Bag,All';
  const e=csv.plan(text,{},2026).changes[0].entry;
  const state={global:{[e.weekId]:[e]}};
  assert.equal(e.weekId,'2025-12-29');
  assert.equal(csv.plan(text,state,2026).unchanged,1);
});
test('China and restocks retain the correct markets on round trip', () => {
  const state=fixture(),e=JSON.parse(JSON.stringify(state.global['2026-10-05'][0]));
  e.id='china';e.section='china';e.noLaunchMarkets=[];
  state.china={'2026-10-05':[e]};
  const restock=JSON.parse(JSON.stringify(e));restock.id='restock';restock.section='restocks';
  restock.noLaunchMarkets=['TH','PH','JP','CN'];state.restocks={'2026-10-05':[restock]};
  assert.equal(csv.plan(csv.serialize(state),state,2026).unchanged,3);
  assert.throws(()=>csv.plan('Launch Title,Launch Date,Section,Markets\nNew,2026-10-06,china,SG',{},2026),/CN only/);
});
test('malformed CSV is rejected instead of silently skipping data', () => {
  assert.throws(()=>csv.parse('a,"unfinished'),/unclosed/);
  assert.throws(()=>csv.plan('Launch Title,Launch Date,Section\nNew,2026-10-06',{},2026),/Column count/);
});
