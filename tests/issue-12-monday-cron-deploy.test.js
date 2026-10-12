'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const setupPath = path.join(root, 'supabase-setup.sql');
const cronPath = path.join(root, 'supabase-monday-reminder-cron.sql');
const docPath = path.join(root, 'docs', 'DEPLOY_ORDER.md');
const configPath = path.join(root, 'js', 'supabase-config.js');
const STAGING_URL = 'https://ifxtvoqafaamoatudrch.supabase.co/functions/v1/linesheet-monday-reminder';
const PLACEHOLDER = '<MONDAY_REMINDER_FUNCTION_URL>';

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function readProp(source, prop) {
  const re = new RegExp(prop + '\\s*:\\s*([\'"])((?:\\\\.|(?!\\1).)*)\\1');
  const match = source.match(re);
  if (!match) fail('tracked config is missing ' + prop);
  return match[2];
}

function redact(text) {
  return String(text || '')
    .replace(/sb_publishable_[A-Za-z0-9_]+/g, '[redacted-key]')
    .replace(/sb_secret_[A-Za-z0-9_]+/g, '[redacted-key]')
    .replace(/Bearer [A-Za-z0-9_\-\.]+/g, 'Bearer [redacted]');
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

const tracked = fs.readFileSync(configPath, 'utf8');
const liveHost = new URL(readProp(tracked, 'url')).hostname.toLowerCase();
const setup = fs.readFileSync(setupPath, 'utf8');
const doc = fs.readFileSync(docPath, 'utf8');

if (setup.toLowerCase().includes(liveHost)) fail('setup sql names the live project');
if (setup.includes('sb_publishable_')) fail('setup sql embeds a publishable key');
if (setup.includes('cron.schedule')) fail('setup sql schedules the Monday reminder');

if (doc.includes('Run the whole list again')) fail('deploy doc tells the operator to run the whole list again');
const numbered = doc.split('\n').filter(function (line) { return /^\d+\.\s/.test(line); });
if (numbered.some(function (line) { return line.includes('supabase-monday-reminder-cron.sql'); })) {
  fail('deploy list includes the Monday cron file');
}
if (!doc.includes('supabase-monday-reminder-cron.sql')) fail('deploy doc does not name the Monday cron file');
if (!/not a numbered step/i.test(doc)) fail('deploy doc does not keep the cron off the numbered list');
if (!/do not run it on staging/i.test(doc)) fail('deploy doc does not forbid the cron on staging');

if (!fs.existsSync(cronPath)) fail('monday cron file is missing');
const cronSql = fs.readFileSync(cronPath, 'utf8');
if (cronSql.includes('sb_publishable_')) fail('monday cron file embeds a publishable key');
if (!cronSql.includes(PLACEHOLDER)) fail('monday cron file has no function URL placeholder');
if (!cronSql.includes(liveHost)) fail('monday cron file does not name the live host it refuses');

function clusterInfo() {
  const text = sh(['pg_lsclusters', '--no-header'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const line = text.split('\n').map(function (row) { return row.trim(); }).filter(Boolean)[0];
  if (!line) fail('no local Postgres cluster');
  const parts = line.split(/\s+/);
  return { major: parts[0], name: parts[1], status: parts[3] };
}

function currentCronDatabase() {
  const preload = psqlValue('postgres', 'show shared_preload_libraries');
  if (preload.indexOf('pg_cron') === -1) return '';
  return psqlValue('postgres', 'show cron.database_name');
}

function cronDatabase() {
  const found = clusterInfo();
  if (found.status !== 'online') sh(['pg_ctlcluster', found.major, found.name, 'start']);
  let name = currentCronDatabase();
  if (!/^[a-z0-9_]+$/.test(name)) {
    const confDir = '/etc/postgresql/' + found.major + '/main/conf.d';
    sh(['mkdir', '-p', confDir]);
    sh(['tee', confDir + '/btv-monday-cron.conf'], {
      input: "shared_preload_libraries = 'pg_cron'\ncron.database_name = 'postgres'\n",
      stdio: ['pipe', 'pipe', 'pipe']
    });
    sh(['pg_ctlcluster', found.major, found.name, 'restart']);
    name = currentCronDatabase();
  }
  if (!/^[a-z0-9_]+$/.test(name)) fail('cron database name is not a local identifier');
  const exists = psqlValue('postgres', "select 1 from pg_database where datname = '" + name + "'");
  if (exists !== '1') psql('postgres', 'create database ' + name + ';');
  return name;
}

function prepare(database) {
  const major = sh(['-u', 'postgres', 'psql', '-d', 'postgres', '-t', '-A', '-c', 'show server_version_num'], {
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
  const version = String(Math.floor(Number(major) / 10000));
  const extensionDir = '/usr/share/postgresql/' + version + '/extension';
  const stubDir = path.join(__dirname, 'fixtures', 'pg_net_stub');
  ['pg_net.control', 'pg_net--0.1.sql'].forEach(function (name) {
    sh(['cp', path.join(stubDir, name), path.join(extensionDir, name)]);
  });
  psql(database, 'create extension if not exists pg_cron; create extension if not exists pg_net;');
}

function clearJob(database) {
  psql(database, `
do $$
begin
  if exists (select 1 from cron.job where jobname = 'linesheet-monday-reminder') then
    perform cron.unschedule('linesheet-monday-reminder');
  end if;
end $$;
`);
}

function jobCommand(database) {
  return psqlValue(database, "select coalesce(string_agg(command, '\n'), '') from cron.job where jobname = 'linesheet-monday-reminder'");
}

function runSql(database, sql) {
  try {
    psql(database, sql);
    return { ok: true, detail: '' };
  } catch (error) {
    return { ok: false, detail: error.detail || '' };
  }
}

const database = cronDatabase();
prepare(database);
clearJob(database);
process.on('exit', function () { try { clearJob(database); } catch (err) { return; } });

const untouched = runSql(database, cronSql);
if (untouched.ok) fail('placeholder cron scheduled a job');
if (jobCommand(database).toLowerCase().includes(liveHost)) fail('placeholder cron stored the live host');

clearJob(database);
const liveSql = cronSql.split(PLACEHOLDER).join('https://' + liveHost + '/functions/v1/linesheet-monday-reminder');
const refused = runSql(database, liveSql);
if (refused.ok) fail('live URL was scheduled from a non-live project');
if (!refused.detail.includes('non-live project')) fail('live URL refusal did not say why');
if (jobCommand(database).toLowerCase().includes(liveHost)) fail('refused cron stored the live host');

clearJob(database);
const stagingSql = cronSql.split(PLACEHOLDER).join(STAGING_URL);
const staged = runSql(database, stagingSql);
if (!staged.ok) fail('staging function URL was not scheduled');
const command = jobCommand(database);
if (!command.includes('ifxtvoqafaamoatudrch.supabase.co')) fail('scheduled command is not the staging function');
if (command.toLowerCase().includes(liveHost)) fail('staging schedule stored the live host');
if (command.includes('sb_publishable_')) fail('scheduled command embeds a publishable key');
clearJob(database);

console.log(JSON.stringify({ issue: 12, tz: process.env.TZ || '', ok: true }));
