'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const DB = 'btv_rls';
const VIEWER = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const GLOBAL = '33333333-3333-4333-8333-333333333333';
const LINESHEET = '44444444-4444-4444-8444-444444444444';
const ADMIN = '55555555-5555-4555-8555-555555555555';
const NOACCESS = '66666666-6666-4666-8666-666666666666';

const failures = [];

function redact(text) {
  return String(text || '')
    .replace(/sb_publishable_[A-Za-z0-9_]+/g, '[redacted-key]')
    .replace(/sb_secret_[A-Za-z0-9_]+/g, '[redacted-key]')
    .replace(/Bearer [A-Za-z0-9_\-\.]+/g, 'Bearer [redacted]')
    .replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, 'https://[redacted].supabase.co');
}

function sh(cmd, args, opts) {
  try {
    return execFileSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  } catch (error) {
    const detail = redact((error.stderr || '') + '\n' + (error.stdout || '') + '\n' + error.message);
    throw new Error(cmd + ' ' + args.join(' ') + '\n' + detail);
  }
}

function check(name, ok, actual) {
  if (ok) {
    console.log('PASS ' + name);
    return;
  }
  failures.push(name);
  console.error('FAIL ' + name);
  console.error(JSON.stringify(actual));
}

function psql(database, sql) {
  return sh('sudo', ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function psqlValue(database, sql) {
  return sh('sudo', ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-t', '-A'], {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function psqlFile(file) {
  sh('sudo', ['-u', 'postgres', 'psql', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
    input: fs.readFileSync(file),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function cluster() {
  const text = sh('pg_lsclusters', ['--no-header'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const line = text.split('\n').map((row) => row.trim()).filter(Boolean)[0];
  if (!line) throw new Error('no local Postgres cluster');
  const parts = line.split(/\s+/);
  return { major: parts[0], name: parts[1], status: parts[3] };
}

function ensureCluster() {
  const found = cluster();
  if (found.status !== 'online') sh('sudo', ['pg_ctlcluster', found.major, found.name, 'start']);
  const confDir = '/etc/postgresql/' + found.major + '/main/conf.d';
  sh('sudo', ['mkdir', '-p', confDir]);
  const snippet = "shared_preload_libraries = 'pg_cron'\ncron.database_name = '" + DB + "'\n";
  const snippetPath = confDir + '/btv-rls-test.conf';
  const current = fs.existsSync(snippetPath) ? fs.readFileSync(snippetPath, 'utf8') : '';
  if (current !== snippet) {
    sh('sudo', ['tee', snippetPath], { input: snippet, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  const extensionDir = '/usr/share/postgresql/' + found.major + '/extension';
  const stubDir = path.join(__dirname, 'fixtures', 'pg_net_stub');
  for (const name of ['pg_net.control', 'pg_net--0.1.sql']) {
    sh('sudo', ['cp', path.join(stubDir, name), path.join(extensionDir, name)]);
  }
  let ready = false;
  try {
    const preload = psqlValue('postgres', 'show shared_preload_libraries');
    const cronDb = psqlValue('postgres', 'show cron.database_name');
    ready = preload.indexOf('pg_cron') !== -1 && cronDb === DB;
  } catch (error) {
    ready = false;
  }
  if (!ready) sh('sudo', ['pg_ctlcluster', found.major, found.name, 'restart']);
}

function recreateDatabase() {
  psql('postgres', 'drop database if exists ' + DB + ' with (force);');
  psql('postgres', 'create database ' + DB + ';');
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
grant execute on all functions in schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb
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
}

function applySql() {
  const files = [
    'supabase-setup.sql',
    'supabase-user-profiles-rename-migration.sql',
    'supabase-linesheet-products-migration.sql',
    'supabase-global-cal-migration.sql',
    'supabase-calendar-entries-migration.sql',
    'supabase-calendar-entries-year-column-migration.sql',
    'supabase-calendar-entries-lock-migration.sql',
    'supabase-linesheet-products-lock-migration.sql',
  ];
  files.forEach((name) => psqlFile(path.join(root, name)));
  psql(DB, `
do $$
declare job bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    for job in select jobid from cron.job where jobname = 'linesheet-monday-reminder' loop
      perform cron.unschedule(job);
    end loop;
  end if;
end $$;
`);
  const dir = path.join(root, 'supabase', 'migrations');
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
    .forEach((name) => psqlFile(path.join(dir, name)));
}

function seed() {
  psql(DB, `
insert into auth.users (id, email) values
  ('${VIEWER}', 'viewer@local.test'),
  ('${PRODUCT}', 'product@local.test'),
  ('${GLOBAL}', 'global@local.test'),
  ('${LINESHEET}', 'linesheet@local.test'),
  ('${ADMIN}', 'admin@local.test'),
  ('${NOACCESS}', 'noaccess@local.test');
update public.user_profiles set
  is_admin = false,
  can_access_product_calendar = true,
  can_access_global_calendar = true,
  can_access_linesheet = true,
  can_edit_product_calendar = false,
  can_edit_global_calendar = false,
  can_edit_linesheet = false
where id = '${VIEWER}';
update public.user_profiles set
  is_admin = false,
  can_access_product_calendar = true,
  can_access_global_calendar = false,
  can_access_linesheet = false,
  can_edit_product_calendar = true,
  can_edit_global_calendar = false,
  can_edit_linesheet = false
where id = '${PRODUCT}';
update public.user_profiles set
  is_admin = false,
  can_access_product_calendar = false,
  can_access_global_calendar = true,
  can_access_linesheet = false,
  can_edit_product_calendar = false,
  can_edit_global_calendar = true,
  can_edit_linesheet = false
where id = '${GLOBAL}';
update public.user_profiles set
  is_admin = false,
  can_access_product_calendar = false,
  can_access_global_calendar = false,
  can_access_linesheet = true,
  can_edit_product_calendar = false,
  can_edit_global_calendar = false,
  can_edit_linesheet = true
where id = '${LINESHEET}';
update public.user_profiles set
  is_admin = true,
  can_access_product_calendar = false,
  can_access_global_calendar = false,
  can_access_linesheet = false,
  can_edit_product_calendar = false,
  can_edit_global_calendar = false,
  can_edit_linesheet = false
where id = '${ADMIN}';
update public.user_profiles set
  is_admin = false,
  can_access_product_calendar = false,
  can_access_global_calendar = false,
  can_access_linesheet = false,
  can_edit_product_calendar = false,
  can_edit_global_calendar = false,
  can_edit_linesheet = false
where id = '${NOACCESS}';
`);
}

function countAs(userId, table) {
  const sql = `
begin;
set local role authenticated;
select count(*)::text from ${table}
 where set_config('request.jwt.claim.sub', '${userId}', true) is not null;
commit;
`;
  return psqlValue(DB, sql).split('\n').map((line) => line.trim()).filter((line) => line && line !== 'COMMIT' && line !== 'BEGIN').pop();
}

function attempt(userId, statement) {
  const sql = `
begin;
set local role authenticated;
do $body$
begin
  perform set_config('request.jwt.claim.sub', '${userId}', true);
  begin
    ${statement}
    perform set_config('btv.probe', 'ok', true);
  exception when others then
    perform set_config('btv.probe', sqlstate, true);
  end;
end
$body$;
select current_setting('btv.probe', true);
commit;
`;
  return psqlValue(DB, sql).split('\n').map((line) => line.trim()).filter((line) => line && line !== 'COMMIT' && line !== 'BEGIN').pop();
}

function callText(userId, expression) {
  const sql = `
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${userId}', true);
select (${expression})::text;
commit;
`;
  const lines = psqlValue(DB, sql).split('\n').map((line) => line.trim()).filter((line) => line && line !== 'BEGIN' && line !== 'COMMIT');
  return lines[lines.length - 1];
}

function lockState(table, column, id) {
  return psqlValue(DB, `
select coalesce(locked_by::text, '') || '|' || coalesce(locked_by_email, '') || '|' ||
       case when locked_at is null then '' else 'set' end
  from ${table}
 where ${column} = '${id}'
`);
}

function main() {
  ensureCluster();
  recreateDatabase();
  applySql();
  seed();

  const viewerCalendar = attempt(VIEWER, "insert into public.calendar_entries (id, section, week_id, year, data) values ('cal-viewer', 'global', '2026-10-05', 2026, '{}'::jsonb);");
  check('a view-only profile cannot insert a calendar entry', viewerCalendar === '42501', viewerCalendar);

  const productCalendar = attempt(PRODUCT, "insert into public.calendar_entries (id, section, week_id, year, data) values ('cal-product', 'global', '2026-10-05', 2026, '{}'::jsonb);");
  check('a product calendar editor can insert a calendar entry', productCalendar === 'ok', productCalendar);

  const globalEvent = attempt(GLOBAL, "insert into public.calendar_entries (id, section, week_id, year, data) values ('cal-event', 'events', '2026-10-05', 2026, '{}'::jsonb);");
  check('a global calendar editor can insert an events row', globalEvent === 'ok', globalEvent);

  const globalOther = attempt(GLOBAL, "insert into public.calendar_entries (id, section, week_id, year, data) values ('cal-global', 'global', '2026-10-05', 2026, '{}'::jsonb);");
  check('a global calendar editor cannot insert a non-events row', globalOther === '42501', globalOther);

  const linesheetCalendar = attempt(LINESHEET, "insert into public.calendar_entries (id, section, week_id, year, data) values ('cal-linesheet', 'global', '2026-10-05', 2026, '{}'::jsonb);");
  check('a linesheet editor cannot insert a calendar entry', linesheetCalendar === '42501', linesheetCalendar);

  const adminCalendar = attempt(ADMIN, "insert into public.calendar_entries (id, section, week_id, year, data) values ('cal-admin', 'global', '2026-10-05', 2026, '{}'::jsonb);");
  check('an admin can insert a calendar entry', adminCalendar === 'ok', adminCalendar);

  const noaccessCount = countAs(NOACCESS, 'public.calendar_entries');
  check('a profile with no access sees no calendar entries', noaccessCount === '0', noaccessCount);

  const linesheetRead = countAs(LINESHEET, 'public.calendar_entries');
  check('a linesheet member can read calendar entries', Number(linesheetRead) > 0, linesheetRead);

  const lockInsert = attempt(LINESHEET, "insert into public.linesheet_product_locks (group_id, locked_by_email) values ('group-1', 'linesheet@local.test');");
  check('a signed-in user cannot insert a linesheet lock row', lockInsert === '42501', lockInsert);

  psql(DB, "insert into public.linesheet_product_locks (group_id, locked_by_email) values ('group-seed', 'seed@local.test');");
  const lockRead = countAs(LINESHEET, 'public.linesheet_product_locks');
  check('a linesheet member can read linesheet locks', lockRead === '1', lockRead);

  const noaccessLock = countAs(NOACCESS, 'public.linesheet_product_locks');
  check('a profile with no access sees no linesheet locks', noaccessLock === '0', noaccessLock);

  const viewerGlobal = attempt(VIEWER, "insert into public.global_cal_entries (id, market, data) values ('g-viewer', 'SG', '{}'::jsonb);");
  check('a view-only profile cannot insert a global calendar row', viewerGlobal === '42501', viewerGlobal);

  const viewerGroup = callText(VIEWER, "public.try_lock_linesheet_group('lock-viewer', 'viewer@local.test')");
  check('a view-only profile cannot lock a linesheet group', viewerGroup === 'false', viewerGroup);
  const noaccessGroup = callText(NOACCESS, "public.try_lock_linesheet_group('lock-none', 'noaccess@local.test')");
  check('a profile with no access cannot lock a linesheet group', noaccessGroup === 'false', noaccessGroup);
  const productGroup = callText(PRODUCT, "public.try_lock_linesheet_group('lock-product', 'product@local.test')");
  check('a product calendar editor cannot lock a linesheet group', productGroup === 'false', productGroup);
  const linesheetGroup = callText(LINESHEET, "public.try_lock_linesheet_group('lock-linesheet', 'linesheet@local.test')");
  check('a linesheet editor can lock a linesheet group', linesheetGroup === 'true', linesheetGroup);
  const linesheetHeld = lockState('public.linesheet_product_locks', 'group_id', 'lock-linesheet');
  check('a linesheet editor holds the group lock', linesheetHeld === LINESHEET + '|linesheet@local.test|set', linesheetHeld);
  const adminGroup = callText(ADMIN, "public.try_lock_linesheet_group('lock-admin', 'admin@local.test')");
  check('an admin can lock a linesheet group', adminGroup === 'true', adminGroup);

  psql(DB, `
insert into public.linesheet_product_locks (group_id, locked_by, locked_by_email, locked_at) values
  ('lock-held-viewer', '${VIEWER}', 'viewer@local.test', now()),
  ('lock-held-product', '${PRODUCT}', 'product@local.test', now());
`);
  const viewerRefresh = callText(VIEWER, "public.refresh_linesheet_group_lock('lock-held-viewer')");
  check('a view-only profile cannot refresh a linesheet lock', viewerRefresh === 'false', viewerRefresh);
  callText(VIEWER, "public.unlock_linesheet_group('lock-held-viewer')");
  const viewerUnlock = lockState('public.linesheet_product_locks', 'group_id', 'lock-held-viewer');
  check('a view-only profile can release a linesheet lock they hold', viewerUnlock === '||', viewerUnlock);
  callText(PRODUCT, "public.unlock_linesheet_group('lock-held-product')");
  const productUnlock = lockState('public.linesheet_product_locks', 'group_id', 'lock-held-product');
  check('a product calendar editor can release a linesheet lock they hold', productUnlock === '||', productUnlock);
  callText(VIEWER, "public.unlock_linesheet_group('lock-linesheet')");
  const viewerOther = lockState('public.linesheet_product_locks', 'group_id', 'lock-linesheet');
  check('a view-only profile cannot release a linesheet lock they do not hold', viewerOther === LINESHEET + '|linesheet@local.test|set', viewerOther);
  callText(LINESHEET, "public.unlock_linesheet_group('lock-linesheet')");
  const linesheetUnlock = lockState('public.linesheet_product_locks', 'group_id', 'lock-linesheet');
  check('a linesheet editor can unlock a group they hold', linesheetUnlock === '||', linesheetUnlock);

  psql(DB, `
insert into public.calendar_entries (id, section, week_id, year, data) values
  ('cal-lock-viewer', 'global', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-none', 'global', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-linesheet', 'global', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-product', 'global', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-global', 'global', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-events', 'events', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-admin', 'global', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-held', 'global', '2026-10-05', 2026, '{}'::jsonb);
update public.calendar_entries
   set locked_by = '${NOACCESS}', locked_by_email = 'noaccess@local.test', locked_at = now()
 where id = 'cal-lock-held';
`);
  const viewerEntry = callText(VIEWER, "public.try_lock_calendar_entry('cal-lock-viewer', 'viewer@local.test')");
  check('a view-only profile cannot lock a calendar entry', viewerEntry === 'false', viewerEntry);
  const noaccessEntry = callText(NOACCESS, "public.try_lock_calendar_entry('cal-lock-none', 'noaccess@local.test')");
  check('a profile with no access cannot lock a calendar entry', noaccessEntry === 'false', noaccessEntry);
  const noaccessFields = lockState('public.calendar_entries', 'id', 'cal-lock-none');
  check('a profile with no access does not set calendar lock fields', noaccessFields === '||', noaccessFields);
  const linesheetEntry = callText(LINESHEET, "public.try_lock_calendar_entry('cal-lock-linesheet', 'linesheet@local.test')");
  check('a linesheet editor cannot lock a calendar entry', linesheetEntry === 'false', linesheetEntry);
  const productEntry = callText(PRODUCT, "public.try_lock_calendar_entry('cal-lock-product', 'product@local.test')");
  check('a product calendar editor can lock a calendar entry', productEntry === 'true', productEntry);
  const globalLockedOther = callText(GLOBAL, "public.try_lock_calendar_entry('cal-lock-global', 'global@local.test')");
  check('a global editor cannot lock a non-events calendar entry', globalLockedOther === 'false', globalLockedOther);
  const globalEvents = callText(GLOBAL, "public.try_lock_calendar_entry('cal-lock-events', 'global@local.test')");
  check('a global editor can lock an events calendar entry', globalEvents === 'true', globalEvents);
  const adminEntry = callText(ADMIN, "public.try_lock_calendar_entry('cal-lock-admin', 'admin@local.test')");
  check('an admin can lock a calendar entry', adminEntry === 'true', adminEntry);

  const noaccessRefresh = callText(NOACCESS, "public.refresh_calendar_entry_lock('cal-lock-held')");
  check('a profile with no access cannot refresh a calendar lock', noaccessRefresh === 'false', noaccessRefresh);
  callText(NOACCESS, "public.unlock_calendar_entry('cal-lock-held')");
  const noaccessUnlock = lockState('public.calendar_entries', 'id', 'cal-lock-held');
  check('a profile with no access can release a calendar lock they hold', noaccessUnlock === '||', noaccessUnlock);
  callText(NOACCESS, "public.unlock_calendar_entry('cal-lock-product')");
  const noaccessOther = lockState('public.calendar_entries', 'id', 'cal-lock-product');
  check('a profile with no access cannot release a calendar lock they do not hold', noaccessOther === PRODUCT + '|product@local.test|set', noaccessOther);
  callText(GLOBAL, "public.unlock_calendar_entry('cal-lock-events')");
  const globalUnlock = lockState('public.calendar_entries', 'id', 'cal-lock-events');
  check('a global editor can unlock an events row they hold', globalUnlock === '||', globalUnlock);
  callText(PRODUCT, "public.unlock_calendar_entry('cal-lock-product')");
  const productEntryUnlock = lockState('public.calendar_entries', 'id', 'cal-lock-product');
  check('a product calendar editor can unlock a calendar entry they hold', productEntryUnlock === '||', productEntryUnlock);

  const revokedGroup = callText(LINESHEET, "public.try_lock_linesheet_group('lock-revoked', 'linesheet@local.test')");
  check('a linesheet editor can lock a group before the grant is revoked', revokedGroup === 'true', revokedGroup);
  psql(DB, "update public.user_profiles set can_edit_linesheet = false where id = '" + LINESHEET + "';");
  callText(LINESHEET, "public.unlock_linesheet_group('lock-revoked')");
  const revokedUnlock = lockState('public.linesheet_product_locks', 'group_id', 'lock-revoked');
  check('a linesheet editor can unlock their own group after the edit grant is revoked', revokedUnlock === '||', revokedUnlock);
  const revokedAgain = callText(LINESHEET, "public.try_lock_linesheet_group('lock-revoked-again', 'linesheet@local.test')");
  check('a linesheet editor cannot lock a group after the edit grant is revoked', revokedAgain === 'false', revokedAgain);

  psql(DB, `
insert into public.calendar_entries (id, section, week_id, year, data) values
  ('cal-lock-revoked', 'global', '2026-10-05', 2026, '{}'::jsonb),
  ('cal-lock-revoked-again', 'global', '2026-10-05', 2026, '{}'::jsonb);
`);
  const revokedEntry = callText(PRODUCT, "public.try_lock_calendar_entry('cal-lock-revoked', 'product@local.test')");
  check('a product calendar editor can lock an entry before the grant is revoked', revokedEntry === 'true', revokedEntry);
  psql(DB, "update public.user_profiles set can_edit_product_calendar = false where id = '" + PRODUCT + "';");
  callText(PRODUCT, "public.unlock_calendar_entry('cal-lock-revoked')");
  const revokedEntryUnlock = lockState('public.calendar_entries', 'id', 'cal-lock-revoked');
  check('a product calendar editor can unlock their own entry after the edit grant is revoked', revokedEntryUnlock === '||', revokedEntryUnlock);
  const revokedEntryAgain = callText(PRODUCT, "public.try_lock_calendar_entry('cal-lock-revoked-again', 'product@local.test')");
  check('a product calendar editor cannot lock an entry after the edit grant is revoked', revokedEntryAgain === 'false', revokedEntryAgain);

  const staleLinesheetZero = attempt(ADMIN, "perform public.try_lock_linesheet_group('stale-ls-zero', 'admin@local.test', 0);");
  check('try_lock_linesheet_group rejects a stale threshold of zero', staleLinesheetZero === '22023', staleLinesheetZero);
  const staleLinesheetNegative = attempt(ADMIN, "perform public.try_lock_linesheet_group('stale-ls-neg', 'admin@local.test', -1);");
  check('try_lock_linesheet_group rejects a stale threshold below zero', staleLinesheetNegative === '22023', staleLinesheetNegative);
  psql(DB, "insert into public.calendar_entries (id, section, week_id, year, data) values ('cal-stale', 'global', '2026-10-05', 2026, '{}'::jsonb);");
  const staleCalendarZero = attempt(ADMIN, "perform public.try_lock_calendar_entry('cal-stale', 'admin@local.test', 0);");
  check('try_lock_calendar_entry rejects a stale threshold of zero', staleCalendarZero === '22023', staleCalendarZero);
  const staleCalendarNegative = attempt(ADMIN, "perform public.try_lock_calendar_entry('cal-stale', 'admin@local.test', -1);");
  check('try_lock_calendar_entry rejects a stale threshold below zero', staleCalendarNegative === '22023', staleCalendarNegative);
  const refreshArgs = psqlValue(DB, "select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('refresh_linesheet_group_lock', 'refresh_calendar_entry_lock') order by p.proname");
  check('refresh lock functions do not take a stale threshold', refreshArgs.indexOf('stale') === -1, refreshArgs);

  const lockRollback = path.join(root, 'supabase', 'rollbacks', '20261009140000_lock_requires_edit_grant.sql');
  const lockMigration = path.join(root, 'supabase', 'migrations', '20261009140000_lock_requires_edit_grant.sql');
  psqlFile(lockRollback);
  const rolledBack = callText(VIEWER, "public.try_lock_linesheet_group('lock-rollback', 'viewer@local.test')");
  check('lock rollback restores a view-only linesheet lock', rolledBack === 'true', rolledBack);
  psqlFile(lockMigration);
  const relocked = callText(VIEWER, "public.try_lock_linesheet_group('lock-rollback-again', 'viewer@local.test')");
  check('lock migration denies a view-only linesheet lock again', relocked === 'false', relocked);

  console.log(JSON.stringify({ issue: '68-69', failures: failures.length }));
  if (failures.length) process.exit(1);
}

main();
