'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const linesheetPath = path.join(root, 'btv_calendar_linesheet_files', 'linesheet.html');
const calendarPath = path.join(root, 'btv_calendar_linesheet_files', 'input calendar-2026.html');
const globalPath = path.join(root, 'btv_calendar_linesheet_files', 'global calendar.html');
const NOTIFY = 'https://planner.example/functions/v1/notify-teams';
const SESSION_TOKEN = 'session-access-token';

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

function loadWired(file, fnName, session) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<script src="\.\.\/js\/notify-relay\.js"><\/script>/);
  const calls = [];
  const alerts = [];
  const sandbox = {
    fetch: function (url, init) {
      calls.push({
        url: String(url),
        authorization: init && init.headers ? String(init.headers.Authorization || init.headers.authorization || '') : '',
        body: init && init.body ? String(init.body) : ''
      });
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ ok: true, disabled: false }); }
      });
    },
    localStorage: {
      getItem: function () { return null; },
      setItem: function () {},
      removeItem: function () {}
    },
    BTV_SUPABASE_CONFIG: { url: 'https://planner.example', anonKey: 'anon-test' },
    _btvSb: {
      auth: {
        getSession: function () {
          return Promise.resolve({ data: { session: session } });
        }
      }
    },
    alert: function (message) { alerts.push(String(message)); },
    console: console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const relay = fs.readFileSync(path.join(root, 'js', 'notify-relay.js'), 'utf8');
  vm.runInContext(relay + '\n' + extractFunction(html, fnName), sandbox);
  assert.equal(typeof sandbox.btvAccessToken, 'undefined');
  return { sandbox: sandbox, calls: calls, alerts: alerts };
}

test('linesheet posts the session access token without a btvAccessToken stub', async () => {
  const loaded = loadWired(linesheetPath, 'btvSendTeamsSummary', { access_token: SESSION_TOKEN });
  await loaded.sandbox.btvSendTeamsSummary('https://example.test/attacker-hook', 'Hello from linesheet');
  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].url, NOTIFY);
  assert.equal(loaded.calls[0].authorization, 'Bearer ' + SESSION_TOKEN);
  assert.equal(loaded.calls[0].body.includes('example.test'), false);
});

test('management calendar posts the session access token without a btvAccessToken stub', async () => {
  const loaded = loadWired(calendarPath, 'btvSendTeamsSummary', { access_token: SESSION_TOKEN });
  await loaded.sandbox.btvSendTeamsSummary('https://example.test/attacker-hook', 'Hello from calendar');
  assert.equal(loaded.calls[0].authorization, 'Bearer ' + SESSION_TOKEN);
  assert.equal(JSON.parse(loaded.calls[0].body).channel, 'calendar');
});

test('global calendar posts the session access token without a btvAccessToken stub', async () => {
  const loaded = loadWired(globalPath, 'ccSendMarketingWebhook', { access_token: SESSION_TOKEN });
  await loaded.sandbox.ccSendMarketingWebhook(
    { status: 'published', title: 'Launch', market: 'SG', row: 'brand_events' },
    ['Created "Launch"'],
    'Ada'
  );
  assert.equal(loaded.calls[0].authorization, 'Bearer ' + SESSION_TOKEN);
  assert.equal(JSON.parse(loaded.calls[0].body).channel, 'calendar');
});

test('a frame uses its own session when the parent token is different', async () => {
  const loaded = loadWired(linesheetPath, 'btvSendTeamsSummary', { access_token: 'iframe-token' });
  loaded.sandbox.parent = { btvAccessToken: function () { return 'parent-token'; } };
  await loaded.sandbox.btvSendTeamsSummary('https://example.test/attacker-hook', 'Hello from the frame');
  assert.equal(loaded.calls[0].authorization, 'Bearer iframe-token');
});

test('a missing session shows a message and does not post', async () => {
  const loaded = loadWired(linesheetPath, 'btvSendTeamsSummary', null);
  const result = await loaded.sandbox.btvSendTeamsSummary('https://example.test/attacker-hook', 'Hello from linesheet');
  assert.equal(result, false);
  assert.equal(loaded.calls.length, 0);
  assert.equal(loaded.alerts.length > 0, true);
});

test('no page calls btvAccessToken', () => {
  const pages = [linesheetPath, calendarPath, globalPath, path.join(root, 'index.html')];
  pages.forEach(function (file) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('btvAccessToken'), false, file);
  });
  const relay = fs.readFileSync(path.join(root, 'js', 'notify-relay.js'), 'utf8');
  assert.equal(relay.includes('btvAccessToken'), false);
});
