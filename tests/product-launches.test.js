const {test}=require('node:test');
const assert=require('node:assert/strict');
const launches=require('../js/product-launches');
const product={name:'Tote',variant:'Blue',sizing:'S, M',launchDate:'2026-01-01'};
const row=(date,patch={})=>({productName:'Tote',colour:'Blue',size:'S',calSection:'global',launchDate:date,...patch});
test('next launch replaces stale product date without mutating records',()=>{
  const rows=[row('2026-01-01'),row('2026-12-10'),row('2026-11-05'),row('2026-11-05',{calSection:'china'})];
  const snapshot=JSON.stringify([product,rows]);
  assert.equal(launches.createIndex(rows,'2026-10-07').dateFor(product),'2026-11-05');
  assert.equal(JSON.stringify([product,rows]),snapshot);
});
test('past-only and launch-day dates resolve predictably',()=>{
  assert.equal(launches.createIndex([row('2026-06-01'),row('2026-07-01')],'2026-10-07').dateFor(product),'2026-07-01');
  assert.equal(launches.createIndex([row('2026-10-07'),row('2026-11-01')],'2026-10-07').dateFor(product),'2026-10-07');
});
test('colour, size and section boundaries prevent unrelated launches',()=>{
  const rows=[row('2026-10-08',{colour:'Red'}),row('2026-10-09',{size:'XL'}),row('2026-10-10',{calSection:'restocks'}),row('2026-10-11',{calRemoved:true}),row('2026-11-05')];
  assert.equal(launches.createIndex(rows,'2026-10-07').dateFor(product),'2026-11-05');
  assert.equal(launches.createIndex(rows,'2026-10-07').dateFor({...product,calRemoved:true}),'');
});
test('stable colour IDs retain links after renames and legacy identities ignore casing',()=>{
  assert.equal(launches.createIndex([row('2026-11-05',{productName:'Renamed',calColourId:'colour-1'})],'2026-10-07').dateFor({...product,calColourId:'colour-1'}),'2026-11-05');
  assert.equal(launches.createIndex([row('2026-11-05',{productName:' TOTE ',colour:' BLUE '})],'2026-10-07').dateFor(product),'2026-11-05');
});
test('authoritative empty, invalid or removed links never revive stale dates',()=>{
  for(const rows of [[],[row('2026-02-30')],[row('2026-11-01',{calRemoved:true})]])assert.equal(launches.createIndex(rows,'2026-10-07').dateFor(product),'');
  assert.equal(launches.createIndex(null,'2026-10-07').dateFor(product),'2026-01-01');
});
test('calendar moves and deletions resolve from a new index',()=>{
  const rows=[row('2026-11-05')];
  assert.equal(launches.createIndex(rows,'2026-10-07').dateFor(product),'2026-11-05');
  rows[0].launchDate='2026-12-01';
  assert.equal(launches.createIndex(rows,'2026-10-07').dateFor(product),'2026-12-01');
  assert.equal(launches.createIndex([],'2026-10-07').dateFor(product),'');
});
test('due arithmetic and Singapore day boundaries do not depend on host timezone',()=>{
  assert.equal(launches.todayISO(new Date('2026-10-06T16:01:00Z')),'2026-10-07');
  assert.equal(launches.shiftDate('2026-11-05',-30),'2026-10-06');
  assert.equal(launches.daysUntilDue('2026-11-05','2026-10-07'),-1);
  assert.equal(launches.daysUntilDue('invalid','2026-10-07'),null);
  assert.equal(launches.shiftDate('2024-03-01',-1),'2024-02-29');
});
