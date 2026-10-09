const test=require('node:test');
const assert=require('node:assert/strict');
const records=require('../js/calendar-records');
const entry={id:'event',market:'SG',title:'Original',date:'2026-10-09',row:'ig_grid'};
function database(){
  const tables=new Map(),locks=new Map();let fail=false,interrupt=false;
  const rows=name=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name);};
  function client(id){
    let actor={id,email:id+'@example.test',name:id+' User'},allowed=true;
    const sb={from(name){const q={op:'select',filters:{}};const b={select(){return b;},eq(key,value){q.filters[key]=value;return b;},
      maybeSingle(){q.single=true;return b;},insert(data){q.op='insert';q.data=data;return b;},update(data){q.op='update';q.data=data;return b;},delete(){q.op='delete';return b;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        const store=rows(name),matched=[...store.values()].filter(row=>Object.entries(q.filters).every(([key,value])=>row[key]===value));
        if(q.op==='select')return {data:structuredClone(q.single?(matched[0] || null):matched)};
        if(fail)return {error:{message:'Write rejected'}};
        if(q.op==='insert'){
          if(store.has(q.data[0].id))return {error:{code:'23505',message:'Duplicate ID'}};
          store.set(q.data[0].id,structuredClone(q.data[0]));
          if(interrupt)return {error:{message:'Response interrupted'}};
          return {data:structuredClone(q.data)};
        }
        if(q.op==='update')matched.forEach(row=>store.set(row.id,structuredClone(q.data)));
        if(q.op==='delete')matched.forEach(row=>store.delete(row.id));
        if(interrupt)return {error:{message:'Response interrupted'}};
        return {data:structuredClone(q.op==='update'?matched.map(()=>q.data):matched)};
      }).then(resolve,reject);}};return b;},rpc(name,args){return Promise.resolve({data:locks.get(args.p_id)===actor.id});}};
    return {api:records.createClient({sb,actor:()=>actor,canEdit:()=>allowed,timeout:20}),setActor:value=>actor=value,setAllowed:value=>allowed=value};
  }
  return {rows,locks,client,setFail:value=>fail=value,setInterrupt:value=>interrupt=value};
}
for(const table of ['global_cal_entries','marketing_entries']){
  test(table+': simultaneous stale saves have one winner and retain the winner',async()=>{
    const db=database(),a=db.client('A').api,b=db.client('B').api;
    const baseline=await a.commit(a.prepare(table,entry,null));
    const first=a.prepare(table,{...entry,title:'A save'},baseline),second=b.prepare(table,{...entry,title:'B save'},baseline);
    const results=await Promise.allSettled([a.commit(first),b.commit(second)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'conflict');
    assert.equal(db.rows(table).get(entry.id).data.title,'A save');
    assert.equal(db.rows(table).get(entry.id).data.updatedActor.id,'A');
  });
  test(table+': deletes cannot remove a newer save; saves cannot resurrect a deleted row',async()=>{
    const db=database(),a=db.client('A').api;
    const baseline=await a.commit(a.prepare(table,entry,null));
    const fresh=await a.commit(a.prepare(table,{...entry,title:'Newer'},baseline));
    await assert.rejects(()=>a.commit(a.prepare(table,entry,baseline,true)),{code:'conflict'});
    await a.commit(a.prepare(table,fresh.data,fresh,true));
    await assert.rejects(()=>a.commit(a.prepare(table,{...entry,title:'Resurrected'},fresh)),{code:'conflict'});
    assert.equal(db.rows(table).size,0);
  });
}
test('different records and market moves save independently without deleting another row',async()=>{
  const db=database(),a=db.client('A').api;
  const first=await a.commit(a.prepare('global_cal_entries',entry,null));
  await a.commit(a.prepare('global_cal_entries',{...entry,id:'other'},null));
  await a.commit(a.prepare('global_cal_entries',{...entry,market:'TH'},first));
  assert.equal(db.rows('global_cal_entries').size,2);assert.equal(db.rows('global_cal_entries').get('event').market,'TH');
});
test('interrupted confirmed writes retry with the same operation ID and do not duplicate',async()=>{
  const db=database(),a=db.client('A').api;db.setInterrupt(true);
  const attempt=a.prepare('global_cal_entries',entry,null),saved=await a.commit(attempt);
  assert.equal(saved.data._btvOperationId,attempt.row.data._btvOperationId);
  await a.commit(attempt);assert.equal(db.rows('global_cal_entries').size,1);
});
test('failed writes retain the unchanged authoritative row and prepared retries preserve the original version',async()=>{
  const db=database(),a=db.client('A').api;
  const baseline=await a.commit(a.prepare('global_cal_entries',entry,null));
  const attempt=a.prepare('global_cal_entries',{...entry,title:'Retry'},baseline);
  db.setFail(true);await assert.rejects(()=>a.commit(attempt),/Write rejected/);
  assert.equal(db.rows('global_cal_entries').get('event').data.title,'Original');
  db.setFail(false);await a.commit(attempt);assert.equal(db.rows('global_cal_entries').get('event').data.title,'Retry');
});
test('unknown baselines, malformed identities, viewers and identity changes fail closed',async()=>{
  const db=database(),a=db.client('A');
  assert.throws(()=>a.api.prepare('global_cal_entries',entry,undefined),{code:'conflict'});
  assert.throws(()=>a.api.prepare('global_cal_entries',{...entry,id:''},null),/identity/);
  const attempt=a.api.prepare('global_cal_entries',entry,null);
  a.setActor({id:'B'});await assert.rejects(()=>a.api.commit(attempt),/different signed-in/);
  a.setAllowed(false);assert.throws(()=>a.api.prepare('global_cal_entries',entry,null),/permission/);
  assert.equal(db.rows('global_cal_entries').size,0);
});
test('Management updates/deletes need confirmed ownership and derive year from the date, not a boundary week',async()=>{
  const db=database(),a=db.client('A').api;
  const launch={id:'launch',section:'global',weekId:'2025-12-29',launchDate:'2026-01-01',launchTitle:'Launch'};
  const baseline=await a.commit(a.prepare('calendar_entries',launch,null));assert.equal(baseline.year,2026);
  await assert.rejects(()=>a.commit(a.prepare('calendar_entries',{...launch,launchTitle:'Denied'},baseline)),/lock was released/);
  db.locks.set('launch','A');const saved=await a.commit(a.prepare('calendar_entries',{...launch,launchTitle:'Allowed'},baseline));
  db.locks.set('launch','B');await assert.rejects(()=>a.commit(a.prepare('calendar_entries',saved.data,saved,true)),/lock was released/);
  assert.equal(db.rows('calendar_entries').get('launch').data.launchTitle,'Allowed');
});
test('stalled shared reads have a deadline',async()=>{
  const sb={from(){return {select(){return this;},eq(){return this;},maybeSingle(){return new Promise(()=>{});}};}};
  const api=records.createClient({sb,actor:()=>({id:'A'}),canEdit:()=>true,timeout:10});
  await assert.rejects(()=>api.read('global_cal_entries','event'),/timed out/);
});
