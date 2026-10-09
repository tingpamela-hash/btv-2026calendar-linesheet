'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const vm = require('vm');

const root = path.join(__dirname, '..');
const scanner = path.join(root, 'scripts', 'scan-client-secrets.mjs');
const linesheetPath = path.join(root, 'btv_calendar_linesheet_files', 'linesheet.html');
const calendarPath = path.join(root, 'btv_calendar_linesheet_files', 'input calendar-2026.html');
const globalPath = path.join(root, 'btv_calendar_linesheet_files', 'global calendar.html');
const NOTIFY = 'https://planner.example/functions/v1/notify-teams';
const ATTACK = 'https://example.test/attacker-hook';

function fail(message, actual) {
  console.error('FAIL ' + message);
  if (actual !== undefined) console.error(JSON.stringify(actual));
  process.exit(1);
}

function assertEqual(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) fail(message + ' expected ' + right, actual);
}

function extractFunction(source, name) {
  const markers = ['async function ' + name + '(', 'function ' + name + '('];
  let start = -1;
  for (let i = 0; i < markers.length; i++) {
    const at = source.indexOf(markers[i]);
    if (at !== -1) {
      start = at;
      break;
    }
  }
  if (start < 0) throw new Error('missing function ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

function runScan(scanRoot) {
  return spawnSync(process.execPath, [scanner, '--root', scanRoot], { encoding: 'utf8' });
}

function fixtureUrl() {
  return 'https://example.invalid/'
    + 'powerautomate/automations/direct/workflows/test/triggers/manual/paths/invoke?'
    + 'sp=%2Ftriggers%2Fmanual%2Frun&sig='
    + 'fixture-only';
}

function scanFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btv-scan-'));
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<script>var u=' + JSON.stringify(fixtureUrl()) + ';</script>');
  const bad = runScan(dir);
  if (bad.status === 0) fail('scanner accepts a direct trigger URL', { status: bad.status });
  const text = (bad.stdout || '') + (bad.stderr || '');
  if (text.indexOf('fixture-only') !== -1) fail('scanner printed a signature value', null);
  if (text.indexOf('page.html power-automate-trigger') === -1) fail('scanner missed the trigger path', null);
  if (text.indexOf('page.html webhook-signature') === -1) fail('scanner missed the signature query', null);
  if (text.indexOf('page.html manual-trigger-scope') === -1) fail('scanner missed the manual scope', null);
  fs.writeFileSync(page, '<script>var u="https://planner.example/functions/v1/notify-teams";</script>');
  const clean = runScan(dir);
  assertEqual(clean.status, 0, 'scanner rejects a notify function URL');
  fs.rmSync(dir, { recursive: true, force: true });
}

function postPage(file, fnName, channel, token) {
  const html = fs.readFileSync(file, 'utf8');
  const calls = [];
  const store = {};
  const sandbox = {
    fetch: function (url, init) {
      calls.push({
        url: String(url),
        body: init && init.body ? String(init.body) : '',
        authorization: init && init.headers ? init.headers.Authorization || init.headers.authorization || '' : ''
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () { return Promise.resolve({ ok: true, disabled: false }); }
      });
    },
    localStorage: {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem: function (key, value) { store[key] = String(value); },
      removeItem: function (key) { delete store[key]; }
    },
    BTV_SUPABASE_CONFIG: { url: 'https://planner.example', anonKey: 'anon-test' },
    btvAccessToken: function () { return token || ''; },
    window: {},
    alert: function () {},
    console: console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const relayPath = path.join(root, 'js', 'notify-relay.js');
  const relay = fs.existsSync(relayPath) ? fs.readFileSync(relayPath, 'utf8') : '';
  vm.runInContext(relay + '\n' + extractFunction(html, fnName), sandbox);
  return { sandbox: sandbox, calls: calls, store: store };
}

async function clientIgnoresDestination() {
  const linesheet = postPage(linesheetPath, 'btvSendTeamsSummary', 'linesheet', 'editor-token');
  await linesheet.sandbox.btvSendTeamsSummary(ATTACK, 'Hello from linesheet');
  assertEqual(linesheet.calls.map(function (call) { return call.url; }), [NOTIFY], 'linesheet posts to the notify function');
  const lineBody = JSON.parse(linesheet.calls[0].body);
  assertEqual(lineBody.channel, 'linesheet', 'linesheet names the linesheet channel');
  assertEqual(lineBody.summary, 'Hello from linesheet', 'linesheet sends the summary text');
  assertEqual(Object.prototype.hasOwnProperty.call(lineBody, 'url'), false, 'linesheet body includes a destination');
  assertEqual(linesheet.calls[0].authorization, 'Bearer editor-token', 'linesheet sends the signed-in token');

  const signedOut = postPage(linesheetPath, 'btvSendTeamsSummary', 'linesheet', '');
  const skipped = await signedOut.sandbox.btvSendTeamsSummary(ATTACK, 'Hello from linesheet');
  assertEqual(skipped, false, 'signed-out linesheet reports success');
  assertEqual(signedOut.calls.length, 0, 'signed-out linesheet calls out');

  const calendar = postPage(calendarPath, 'btvSendTeamsSummary', 'calendar', 'editor-token');
  await calendar.sandbox.btvSendTeamsSummary(ATTACK, 'Hello from calendar');
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assertEqual(calendar.calls.map(function (call) { return call.url; }), [NOTIFY], 'calendar posts to the notify function');
  assertEqual(JSON.parse(calendar.calls[0].body).channel, 'calendar', 'calendar names the calendar channel');

  const field = postPage(linesheetPath, 'btvNotifyChange', 'linesheet', 'editor-token');
  await field.sandbox.btvNotifyChange(ATTACK, 'Linesheet', 'Tee', 'Name', 'A', 'B');
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assertEqual(field.calls.map(function (call) { return call.url; }), [NOTIFY], 'field change posts to the notify function');
  assertEqual(field.calls[0].body.indexOf(ATTACK) === -1, true, 'field change body includes the caller URL');

  const globalCal = postPage(globalPath, 'ccSendMarketingWebhook', 'calendar', 'editor-token');
  globalCal.store.ccWebhookPublished = ATTACK;
  await globalCal.sandbox.ccSendMarketingWebhook(
    { status: 'published', title: 'Launch', market: 'SG', row: 'brand_events' },
    ['Created "Launch"'],
    'Ada'
  );
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assertEqual(globalCal.calls.map(function (call) { return call.url; }), [NOTIFY], 'global calendar posts to the notify function');
  assertEqual(globalCal.calls[0].body.indexOf(ATTACK) === -1, true, 'global calendar body includes the caller URL');
  assertEqual(JSON.parse(globalCal.calls[0].body).channel, 'calendar', 'global calendar names the calendar channel');

  const prompt = postPage(linesheetPath, 'btvConfigLsWebhook', 'linesheet', '');
  prompt.store.btvLsWebhook = ATTACK;
  prompt.sandbox.BTV_LS_WEBHOOK_URL = ATTACK;
  prompt.sandbox.prompt = function () { return ATTACK; };
  prompt.sandbox.btvConfigLsWebhook();
  assertEqual(prompt.store.btvLsWebhook || '', '', 'prompt keeps a webhook URL');
  assertEqual(prompt.sandbox.BTV_LS_WEBHOOK_URL, '', 'prompt writes the webhook constant');
}

function repoScan() {
  const scanned = runScan(root);
  const text = (scanned.stdout || '') + (scanned.stderr || '');
  if (text.indexOf('fixture-only') !== -1 || text.indexOf('sig=') !== -1) {
    fail('repo scan printed a signature', null);
  }
  assertEqual(scanned.status, 0, 'client files still ship a trigger URL');
  assertEqual(text.trim().endsWith('hits=0'), true, 'client scan is not clean');
}

const DEST = 'https://contoso.environment.api.powerplatform.com/invoke';
const PROFILES = {
  'editor-1': { is_admin: false, can_edit_linesheet: true, can_edit_product_calendar: false, can_edit_global_calendar: false },
  'cal-1': { is_admin: false, can_edit_linesheet: false, can_edit_product_calendar: true, can_edit_global_calendar: false },
  'viewer-1': { is_admin: false, can_edit_linesheet: false, can_edit_product_calendar: false, can_edit_global_calendar: false },
  'admin-1': { is_admin: true, can_edit_linesheet: false, can_edit_product_calendar: false, can_edit_global_calendar: false }
};
const TOKENS = {
  'editor-jwt': 'editor-1',
  'calendar-jwt': 'cal-1',
  'viewer-jwt': 'viewer-1',
  'admin-jwt': 'admin-1'
};

function loadHandler(envOverrides) {
  const env = Object.assign({
    SUPABASE_URL: 'http://supabase.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    BTV_NOTIFY_WEBHOOK_URL: '',
    BTV_NOTIFY_HOST_ALLOWLIST: ''
  }, envOverrides || {});
  const sends = [];
  const sandbox = {
    Deno: { env: { get: function (name) { return Object.prototype.hasOwnProperty.call(env, name) ? env[name] : ''; } } },
    URL: URL,
    Response: Response,
    Map: Map,
    Date: Date,
    JSON: JSON,
    fetch: function (url, init) {
      sends.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    },
    createClient: function () {
      return {
        auth: {
          getUser: function (jwt) {
            const id = TOKENS[jwt];
            if (!id) return Promise.resolve({ data: { user: null }, error: { message: 'invalid jwt' } });
            return Promise.resolve({ data: { user: { id: id } }, error: null });
          }
        },
        from: function () {
          let id = '';
          const api = {
            select: function () { return api; },
            eq: function (_col, val) { id = val; return api; },
            maybeSingle: function () {
              return Promise.resolve({ data: PROFILES[id] || null, error: null });
            }
          };
          return api;
        }
      };
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let source = fs.readFileSync(path.join(root, 'supabase', 'functions', 'notify-teams', 'index.ts'), 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace('Deno.serve(async (req) => {', 'globalThis.__handler = async (req) => {');
  source = source.replace('\n});\n\nfunction notifyJson', '\n};\n\nfunction notifyJson');
  vm.runInContext('var createClient = globalThis.createClient;\n' + source, sandbox);
  if (typeof sandbox.__handler !== 'function') fail('notify function did not register an HTTP handler', null);
  return { handler: sandbox.__handler, sends: sends };
}

async function call(handler, method, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const init = { method: method, headers: headers };
  if (method !== 'GET' && method !== 'OPTIONS') init.body = JSON.stringify(body || {});
  const response = await handler(new Request('http://127.0.0.1/functions/v1/notify-teams', init));
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (err) { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

async function serverRelay() {
  const open = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: DEST });
  const anon = await call(open.handler, 'POST', '', { channel: 'linesheet', summary: 'Hello' });
  assertEqual({ status: anon.status, sent: open.sends.length }, { status: 401, sent: 0 }, 'signed-out notify forwards');

  const viewer = await call(open.handler, 'POST', 'viewer-jwt', { channel: 'linesheet', summary: 'Hello' });
  assertEqual({ status: viewer.status, sent: open.sends.length }, { status: 403, sent: 0 }, 'viewer notify forwards');

  const preflight = await call(open.handler, 'OPTIONS', '', null);
  assertEqual(preflight.status, 204, 'notify preflight status');
  assertEqual(open.sends.length, 0, 'notify preflight forwards');

  const wrongMethod = await call(open.handler, 'GET', 'editor-jwt', null);
  assertEqual(wrongMethod.status, 405, 'notify GET status');

  const disabled = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: '' });
  const off = await call(disabled.handler, 'POST', 'editor-jwt', { channel: 'linesheet', summary: 'Hello' });
  assertEqual(off.status, 200, 'missing server URL status');
  assertEqual(off.body, { ok: true, disabled: true }, 'missing server URL body');
  assertEqual(disabled.sends.length, 0, 'missing server URL forwards');

  const blockedHost = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: 'https://evil.example/hook' });
  const evil = await call(blockedHost.handler, 'POST', 'editor-jwt', { channel: 'linesheet', summary: 'Hello' });
  assertEqual({ status: evil.status, sent: blockedHost.sends.length }, { status: 500, sent: 0 }, 'unlisted host forwards');

  const httpHost = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: 'http://contoso.environment.api.powerplatform.com/invoke' });
  const insecure = await call(httpHost.handler, 'POST', 'editor-jwt', { channel: 'linesheet', summary: 'Hello' });
  assertEqual(insecure.status, 500, 'http destination status');
  assertEqual(httpHost.sends.length, 0, 'http destination forwards');

  const live = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: DEST });
  const wrongChannel = await call(live.handler, 'POST', 'editor-jwt', {
    channel: 'calendar',
    summary: 'Hello',
    url: ATTACK
  });
  assertEqual({ status: wrongChannel.status, sent: live.sends.length }, { status: 403, sent: 0 }, 'linesheet editor posts to calendar');

  const sent = await call(live.handler, 'POST', 'editor-jwt', {
    channel: 'linesheet',
    summary: 'Saved Tee',
    url: ATTACK
  });
  assertEqual(sent.status, 200, 'editor notify status');
  assertEqual(sent.body, { ok: true, disabled: false }, 'editor notify body');
  assertEqual(live.sends.map(function (row) { return row.url; }), [DEST], 'editor notify destination');
  const card = JSON.parse(live.sends[0].body);
  assertEqual(card.message, 'Saved Tee', 'forwarded card text');
  assertEqual(JSON.stringify(card).indexOf('example.test') === -1, true, 'forwarded card includes the caller URL');

  const calendarOnly = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: DEST });
  const cal = await call(calendarOnly.handler, 'POST', 'calendar-jwt', { channel: 'calendar', summary: 'Week saved' });
  assertEqual(cal.status, 200, 'calendar editor status');
  assertEqual(calendarOnly.sends.length, 1, 'calendar editor forwards once');
  const linesheetDenied = await call(calendarOnly.handler, 'POST', 'calendar-jwt', { channel: 'linesheet', summary: 'Nope' });
  assertEqual({ status: linesheetDenied.status, sent: calendarOnly.sends.length }, { status: 403, sent: 1 }, 'calendar editor posts a linesheet');

  const admin = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: DEST });
  const both = await call(admin.handler, 'POST', 'admin-jwt', { channel: 'linesheet', summary: 'Admin note' });
  assertEqual(both.status, 200, 'admin notify status');
  assertEqual(admin.sends.length, 1, 'admin notify forwards once');

  const limited = loadHandler({ BTV_NOTIFY_WEBHOOK_URL: DEST });
  for (let i = 0; i < 8; i++) {
    const row = await call(limited.handler, 'POST', 'editor-jwt', { channel: 'linesheet', summary: 'Note ' + i });
    assertEqual(row.status, 200, 'notify request ' + i + ' status');
  }
  const overflow = await call(limited.handler, 'POST', 'editor-jwt', { channel: 'linesheet', summary: 'Note overflow' });
  assertEqual(overflow.status, 429, 'ninth notify status');
  assertEqual(limited.sends.length, 8, 'ninth notify forwards');
}

async function main() {
  await clientIgnoresDestination();
  scanFixture();
  repoScan();
  await serverRelay();
  const report = {
    issue: 67,
    expected: { clientPosts: NOTIFY, hits: 0, unsigned: 401 },
    actual: { clientPosts: NOTIFY, hits: 0, unsigned: 401 }
  };
  console.log(JSON.stringify(report));
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
