const {test}=require('node:test');
const assert=require('node:assert/strict');
const events=require('../js/creative-events');
const range={start:'2026-10-06',end:'2026-10-08'};
test('publication is independent of production status and preserves legacy visibility',()=>{
  for(const status of ['Not Started','In Progress','In Review','Approved','Delivered']){
    assert.equal(events.publication({status}),'published');
    assert.equal(events.publication({status,workflowStatus:'draft'}),'draft');
    assert.equal(events.publication({status,workflowStatus:'published'}),'published');
  }
  assert.equal(events.publication({workflowStatus:'unknown'}),'draft');
});
test('matching copies consolidate without identity, market or audit metadata',()=>{
  const a={id:'a',market:'SG',row:'ig_grid',title:' Campaign ',brief:'Brief',links:['asset'],created:'old',updatedActor:{id:'editor-a',email:'a@example.test'},_btvOperationId:'save-a'};
  const b={...a,id:'b',market:'TH',title:'campaign',created:'new',_seeded:true,updatedActor:{id:'editor-b',email:'b@example.test'},_btvOperationId:'save-b'};
  assert.equal(events.fingerprint(a,range),events.fingerprint(b,range));
});
test('different content, channels, dates, attachments and delimiter values stay separate',()=>{
  const a={title:'Campaign',row:'ig_grid',brief:'Brief',links:['one'],images:[{url:'a',name:'A'}]};
  for(const patch of [{brief:'Other'},{row:'tiktok'},{links:['two']},{images:[{url:'b',name:'A'}]},{notes:'Different'}]) assert.notEqual(events.fingerprint(a,range),events.fingerprint({...a,...patch},range));
  assert.notEqual(events.fingerprint(a,range),events.fingerprint(a,{...range,end:'2026-10-09'}));
  assert.notEqual(events.fingerprint({title:'a|b',brief:'c'},range),events.fingerprint({title:'a',brief:'b|c'},range));
});
test('object key order and line endings do not fork identical events',()=>{
  assert.equal(events.fingerprint({brief:'a\r\nb',images:[{url:'a',name:'A'}]},range),events.fingerprint({images:[{name:'A',url:'a'}],brief:'a\nb'},range));
});
test('duplication preserves duration through month, leap day and year changes',()=>{
  assert.deepEqual(events.shiftedRange('2026-10-06','2026-10-08','2026-10-20'),{start:'2026-10-20',end:'2026-10-22'});
  assert.equal(events.shiftedRange('2024-02-28','2024-03-01','2026-12-30').end,'2027-01-01');
  assert.equal(events.shiftedRange('2026-10-06','','2026-10-20').end,'2026-10-20');
  for(const args of [['2026-02-30','','2026-10-20'],['2026-10-08','2026-10-06','2026-10-20'],['2026-10-06','','invalid']]) assert.throws(()=>events.shiftedRange(...args));
});
test('overlapping spans keep all events and align the full row',()=>{
  const a={week:2,weekEnd:6,title:'Long'},b={week:4,weekEnd:5,title:'Overlap'},c={week:5,title:'Single'};
  const parts=events.segments([a,b,c],10);
  assert.equal(parts.reduce((sum,p)=>sum+p.end-p.start+1,0),10);
  for(let week=1;week<=10;week++){
    const part=parts.find(p=>p.start<=week&&p.end>=week);
    assert.deepEqual(part.groups,[a,b,c].filter(g=>g.week<=week&&(g.weekEnd||g.week)>=week));
  }
});
test('empty and clipped ranges remain aligned without mutating source groups',()=>{
  const groups=[{week:0,weekEnd:2},{week:9,weekEnd:15},{week:5,weekEnd:3}];
  const before=JSON.stringify(groups),parts=events.segments(groups,10);
  assert.equal(parts.reduce((sum,p)=>sum+p.end-p.start+1,0),10);
  assert.equal(JSON.stringify(groups),before);
  assert.equal(events.segments([],10).length,10);
});
