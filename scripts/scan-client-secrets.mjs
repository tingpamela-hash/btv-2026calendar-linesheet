import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const SKIP = new Set([
  'node_modules', 'tests', 'docs', '.git', 'dist', '.github'
]);
const EXT = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.svg', '.ts']);
const RULES = [
  ['power-automate-trigger', 'powerautomate/' + 'automations/direct'],
  ['webhook-signature', new RegExp('[?&]' + 'sig=' + '[A-Za-z0-9_-]{8,}', 'i')],
  ['manual-trigger-scope', 'sp=' + '%2Ftriggers' + '%2Fmanual'],
  ['manual-trigger-scope', 'sp=' + '/triggers' + '/manual']
];

function walk(dir, out) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    return;
  }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
}

function scanRoot(root) {
  const files = [];
  walk(root, files);
  const hits = [];
  for (const file of files) {
    if (!EXT.has(extname(file).toLowerCase())) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      continue;
    }
    const lower = text.toLowerCase();
    for (const [name, rule] of RULES) {
      const matched = typeof rule === 'string' ? lower.includes(rule.toLowerCase()) : rule.test(text);
      if (matched) hits.push(relative(root, file).split('\\').join('/') + ' ' + name);
      if (rule && rule.lastIndex) rule.lastIndex = 0;
    }
  }
  return hits;
}

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = args[i + 1] || root;
  }
  const hits = scanRoot(root);
  for (const hit of hits) console.log(hit);
  console.log('hits=' + hits.length);
  process.exit(hits.length ? 1 : 0);
}

main();
