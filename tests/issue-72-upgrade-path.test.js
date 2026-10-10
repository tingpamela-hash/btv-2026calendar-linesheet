'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const DB = 'btv_upgrade';
const BLOCKED = '77777777-7777-4777-8777-777777777777';
const docPath = path.join(root, 'docs', 'DEPLOY_ORDER.md');
const FLAGS = [
  'is_admin',
  'can_access_product_calendar',
  'can_access_global_calendar',
  'can_access_linesheet',
  'can_edit_product_calendar',
  'can_edit_global_calendar',
  'can_edit_linesheet'
];

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function redact(text) {
  return String(text || '')
    .replace(/sb_publishable_[A-Za-z0-9_]+/g, '[redacted-key]')
    .replace(/sb_secret_[A-Za-z0-9_]+/g, '[redacted-key]')
    .replace(/Bearer [A-Za-z0-9_\-\.]+/g, 'Bearer [redacted]')
    .replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, 'https://[redacted].supabase.co');
}

function sh(args, opts) {
  try {
    return execFileSync('sudo', args, Object.assign({ encoding: 'utf8' }, opts));
  } catch (error) {
    const detail = redact((error.stderr || '') + '\n' + (error.stdout || ''));
    const wrapped = new Error('psql failed: ' + detail.trim().split('\n')[0]);
    wrapped.detail = detail;
    throw wrapped;
  }
}

function psql(database, sql) {
  return sh(['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function psqlValue(database, sql) {
  return sh(['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-t', '-A'], {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}

function psqlFile(file) {
  sh(['-u', 'postgres', 'psql', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
    input: fs.readFileSync(file),
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function runFile(file) {
  try {
    psqlFile(file);
    return { ok: true, detail: '' };
  } catch (error) {
    return { ok: false, detail: error.detail || error.message };
  }
}

function upgradeFiles(doc) {
  const marker = '## B. Upgrade an existing BTV database';
  const start = doc.indexOf(marker);
  if (start < 0) fail('deploy doc has no upgrade path');
  const rest = doc.slice(start + marker.length);
  const next = rest.search(/\n## /);
  const body = next < 0 ? rest : rest.slice(0, next);
  const files = [];
  body.split('\n').forEach(function (line) {
    const match = line.match(/^\d+\.\s+`([^`]+)`/);
    if (match) files.push(match[1]);
  });
  if (!files.length) fail('upgrade path lists no files');
  return files;
}

function setsAccessFlags(sql) {
  const re = /update\s+public\.user_profiles\b[\s\S]*?;/gi;
  let match;
  while ((match = re.exec(sql))) {
    if (/can_access_|can_edit_|is_admin/i.test(match[0])) return true;
  }
  return false;
}

const doc = fs.readFileSync(docPath, 'utf8');
const files = upgradeFiles(doc);
['supabase-setup.sql', 'supabase-monday-reminder-cron.sql'].forEach(function (banned) {
  if (files.indexOf(banned) !== -1) fail('upgrade path includes ' + banned);
});
files.forEach(function (rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) fail('upgrade file is missing: ' + rel);
  if (setsAccessFlags(fs.readFileSync(full, 'utf8'))) fail('upgrade file updates user_profiles access flags: ' + rel);
});
const rollback = path.join(root, 'supabase', 'rollbacks', '20261009160000_upgrade_existing_objects.sql');
if (!fs.existsSync(rollback)) fail('upgrade rollback is missing');
if (setsAccessFlags(fs.readFileSync(rollback, 'utf8'))) fail('upgrade rollback updates user_profiles access flags');

function cluster() {
  const text = sh(['pg_lsclusters', '--no-header'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const line = text.split('\n').map(function (row) { return row.trim(); }).filter(Boolean)[0];
  if (!line) fail('no local Postgres cluster');
  const parts = line.split(/\s+/);
  return { major: parts[0], name: parts[1], status: parts[3] };
}

const found = cluster();
if (found.status !== 'online') sh(['pg_ctlcluster', found.major, found.name, 'start']);

psql('postgres', 'drop database if exists ' + DB + ' with (force); create database ' + DB + ';');
psql(DB, `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  ), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema public, storage to anon, authenticated;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
end $$;
grant usage on schema storage to supabase_storage_admin;
grant select on storage.objects to supabase_storage_admin with grant option;
set role supabase_storage_admin;
grant select on storage.objects to anon;
reset role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
`);

[
  'supabase-setup.sql',
  'supabase-user-profiles-rename-migration.sql',
  'supabase-linesheet-products-migration.sql',
  'supabase-global-cal-migration.sql',
  'supabase-calendar-entries-migration.sql',
  'supabase-calendar-entries-year-column-migration.sql',
  'supabase-calendar-entries-lock-migration.sql',
  'supabase-linesheet-products-lock-migration.sql'
].forEach(function (name) { psqlFile(path.join(root, name)); });

psql(DB, `
insert into auth.users (id, email) values ('${BLOCKED}', 'blocked@local.test');
update public.user_profiles set
  is_admin = false,
  can_access_product_calendar = false,
  can_access_global_calendar = false,
  can_access_linesheet = false,
  can_edit_product_calendar = false,
  can_edit_global_calendar = false,
  can_edit_linesheet = false
where id = '${BLOCKED}';
`);

function snapshot() {
  return psqlValue(DB, 'select ' + FLAGS.join(", '|', ") + " from public.user_profiles where id = '" + BLOCKED + "'");
}

const before = snapshot();
if (before.split('|').some(function (flag) { return flag !== 'f' && flag !== 'false'; })) {
  fail('blocked profile was not seeded false: ' + before);
}
files.forEach(function (rel) {
  const applied = runFile(path.join(root, rel));
  if (!applied.ok) fail('upgrade file failed: ' + rel);
});
const after = snapshot();
if (after !== before) fail('upgrade changed blocked profile flags from ' + before + ' to ' + after);
const rolled = runFile(rollback);
if (!rolled.ok && !/refusing to drop/.test(rolled.detail)) fail('upgrade rollback failed: ' + rolled.detail.split('\n')[0]);
const afterRollback = snapshot();
if (afterRollback !== before) fail('upgrade rollback changed blocked profile flags from ' + before + ' to ' + afterRollback);

console.log(JSON.stringify({ issue: 72, tz: process.env.TZ || '', ok: true, flags: after }));
