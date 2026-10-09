const test=require('node:test');
const assert=require('node:assert/strict');
const md=require('../js/markdown-calendar');
const entry={id:'sale',title:' Sale ',startDate:'2026-10-09',endDate:'2026-10-11',markets:['TH','SG'],stores:{SG:['NAC','NAC'],TH:[]}};
test('markdown validation normalizes stores and derives duration and weekends',()=>{
  const value=md.validate(entry,2026);
  assert.equal(value.title,'Sale');assert.equal(value.days,3);assert.equal(value.weekendDays,2);
  assert.deepEqual(value.markets,['SG','TH']);assert.deepEqual(value.stores,{SG:['NAC'],TH:[]});
  assert.equal(md.scope(value),'SG: NAC | TH: All stores');
  assert.equal(entry.title,' Sale ');
});
test('invalid markdown dates, missing title and missing markets reject without modifying input',()=>{
  for(const changes of [{title:''},{markets:[]},{startDate:'2026-02-30'},{endDate:'2026-10-08'},{endDate:'2027-01-01'}])assert.throws(()=>md.validate({...entry,...changes},2026));
});
test('row snapshots override legacy records and tombstones do not resurrect deleted markdowns',()=>{
  const legacy={sale:entry,other:{...entry,id:'other'}};
  const rows=[{section:'markdown',data:{...entry,title:'Updated'}},{section:'markdown',data:{id:'other',deleted:true}},{section:'global',data:{id:'sale',title:'Wrong'}}];
  const merged=md.merge(legacy,rows);assert.equal(merged.sale.title,'Updated');assert.equal(merged.other,undefined);assert.ok(legacy.other);
});
function backend(){
  const rows=new Map(),locks=new Map();let failWrites=false,failRpc=false,interrupted=false;
  function client(user,canEdit=true){
    const sb={from(){
      const q={op:'select',filters:{}};
      const b={select(){return b;},eq(k,v){q.filters[k]=v;return b;},maybeSingle(){q.single=true;return b;},
        upsert(data,options){q.op='upsert';q.data=data;q.options=options;return b;},insert(data){q.op='insert';q.data=data;return b;},
        update(data){q.op='update';q.data=data;return b;},then(resolve,reject){return Promise.resolve().then(()=>{
          const matched=[...rows.values()].filter(r=>Object.entries(q.filters).every(([k,v])=>r[k]===v));
          if(q.op!=='select' && failWrites)return {error:{message:'Fixture write failure'}};
          if(q.op==='upsert'||q.op==='insert'){
            for(const row of q.data){
              if(rows.has(row.id)){if(q.options?.ignoreDuplicates)continue;return {error:{message:'Duplicate ID'}};}
              rows.set(row.id,structuredClone(row));
            }
            if(interrupted)return {error:{message:'Fixture interrupted response'}};
            return {data:structuredClone(q.data),error:null};
          }
          if(q.op==='update'){
            if(matched.some(row=>locks.get(row.id)!==user))return {error:{message:'Locked'}};
            matched.forEach(row=>rows.set(row.id,structuredClone(q.data)));
            return {data:matched.length?[structuredClone(q.data)]:[],error:null};
          }
          return {data:q.single?structuredClone(matched[0] || null):structuredClone(matched),error:null};
        }).then(resolve,reject);}};return b;
    },async rpc(name,args){
      if(failRpc)return {error:{message:'Fixture lock failure'}};
      if(name==='try_lock_calendar_entry'){
        if(locks.has(args.p_id)&&locks.get(args.p_id)!==user)return {data:false};
        locks.set(args.p_id,user);rows.get(args.p_id).locked_by_email=user+'@example.test';return {data:true};
      }
      if(name==='refresh_calendar_entry_lock')return {data:locks.get(args.p_id)===user};
      if(locks.get(args.p_id)===user)locks.delete(args.p_id);return {data:true};
    }};
    return md.createClient({sb,actor:()=>({id:user,email:user+'@example.test',name:user+' User'}),canEdit:()=>canEdit,timeout:50});
  }
  return {rows,locks,client,setFailWrites:value=>failWrites=value,setFailRpc:value=>failRpc=value,setInterrupted:value=>interrupted=value};
}
test('different markdown edits persist independently and audit actor/field changes',async()=>{
  const db=backend(),a=db.client('A'),b=db.client('B');
  const savedA=await a.save(entry,2026,null),savedB=await b.save({...entry,id:'other'},2026,null);
  assert.equal(db.rows.size,2);assert.equal(savedA.row.data.history[0].actor.id,'A');
  const opened=await a.acquire(savedA.row.data,2026);assert.ok(opened.acquired);
  const updated=await a.save({...opened.row.data,title:'Updated'},2026,opened.row);
  assert.equal(updated.changes[0].field,'Markdown Title');assert.equal(db.rows.get(savedB.row.id).data.title,'Sale');
});
test('second editor is denied and reloads the latest record after lock handover',async()=>{
  const db=backend(),a=db.client('A'),b=db.client('B');
  const first=await a.acquire(entry,2026);assert.ok(first.acquired);
  const denied=await b.acquire(entry,2026);assert.equal(denied.acquired,false);assert.equal(denied.email,'A@example.test');
  await a.save({...first.row.data,title:'Fresh save'},2026,first.row);await a.release(first.row.id);
  const handover=await b.acquire(entry,2026);assert.equal(handover.row.data.title,'Fresh save');
});
test('same-account stale baseline cannot overwrite a more recent save',async()=>{
  const db=backend(),a=db.client('A'),sameAccount=db.client('A');
  const first=await a.acquire(entry,2026),second=await sameAccount.acquire(entry,2026);
  await a.save({...first.row.data,title:'Authoritative'},2026,first.row);
  await assert.rejects(()=>sameAccount.save({...second.row.data,title:'Stale'},2026,second.row),/changed since/);
  assert.equal(db.rows.get(first.row.id).data.title,'Authoritative');
});
test('failed writes, missing lock RPC and lost ownership cannot publish or replace data',async()=>{
  const db=backend(),a=db.client('A'),opened=await a.acquire(entry,2026);
  db.setFailWrites(true);await assert.rejects(()=>a.save({...entry,title:'Unsaved'},2026,opened.row),/write failure/);
  assert.equal(db.rows.get(opened.row.id).data.title,' Sale ');
  db.setFailWrites(false);db.setFailRpc(true);await assert.rejects(()=>a.acquire(entry,2026),/lock failure/);
  db.setFailRpc(false);db.locks.set(opened.row.id,'B');await assert.rejects(()=>a.save(entry,2026,opened.row),/lock was released/);
});
test('deleting uses a version-checked tombstone and retains audit evidence',async()=>{
  const db=backend(),a=db.client('A'),opened=await a.acquire(entry,2026);
  const deleted=await a.save(entry,2026,opened.row,true);
  assert.equal(deleted.row.data.deleted,true);assert.equal(deleted.changes[0].field,'Markdown Deleted');
  assert.deepEqual(md.merge({sale:entry},[deleted.row]),{});
  await assert.rejects(()=>a.acquire(entry,2026),/removed/);
});
test('viewer cannot acquire locks or save',async()=>{
  const db=backend(),viewer=db.client('V',false);
  await assert.rejects(()=>viewer.acquire(entry,2026),/permission/);
  await assert.rejects(()=>viewer.save(entry,2026,null),/permission/);assert.equal(db.rows.size,0);
});

test('interrupted create response is confirmed by its operation ID without duplicating the record',async()=>{
  const db=backend(),a=db.client('A');db.setInterrupted(true);
  const saved=await a.save(entry,2026,null);
  assert.equal(db.rows.size,1);assert.equal(saved.row.data.history.length,1);
  assert.equal(saved.row.data.history[0].id,saved.row.data.changeId);
});

test('a never-resolving shared request times out without publishing a record',async()=>{
  const client=md.createClient({sb:{from(){return {select(){return this;},eq(){return this;},maybeSingle(){return new Promise(()=>{});}};}},
    actor:()=>({id:'A'}),canEdit:()=>true,timeout:10});
  await assert.rejects(()=>client.acquire(entry,2026),/timed out/);
});
