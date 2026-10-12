'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const BASE = 'e68a1c31eef13af9952001bb808b68811b877303';

function stripLiterals(line) {
  return line
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/\/(?:\\.|\[(?:\\.|[^\]])*\]|[^\/\n])+\/[dgimsuy]*/g, 'REGEX');
}

function commentLine(line) {
  const text = line.trim();
  if (!text) return false;
  if (/^\/\//.test(text) || /^\/\*/.test(text) || /^\*\//.test(text) || /^\*(?:\s|$)/.test(text)) return true;
  if (/^<!--/.test(text) || /^-->/.test(text)) return true;
  if (/^--(?:\s|$)/.test(text)) return true;
  const bare = stripLiterals(line);
  return bare.includes('//') || bare.includes('/*') || bare.includes('*/');
}

test('the diff from charmaine-base-2 adds no comment lines', () => {
  const diff = execFileSync('git', [
    'diff', '-U0', BASE, '--',
    '*.js', '*.html', '*.css', '*.sql', '*.mjs', '*.ts'
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const found = [];
  let file = '';
  diff.split('\n').forEach(function (row) {
    if (row.startsWith('+++ b/')) {
      file = row.slice(6);
      return;
    }
    if (!row.startsWith('+') || row.startsWith('+++')) return;
    const added = row.slice(1);
    if (commentLine(added)) found.push(file + ': ' + added.trim().slice(0, 160));
  });
  assert.deepEqual(found, []);
});
