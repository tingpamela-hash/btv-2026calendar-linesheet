'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const DB = 'btv_signup_view_only';
const EXISTING = '66666666-6666-4666-8666-666666666666';
const SIGNUP = '55555555-5555-4555-8555-555555555555';
const FLAGS = [
  'can_access_product_calendar',
  'can_access_global_calendar',
  'can_access_linesheet',
  'can_edit_product_calendar',
  'can_edit_global_calendar',
  'can_edit_linesheet',
  'is_admin'
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function lastSignupFunction(sql) {
  const matches = sql.match(/create or replace function public\.handle_new_user\(\)[\s\S]*?\$\$;/gi);
  assert.ok(matches && matches.length, 'handle_new_user is missing');
  return matches[matches.length - 1];
}

test('handle_new_user and upgrade defaults make a new sign-up view-only', () => {
  const upgrade = read('supabase/migrations/20261009160000_upgrade_existing_objects.sql');
  [upgrade, read('supabase-setup.sql'), read('supabase-rls-lockdown-migration.sql')].forEach(function (sql) {
    const fn = lastSignupFunction(sql);
    FLAGS.forEach(function (flag) {
      assert.match(fn, new RegExp(flag));
    });
    assert.match(fn, /true,\s*true,\s*true,\s*false,\s*false,\s*false,\s*false/);
  });
  [
    'can_access_product_calendar set default true',
    'can_access_global_calendar set default true',
    'can_access_linesheet set default true',
    'can_edit_product_calendar set default false',
    'can_edit_global_calendar set default false',
    'can_edit_linesheet set default false',
    'is_admin set default false'
  ].forEach(function (needle) {
    assert.ok(upgrade.toLowerCase().includes(needle), needle);
  });
});

function sh(args, opts) {
  return execFileSync('sudo', args, Object.assign({ encoding: 'utf8' }, opts));
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

test('a sign-up after the upgrade path is view-only and an existing row stays blocked', () => {
  const text = sh(['pg_lsclusters', '--no-header'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const line = text.split('\n').map(function (row) { return row.trim(); }).filter(Boolean)[0];
  assert.ok(line, 'no local Postgres cluster');
  const parts = line.split(/\s+/);
  if (parts[3] !== 'online') sh(['pg_ctlcluster', parts[0], parts[1], 'start']);
  psql('postgres', 'drop database if exists ' + DB + ' with (force); create database ' + DB + ';');
  psql(DB, `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
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
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
grant usage on schema auth, storage, public to anon, authenticated;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
`);
  psqlFile(path.join(root, 'supabase-setup.sql'));
  psql(DB, `
insert into auth.users (id, email) values ('${EXISTING}', 'blocked@local.test');
update public.user_profiles set
  can_access_product_calendar = false,
  can_access_global_calendar = false,
  can_access_linesheet = false,
  can_edit_product_calendar = false,
  can_edit_global_calendar = false,
  can_edit_linesheet = false,
  is_admin = false
where id = '${EXISTING}';
`);
  psqlFile(path.join(root, 'supabase/migrations/20261009160000_upgrade_existing_objects.sql'));
  const expr = FLAGS.map(function (flag) { return flag + '::text'; }).join(" || '|' || ");
  const existing = psqlValue(DB, "select " + expr + " from public.user_profiles where id = '" + EXISTING + "'");
  assert.equal(existing, 'false|false|false|false|false|false|false');
  psql(DB, "insert into auth.users (id, email) values ('" + SIGNUP + "', 'new@local.test');");
  const signup = psqlValue(DB, "select " + expr + " from public.user_profiles where id = '" + SIGNUP + "'");
  assert.equal(signup, 'true|true|true|false|false|false|false');
  const defaults = psqlValue(DB, `
select string_agg(column_name || '=' || column_default, ',' order by column_name)
from information_schema.columns
where table_schema = 'public' and table_name = 'user_profiles'
  and column_name in (${FLAGS.map(function (flag) { return "'" + flag + "'"; }).join(',')});
`);
  assert.match(defaults, /can_access_global_calendar=true/);
  assert.match(defaults, /can_access_linesheet=true/);
  assert.match(defaults, /can_access_product_calendar=true/);
  assert.match(defaults, /can_edit_global_calendar=false/);
  assert.match(defaults, /can_edit_linesheet=false/);
  assert.match(defaults, /can_edit_product_calendar=false/);
  assert.match(defaults, /is_admin=false/);
});
