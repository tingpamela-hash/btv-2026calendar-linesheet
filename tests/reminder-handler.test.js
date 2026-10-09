const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function fixture({ admin = false, secret } = {}) {
  const { authorizeReminder } = await import('../supabase/functions/linesheet-monday-reminder/authorization.mjs');
  const calls = [];
  const client = {
    auth: { getUser: async token => ({ data: { user: token === 'valid-token' ? { id:'fixture-user' } : null }, error:null }) },
    from: table => {
      calls.push(table);
      return { select: () => table === 'user_profiles'
        ? { eq: () => ({ single:async()=>({data:{is_admin:admin},error:null}) }) }
        : table === 'app_state'
          ? { eq:async()=>({data:[],error:null}) }
          : Promise.resolve({data:[],error:null})
      };
    },
  };
  let handler;
  const secrets = { SUPABASE_URL:'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY:'fixture-service',
    RESEND_API_KEY:'fixture-resend', BTV_REMINDER_CRON_SECRET:secret };
  const context = vm.createContext({
    Deno:{env:{get:key=>secrets[key]},serve:fn=>{handler=fn;}},
    createClient:()=>client, authorizeReminder, Response, Request, URL, TextEncoder,
    fetch:async()=>{throw new Error('Test must not send real email');},
  });
  const source = fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/linesheet-monday-reminder/index.ts'),'utf8');
  const withoutImports = source.replace(/^import .*;\r?$/gm, '');
  vm.runInContext(stripTypeScriptTypes(withoutImports),context);
  return {calls,request:(method,headers={})=>handler(new Request('https://fixture.invalid/reminder?ping=unapproved@example.invalid',{method,headers}))};
}

test('handler rejects public POST before loading products or recipients',async()=>{
  const f = await fixture();
  const r = await f.request('POST');
  assert.equal(r.status,403);
  assert.deepEqual(f.calls,[]);
});
test('handler only permits POST; CORS preflight cannot send mail',async()=>{
  const f = await fixture({admin:true});
  assert.equal((await f.request('GET',{authorization:'Bearer valid-token'})).status,405);
  const preflight = await f.request('OPTIONS');
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-headers'),'authorization, content-type');
  assert.deepEqual(f.calls,[]);
});
test('non-admin authenticated callers cannot load reminder data',async()=>{
  const f = await fixture();
  assert.equal((await f.request('POST',{authorization:'Bearer valid-token'})).status,403);
  assert.deepEqual(f.calls,['user_profiles']);
});
test('verified admin and scheduled secret reach only configured recipients; ping is gone',async()=>{
  for (const admin of [true,false]) {
    const secret = 's'.repeat(48);
    const f = await fixture({admin,secret});
    const headers = admin ? {authorization:'Bearer valid-token'} : {'x-btv-reminder-secret':secret};
    const r = await f.request('POST',headers);
    assert.equal(r.status,200);
    assert.equal((await r.json()).ok,true);
    assert.ok(f.calls.includes('linesheet_products'));
    assert.ok(f.calls.includes('app_state'));
  }
});
