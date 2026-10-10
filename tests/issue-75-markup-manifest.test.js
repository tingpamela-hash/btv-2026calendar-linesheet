'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('the publish manifest lists every local script the pages load', () => {
  const manifest = JSON.parse(read('site-files.json'));
  const listed = new Set(manifest.files.map(function (file) { return file.path; }));
  const missing = [];
  ['index.html', 'btv_calendar_linesheet_files/linesheet.html', 'btv_calendar_linesheet_files/global calendar.html', 'btv_calendar_linesheet_files/input calendar-2026.html'].forEach(function (page) {
    const html = read(page);
    html.replace(/src="(?:\.\.\/)?(js\/[^"]+)"/g, function (_all, src) {
      if (!listed.has(src)) missing.push(page + ' ' + src);
      return _all;
    });
  });
  assert.deepEqual(missing, []);
});

test('stored names, prices, errors, and markdown ids are escaped before HTML', () => {
  const linesheet = read('btv_calendar_linesheet_files/linesheet.html');
  const input = read('btv_calendar_linesheet_files/input calendar-2026.html');
  const global = read('btv_calendar_linesheet_files/global calendar.html');
  assert.equal(linesheet.includes(' + name + loc'), false);
  assert.equal(linesheet.includes(' + names + '), false);
  assert.equal(linesheet.includes('escapeHtml(res.error.message || res.error.code)'), true);
  assert.equal(input.includes("innerHTML = '🔒 <strong>' + _btvMdHolder +"), false);
  assert.equal(input.includes("openMarkdownEditor('${md.id}')"), false);
  assert.equal(input.includes('${r.priority}'), false);
  assert.equal(input.includes('${r.sgdRrp'), false);
  assert.equal(global.includes('${GROUP_LABELS[row.group]||row.group}'), false);
  assert.equal(linesheet.includes('escapeHtml(name)'), true);
  assert.equal(linesheet.includes('escapeHtml(names)'), true);
  assert.equal(input.includes('esc(_btvMdHolder)'), true);
  assert.equal(input.includes('this.dataset.markdownId'), true);
});
