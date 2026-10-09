const { test } = require('node:test');
const assert = require('node:assert/strict');

function client({ admin = false, user = 'user-a', authError = null, profileError = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async token => { calls.push(['auth', token]); return { data: { user: user ? { id: user } : null }, error: authError }; } },
    from: table => ({ select: fields => ({ eq: (field, id) => ({ single: async () => {
      calls.push([table, fields, field, id]);
      return { data: { is_admin: admin }, error: profileError };
    } }) }) }),
  };
}

async function check(headers, options) {
  const { authorizeReminder } = await import('../supabase/functions/linesheet-monday-reminder/authorization.mjs');
  return authorizeReminder(new Request('https://example.invalid/reminder', { method: 'POST', headers }), options);
}

test('anonymous and malformed callers cannot trigger the reminder', async () => {
  const sb = client({ admin: true });
  for (const authorization of ['', 'Bearer', 'Basic abc', 'Bearer a b']) {
    assert.equal(await check({ authorization }, { client: sb }), false);
  }
  assert.deepEqual(sb.calls, []);
});

test('viewer and editor cannot send mail; a verified admin can', async () => {
  assert.equal(await check({ authorization: 'Bearer viewer' }, { client: client() }), false);
  const sb = client({ admin: true });
  assert.equal(await check({ authorization: 'Bearer admin-token' }, { client: sb }), true);
  assert.deepEqual(sb.calls, [['auth', 'admin-token'], ['user_profiles', 'is_admin', 'id', 'user-a']]);
});

test('invalid JWT, missing user and failed profile lookup fail closed', async () => {
  for (const opts of [{ admin: true, authError: 'invalid' }, { admin: true, user: null }, { admin: true, profileError: 'offline' }, { admin: 'true' }]) {
    assert.equal(await check({ authorization: 'Bearer token' }, { client: client(opts) }), false);
  }
  assert.equal(await check({ authorization: 'Bearer token' }, { client: { auth: { getUser: async () => { throw new Error('offline'); } } } }), false);
});

test('only an exact configured strong server-only cron secret is accepted', async () => {
  const secret = 'a'.repeat(48);
  const sb = client();
  assert.equal(await check({ 'x-btv-reminder-secret': secret }, { secret, client: sb }), true);
  for (const supplied of [secret.slice(1), secret + 'a', 'b'.repeat(48)]) {
    assert.equal(await check({ 'x-btv-reminder-secret': supplied }, { secret, client: sb }), false);
  }
  assert.equal(await check({ 'x-btv-reminder-secret': 'weak' }, { secret: 'weak', client: sb }), false);
  assert.equal(await check({ 'x-btv-reminder-secret': secret }, { client: sb }), false);
  assert.deepEqual(sb.calls, []);
});
