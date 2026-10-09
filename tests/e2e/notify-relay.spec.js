const { test, expect } = require('@playwright/test');

const ATTACK = 'https://example.test/attacker-hook';
const NOTIFY = 'http://127.0.0.1:4173/functions/v1/notify-teams';

async function openPage(page, file) {
  const external = [];
  await page.route('**/*', function (route) {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:4173/')) return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(file);
  return external;
}

async function arm(page) {
  await page.evaluate(function () {
    window.BTV_SUPABASE_CONFIG = { url: 'http://127.0.0.1:4173', anonKey: 'anon-test' };
    window._btvSb = {
      auth: {
        getSession: function () {
          return Promise.resolve({ data: { session: { access_token: 'editor-token' } } });
        }
      }
    };
    window.__btvNotifyCalls = [];
    window.fetch = function (url, init) {
      window.__btvNotifyCalls.push({
        url: String(url),
        body: init && init.body ? String(init.body) : '',
        authorization: init && init.headers ? String(init.headers.Authorization || '') : ''
      });
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, disabled: false }); } });
    };
  });
}

test('linesheet summary ignores a pasted webhook URL', async ({ page }) => {
  const external = await openPage(page, '/btv_calendar_linesheet_files/linesheet.html');
  await arm(page);
  const calls = await page.evaluate(async function (attack) {
    await window.btvSendTeamsSummary(attack, 'Hello from linesheet');
    return window.__btvNotifyCalls;
  }, ATTACK);
  expect(calls.map(function (call) { return call.url; })).toEqual([NOTIFY]);
  expect(calls[0].authorization).toBe('Bearer editor-token');
  expect(calls[0].body).not.toContain(ATTACK);
  expect(external.join('\n')).not.toContain('example.test');
  expect(external.join('\n')).not.toContain('supabase.co');
});

test('management calendar summary ignores a pasted webhook URL', async ({ page }) => {
  await openPage(page, '/btv_calendar_linesheet_files/input%20calendar-2026.html');
  await arm(page);
  const calls = await page.evaluate(async function (attack) {
    await window.btvSendTeamsSummary(attack, 'Hello from calendar');
    return window.__btvNotifyCalls;
  }, ATTACK);
  expect(calls.map(function (call) { return call.url; })).toEqual([NOTIFY]);
  expect(calls[0].authorization).toBe('Bearer editor-token');
  expect(JSON.parse(calls[0].body).channel).toBe('calendar');
});

test('global calendar ignores a stored webhook URL', async ({ page }) => {
  await openPage(page, '/btv_calendar_linesheet_files/global%20calendar.html');
  await page.evaluate(function () {
    localStorage.setItem('ccWebhookPublished', 'https://example.test/attacker-hook');
  });
  await arm(page);
  const calls = await page.evaluate(async function () {
    await window.ccSendMarketingWebhook(
      { status: 'published', title: 'Launch', market: 'SG', row: 'brand_events' },
      ['Created "Launch"'],
      'Ada'
    );
    return window.__btvNotifyCalls;
  });
  expect(calls.map(function (call) { return call.url; })).toEqual([NOTIFY]);
  expect(calls[0].authorization).toBe('Bearer editor-token');
  expect(calls[0].body).not.toContain('example.test');
});
