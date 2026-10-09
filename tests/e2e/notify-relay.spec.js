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

test('linesheet summary ignores a pasted webhook URL', async ({ page }) => {
  const external = await openPage(page, '/btv_calendar_linesheet_files/linesheet.html');
  await page.evaluate(function () {
    window.BTV_SUPABASE_CONFIG = { url: 'http://127.0.0.1:4173', anonKey: 'anon-test' };
    window.btvAccessToken = function () { return 'editor-token'; };
  });
  const posted = await page.evaluate(async function (attack) {
    const calls = [];
    window.fetch = function (url, init) {
      calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, disabled: false }); } });
    };
    await window.btvSendTeamsSummary(attack, 'Hello from linesheet');
    return calls;
  }, ATTACK);
  expect(posted.map(function (call) { return call.url; })).toEqual([NOTIFY]);
  expect(posted[0].body).not.toContain(ATTACK);
  expect(external.join('\n')).not.toContain('example.test');
  expect(external.join('\n')).not.toContain('supabase.co');
});

test('management calendar summary ignores a pasted webhook URL', async ({ page }) => {
  await openPage(page, '/btv_calendar_linesheet_files/input%20calendar-2026.html');
  await page.evaluate(function () {
    window.BTV_SUPABASE_CONFIG = { url: 'http://127.0.0.1:4173', anonKey: 'anon-test' };
    window.btvAccessToken = function () { return 'editor-token'; };
  });
  const posted = await page.evaluate(async function (attack) {
    const calls = [];
    window.fetch = function (url, init) {
      calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, disabled: false }); } });
    };
    await window.btvSendTeamsSummary(attack, 'Hello from calendar');
    return calls;
  }, ATTACK);
  expect(posted.map(function (call) { return call.url; })).toEqual([NOTIFY]);
  expect(JSON.parse(posted[0].body).channel).toBe('calendar');
});

test('global calendar ignores a stored webhook URL', async ({ page }) => {
  await openPage(page, '/btv_calendar_linesheet_files/global%20calendar.html');
  await page.evaluate(function () {
    window.BTV_SUPABASE_CONFIG = { url: 'http://127.0.0.1:4173', anonKey: 'anon-test' };
    window.btvAccessToken = function () { return 'editor-token'; };
    localStorage.setItem('ccWebhookPublished', 'https://example.test/attacker-hook');
  });
  const posted = await page.evaluate(async function () {
    const calls = [];
    window.fetch = function (url, init) {
      calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, disabled: false }); } });
    };
    await window.ccSendMarketingWebhook(
      { status: 'published', title: 'Launch', market: 'SG', row: 'brand_events' },
      ['Created "Launch"'],
      'Ada'
    );
    return calls;
  });
  expect(posted.map(function (call) { return call.url; })).toEqual([NOTIFY]);
  expect(posted[0].body).not.toContain('example.test');
});
