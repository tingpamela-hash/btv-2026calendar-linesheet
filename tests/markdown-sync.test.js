const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const md=require('../js/markdown-calendar');
const source=fs.readFileSync(require.resolve('../js/markdown-sync'),'utf8');

function fixture(){
  const cache=new Map(),events=new Map(),polls=new Map();let renders=0;
  const client={read:async()=>({legacy:{},rows:[]})};
  const context={BtvMarkdown:{...md,createClient:()=>client},CAL_YEAR:2026,document:{hidden:false},console:{warn(){}},
    location:{pathname:'/input%20calendar-2026.html'},_btvCanEdit:true,btvGetCurrentActor:()=>({id:'A'}),
    _btvSb:{channel(){throw new Error('No realtime');}},btvMarkdownOnChange(){renders++;},
    localStorage:{getItem:key=>cache.get(key) ?? null,setItem:(key,value)=>cache.set(key,value)},
    setInterval:callback=>{const id=polls.size+1;polls.set(id,callback);return id;},clearInterval:id=>polls.delete(id),
    addEventListener:(name,callback)=>events.set(name,callback)};
  context.window=context;vm.runInNewContext(source,context);
  return {context,client,cache,events,polls,renders:()=>renders};
}
const row=(title,stamp='2026-10-09T10:00:00.000Z')=>({id:'markdown::2026::sale',section:'markdown',year:2026,
  updated_at:stamp,data:{id:'sale',title}});

test('polling and online reconnection refresh Markdown when realtime is unavailable; unchanged reads do not render',async()=>{
  const f=fixture();await f.context.btvMarkdownInit();const initial=f.renders();
  await f.context.btvMarkdownReload();assert.equal(f.renders(),initial);
  f.client.read=async()=>({legacy:{},rows:[row('Polled')]});await [...f.polls.values()][0]();
  assert.equal(f.context.btvMarkdownLoadLocal().sale.title,'Polled');
  f.client.read=async()=>({legacy:{},rows:[row('Reconnected','2026-10-09T11:00:00.000Z')]});await f.events.get('online')();
  assert.equal(f.context.btvMarkdownLoadLocal().sale.title,'Reconnected');
});

test('late snapshots and stale realtime events cannot overwrite a confirmed newer row',async()=>{
  const f=fixture();await f.context.btvMarkdownInit();let complete;
  f.client.read=()=>new Promise(resolve=>complete=resolve);const pending=f.context.btvMarkdownReload();
  f.context.btvMarkdownCacheRow(row('Fresh'));
  complete({legacy:{},rows:[row('Old','2026-10-09T09:00:00.000Z')]});await pending;
  f.context.btvMarkdownCacheRow(row('Old','2026-10-09T09:00:00.000Z'));
  assert.equal(f.context.btvMarkdownLoadLocal().sale.title,'Fresh');
});

test('year switching and teardown ignore pending snapshots from an inactive year or module',async()=>{
  const f=fixture();await f.context.btvMarkdownInit();let complete;
  f.client.read=()=>new Promise(resolve=>complete=resolve);const pending=f.context.btvMarkdownReload();
  f.context.CAL_YEAR=2027;complete({legacy:{},rows:[row('Wrong year')]});await pending;
  assert.equal(f.cache.get(md.cacheKey(2026)),'[]');
  const suspended=f.context.btvMarkdownReload();f.context.btvMarkdownTeardown();
  complete({legacy:{unexpected:{id:'unexpected'}},rows:[]});await suspended;
  assert.equal(f.cache.has(md.cacheKey(2027)),false);assert.equal(f.polls.size,0);
});

test('failed shared reads preserve the last known cache rather than clearing existing Markdown',async()=>{
  const f=fixture();await f.context.btvMarkdownInit();f.context.btvMarkdownCacheRow(row('Keep me'));
  f.client.read=async()=>{throw new Error('Offline');};await f.context.btvMarkdownReload();
  assert.equal(f.context.btvMarkdownLoadLocal().sale.title,'Keep me');
});
