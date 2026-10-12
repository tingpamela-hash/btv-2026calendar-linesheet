create extension if not exists pg_cron;
create extension if not exists pg_net;

do $cron$
declare
  fn_url text := '<MONDAY_REMINDER_FUNCTION_URL>';
  live_host text := 'dftavnyoopghzgsxkhbw.supabase.co';
  allow_live text := current_setting('btv.schedule_live_monday_cron', true);
  command text;
begin
  if fn_url is null
     or position('<' in fn_url) > 0
     or position('://' in fn_url) = 0 then
    raise exception 'Monday reminder cron needs the function URL for this project';
  end if;
  if position(live_host in fn_url) > 0
     and coalesce(allow_live, '') is distinct from 'on' then
    raise exception 'refusing to schedule the live Monday reminder from a non-live project';
  end if;
  if exists (select 1 from cron.job where jobname = 'linesheet-monday-reminder') then
    perform cron.unschedule('linesheet-monday-reminder');
  end if;
  command := format(
    'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-btv-reminder-secret'', ''<BTV_REMINDER_CRON_SECRET>''), body := ''{}''::jsonb);',
    fn_url
  );
  perform cron.schedule(
    'linesheet-monday-reminder',
    '0 1 * * 1',
    command
  );
end
$cron$;
