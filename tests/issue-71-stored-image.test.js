'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const linesheetPath = path.join(root, 'btv_calendar_linesheet_files', 'linesheet.html');

function loadAllowlist() {
  const sandbox = {
    BTV_SUPABASE_CONFIG: { url: 'https://fixture.supabase.co', anonKey: 'anon-test' }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'safe-url.js'), 'utf8'), sandbox);
  return sandbox;
}

test('stored image urls allow https storage hosts and object paths only', () => {
  const api = loadAllowlist();
  assert.equal(typeof api.safeStoredImageUrl, 'function');
  const good = 'https://fixture.supabase.co/storage/v1/object/public/creative-marketing/photo.png';
  assert.equal(api.safeStoredImageUrl(good), good);
  assert.equal(api.safeStoredImageUrl('marketing/photo.png'), 'marketing/photo.png');
  assert.equal(api.safeStoredImageUrl('javascript:alert(1)'), '');
  assert.equal(api.safeStoredImageUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(api.safeStoredImageUrl('data:image/svg+xml,<svg onload=alert(1)>'), '');
  assert.equal(api.safeStoredImageUrl('"><img src=x id="pwn">'), '');
  assert.equal(api.safeStoredImageUrl("https://fixture.supabase.co/a.png?q='><script>"), '');
  assert.equal(api.safeStoredImageUrl('https://evil.test/photo.png'), '');
  assert.equal(api.safeStoredImageUrl('http://fixture.supabase.co/photo.png'), '');
});

test('linesheet does not put productImg or lookbookImg into innerHTML', () => {
  const html = fs.readFileSync(linesheetPath, 'utf8');
  assert.equal(html.includes('src="${p.productImg}"'), false);
  assert.equal(html.includes('src="${p.lookbookImg}"'), false);
  assert.equal(html.includes('src="\'+escapeHtml(p.productImg)'), false);
  assert.equal(html.includes('src="\'+escapeHtml(p.lookbookImg)'), false);
  assert.equal(html.includes('src="${e.target.result}"'), false);
  assert.equal(html.includes("${createImageBoxHTML('product'"), false);
  assert.equal(html.includes("${createImageBoxHTML('lookbook'"), false);
});
