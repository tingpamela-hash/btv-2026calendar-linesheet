const {test} = require('node:test');
const assert = require('node:assert/strict');
const json = require('../js/calendar-json');

function fixture() {
  const launch = {id:'launch-1',section:'global',weekId:'2026-10-05',launchTitle:'Launch',
    launchDate:'2026-10-06',keyLevel:'brand',workflowStatus:'published',launchStatus:'on_time',
    noLaunchMarkets:['ID','PH','CN'],skuCount:2,updatedBy:'original@example.test',
    delayMarkets:[],noLaunchChannelsCollapsed:[{market:'SG',stores:['Ecomm']}],
    lines:[{lineId:'product-1',category:'BAGS',productName:'Bag',colour:'Black, White',
      colourIds:['black-id','white-id'],size:'OS',price:'89',note:'Keep metadata'},
    {lineId:'product-2',category:'ACC',productName:'Strap',colour:'Red',colourIds:['red-id'],size:'OS',price:'20'}]};
  return {global:{'2026-10-05':[launch]},china:{},restocks:{}};
}
function edit(state,fn) { const file=JSON.parse(json.serialize(state,2026));fn(file);return JSON.stringify(file); }
test('legacy China exports clean other markets without mutating stored records and can reimport', () => {
  const state = fixture();
  const launch = JSON.parse(JSON.stringify(state.global['2026-10-05'][0]));
  launch.id = 'legacy-china'; launch.section = 'china'; launch.launchStatus = 'delay';
  launch.delayMarkets = [{market:'SG',eta:'2026-10-08'}];
  launch.noLaunchChannelsCollapsed.push({market:'CN',stores:['ONLINE']});
  state.china['2026-10-05'] = [launch];
  const before = JSON.stringify(state);
  const exported = json.serialize(state,2026);
  const china = JSON.parse(exported).entries.find(entry => entry.section === 'china');
  assert.deepEqual(china.noLaunchChannelsCollapsed,[{market:'CN',stores:['ONLINE']}]);
  assert.deepEqual(china.delayMarkets,[]); assert.equal(china.launchStatus,'on_time');
  assert.equal(JSON.stringify(state),before);
  assert.equal(json.plan(exported,state,2026).updated,1);
});
test('restocks can be created without a title, category or price and retain stable IDs on reimport', () => {
  const file={entries:[{section:'restocks',launchDate:'2026-10-06',markets:['SG'],lines:[{productName:'Restock bag',colour:'Black',size:'OS'}]}]};
  const result=json.plan(JSON.stringify(file),{},2026),entry=result.changes[0].entry;
  assert.equal(entry.launchTitle,'');assert.equal(entry.lines[0].category,'');assert.equal(entry.lines[0].price,'');
  const state={restocks:{[entry.weekId]:[entry]}};
  assert.equal(json.plan(json.serialize(state,2026),state,2026).unchanged,1);
  const edited=JSON.parse(json.serialize(state,2026));edited.entries[0].launchDate='2026-10-19';
  const changed=json.plan(JSON.stringify(edited),state,2026).changes[0].entry;
  assert.equal(changed.id,entry.id);assert.equal(changed.lines[0].lineId,entry.lines[0].lineId);
  assert.equal(changed.weekId,'2026-10-19');
});
test('JSON round trip is unchanged and export uses date-based records', () => {
  const state=fixture(),file=JSON.parse(json.serialize(state,2026));
  assert.equal(file.format,'btv-management-calendar');assert.equal(file.schemaVersion,1);
  assert.equal(file.entries[0].weekId,undefined);assert.equal(file.entries[0].updatedBy,undefined);
  assert.deepEqual(file.entries[0].markets,['SG','TH','JP']);
  assert.equal(json.plan(JSON.stringify(file),state,2026).unchanged,1);
});
test('JSON updates dates, market order, product values and delay properties with stable identities', () => {
  const state=fixture();
  const p=json.plan(edit(state,file=>{
    const e=file.entries[0];e.launchTitle='Renamed';e.launchDate='18/10/2026';e.markets=['jp','sg','TH','SG'];
    e.launchStatus='delay';e.delayMarkets=[{market:'sg',eta:'2026-11-02'}];
    e.lines[0].colour='White, Black';e.lines[0].price=99;
  }),state,2026);
  const e=p.changes[0].entry;
  assert.equal(p.updated,1);assert.equal(e.id,'launch-1');assert.equal(e.weekId,'2026-10-12');
  assert.deepEqual(e.noLaunchMarkets,['ID','PH','CN']);assert.equal(e.lines[0].price,'99');
  assert.deepEqual(e.lines[0].colourIds,['white-id','black-id']);assert.equal(e.lines[0].note,'Keep metadata');
  assert.deepEqual(e.delayMarkets,[{market:'SG',eta:'2026-11-02'}]);assert.equal(e.updatedBy,'original@example.test');
});
test('partial JSON keeps unlisted launches and unlisted products', () => {
  const state=fixture();
  const other=JSON.parse(JSON.stringify(state.global['2026-10-05'][0]));other.id='other';other.launchTitle='Unlisted';
  state.global['2026-10-05'].push(other);
  const before=JSON.stringify(state);
  const p=json.plan(edit(state,file=>{file.entries.pop();file.entries[0].lines.pop();file.entries[0].lines[0].price='100';}),state,2026);
  assert.equal(p.updated,1);assert.equal(p.changes[0].entry.lines.length,2);assert.equal(JSON.stringify(state),before);
});
test('legacy wrapped and raw state exports use launch dates, not stale week keys', () => {
  for(const wrapped of [true,false]) {
    const state=fixture(),incoming=JSON.parse(JSON.stringify(state));
    incoming.global['2026-10-05'][0].launchDate='2026-10-18';
    const file=wrapped?{state:incoming,versions:[],changes:[]}:incoming;
    assert.equal(json.plan(JSON.stringify(file),state,2026).changes[0].entry.weekId,'2026-10-12');
  }
});
test('malformed records reject the entire JSON without changing source data', () => {
  const scenarios=[
    [f=>f.entries[0].launchDate='2026-02-30',/Invalid Launch Date/],
    [f=>f.entries[0].launchDate='2027-01-01',/select that calendar year/],
    [f=>f.entries[0].markets=['SG','XX'],/Unknown market/],
    [f=>f.entries[0].markets='SG',/list of market codes/],
    [f=>f.entries[0].id='missing',/Entry ID not found/],
    [f=>f.entries[0].lines[0].lineId='missing',/Product Line ID not found/],
    [f=>f.entries[0].skuCount=-1,/skuCount/],
    [f=>f.entries[0].delayMarkets=[{market:'SG',eta:'2026-02-30'}],/Invalid Launch Date/],
    [f=>f.entries[0].noLaunchChannelsCollapsed=[{market:'SG',stores:'Ecomm'}],/list of stores/],
    [f=>f.entries[0].lines={},/Product lines must be a list/],
    [f=>f.entries[0].lines[0].price='abc',/Invalid product price/],
    [f=>f.entries[0].lines[0].colourIds='wrong',/Colour IDs/],
    [f=>f.entries[0].allMarkets='yes',/allMarkets/],
    [f=>f.schemaVersion=2,/schema version/],
    [f=>f.entries.push(f.entries[0]),/Duplicate launch/]
  ];
  for(const [modify,pattern] of scenarios) {
    const state=fixture(),before=JSON.stringify(state);
    assert.throws(()=>json.plan(edit(state,modify),state,2026),pattern);
    assert.equal(JSON.stringify(state),before);
  }
  assert.throws(()=>json.plan('{"__proto__":{}}',fixture(),2026),/Unsupported property/);
  assert.throws(()=>json.plan('null',fixture(),2026),/must be an object/);
});
test('new JSON launch and product IDs are generated, then reimport does not duplicate', () => {
  const file={format:'btv-management-calendar',schemaVersion:1,entries:[{
    section:'global',launchTitle:'New',launchDate:'2026-01-01',markets:['SG'],
    lines:[{productName:'New bag',category:'BAGS',colour:'Black',size:'OS',price:'89'}]
  }]};
  const p=json.plan(JSON.stringify(file),{},2026),e=p.changes[0].entry;
  assert.equal(p.added,1);assert.ok(e.id);assert.ok(e.lines[0].lineId);assert.equal(e.weekId,'2025-12-29');
  const state={global:{[e.weekId]:[e]}};
  assert.equal(json.plan(json.serialize(state,2026),state,2026).unchanged,1);
});
test('China and restocks round trip, including legacy China exclusion fields', () => {
  const state=fixture(),china=JSON.parse(JSON.stringify(state.global['2026-10-05'][0]));
  china.id='china';china.section='china';china.noLaunchMarkets=[];
  china.noLaunchChannelsCollapsed=[{market:'CN',stores:['China Ecomm']}];
  state.china={'2026-10-05':[china]};
  const restock=JSON.parse(JSON.stringify(china));restock.id='restock';restock.section='restocks';
  state.restocks={'2026-10-05':[restock]};
  assert.equal(json.plan(json.serialize(state,2026),state,2026).unchanged,3);
  assert.equal(json.plan(JSON.stringify({state}),state,2026).unchanged,3);
});
test('unsupported retired sections and empty JSON fail explicitly', () => {
  assert.throws(()=>json.plan('{"state":{"events":{"2026-10-05":[]}}}',fixture(),2026),/Unsupported calendar sections/);
  assert.throws(()=>json.plan('{"entries":[]}',fixture(),2026),/no launch records/);
});
test('China imports reject channels and delayed markets outside CN', () => {
  for(const field of ['noLaunchChannelsCollapsed','delayMarkets']) {
    const state=fixture(),entry=JSON.parse(JSON.stringify(state.global['2026-10-05'][0]));
    entry.id='china';entry.section='china';entry.noLaunchMarkets=[];
    entry.noLaunchChannelsCollapsed=[{market:'CN',stores:['China Ecomm']}];state.china={'2026-10-05':[entry]};
    const file=JSON.parse(json.serialize(state,2026));file.entries=file.entries.filter(e=>e.section==='china');
    file.entries[0][field]=field==='delayMarkets'?[{market:'SG',eta:'2026-11-01'}]:[{market:'SG',stores:['Ecomm']}];
    assert.throws(()=>json.plan(JSON.stringify(file),state,2026),/CN only/);
  }
});
