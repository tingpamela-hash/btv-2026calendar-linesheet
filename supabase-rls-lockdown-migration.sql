-- ============================================================
-- BTV Planner – RLS lockdown: make user_profiles permissions real
--
-- WHY: every table policy was `to authenticated using (true)` — "any valid
-- login", not "any user BTV approved". With public signup switched on, a
-- stranger could create an account, confirm their own email, and read or
-- rewrite every table straight through the REST API. The can_access_* /
-- can_edit_* columns only hid nav tabs; the database ignored them.
--
-- WHAT THIS DOES
--   • READ (all tables): only approved staff — a user_profiles row with at
--     least one can_access_* ticked (or is_admin). Reads are NOT split per
--     module: Linesheet and Global Calendar both read calendar_entries
--     through their bridges, and all three tabs load (hidden) for everyone,
--     so a per-module read rule would break those pages.
--   • WRITE (per-row tables): gated per module by can_access_X AND can_edit_X.
--       calendar_entries     → Product Calendar editors
--                              + Global Calendar editors for section 'events'
--                                only (btvPushMarketingEventEntry writes there)
--       global_cal_entries,
--       marketing_entries    → Global Calendar editors
--       linesheet_products   → Linesheet editors
--   • WRITE (app_state): the shared blob keys are written by whichever page
--     happens to derive them (e.g. the hidden Product Calendar frame writes
--     linesheetCalendarData / launchListMaster / btv-admin-config-v1), so
--     they need "editor on at least one module". The notify-emails key,
--     the old pre-migration blobs, and any unknown key are admin-only.
--   • NEW SIGNUPS get no access at all until an admin ticks their boxes in
--     User Management — so being able to log in no longer means being able
--     to see anything.
--   • user_profiles: approved staff see everyone (User Management, presence);
--     anyone else sees only their own row. Only admins update. Nobody inserts
--     directly (the signup trigger does it).
--   • updated_by is stamped server-side from auth.uid(), so the change log
--     and conflict checks can't be given a wrong or spoofed author.
--
-- BEFORE RUNNING — IN THIS ORDER
--   1. Supabase dashboard → Authentication → Sign In / Providers → turn OFF
--      "Allow new users to sign up". (Report item 1.) Add new staff from
--      Authentication → Users → "Invite user" from now on.
--   2. Run the two DIAGNOSTIC queries below. Anyone you don't recognise:
--      delete them in Authentication → Users. This migration keeps every
--      EXISTING profile's current access, so an unknown account that is
--      still there afterwards keeps whatever it has today.
--   3. Check the view-only diagnostic. Anyone with an edit box unticked will
--      now genuinely be unable to write that module (see TESTING notes).
--   4. Run this whole file in SQL Editor → New query. It is one transaction:
--      if any statement fails, nothing is changed.
--
-- DO NOT re-run supabase-setup.sql, supabase-calendar-entries-migration.sql,
-- supabase-global-cal-migration.sql or supabase-linesheet-products-migration.sql
-- after this — they recreate the old `using (true)` policies, and
-- supabase-setup.sql section 4 re-grants access to every account.
--
-- Safe to re-run — every statement is idempotent.
-- ============================================================


-- ── DIAGNOSTICS (run separately, before the migration) ──────
--
-- a) Every account, newest first. Look for emails that aren't BTV staff.
--
--   select u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
--          p.is_admin,
--          p.can_access_product_calendar, p.can_access_global_calendar, p.can_access_linesheet
--   from auth.users u
--   left join public.user_profiles p on p.id = u.id
--   order by u.created_at desc;
--
-- b) Accounts that will LOSE write access they have today (an edit box is
--    unticked, or edit is ticked but access is not):
--
--   select email,
--          can_access_product_calendar, can_edit_product_calendar,
--          can_access_global_calendar,  can_edit_global_calendar,
--          can_access_linesheet,        can_edit_linesheet
--   from public.user_profiles
--   where not (can_access_product_calendar and can_edit_product_calendar)
--      or not (can_access_global_calendar  and can_edit_global_calendar)
--      or not (can_access_linesheet        and can_edit_linesheet);
--
-- c) The policies currently live (the repo's .sql files may not match):
--
--   select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' order by tablename, cmd;


begin;

-- ── 1. Permission helpers ─────────────────────────────────────
-- SECURITY DEFINER so they read user_profiles without going through its own
-- RLS (a policy on user_profiles that queries user_profiles would otherwise
-- recurse). Each only ever looks at the caller's own row (auth.uid()).

create or replace function public.btv_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid()
      and (p.is_admin
           or p.can_access_product_calendar
           or p.can_access_global_calendar
           or p.can_access_linesheet)
  );
$$;

create or replace function public.btv_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.user_profiles p where p.id = auth.uid()), false);
$$;

-- p_module: 'product_calendar' | 'global_calendar' | 'linesheet'
create or replace function public.btv_can_edit(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case p_module
      when 'product_calendar' then p.can_access_product_calendar and p.can_edit_product_calendar
      when 'global_calendar'  then p.can_access_global_calendar  and p.can_edit_global_calendar
      when 'linesheet'        then p.can_access_linesheet        and p.can_edit_linesheet
      else false
    end
    from public.user_profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.btv_can_edit_any()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.btv_can_edit('product_calendar')
      or public.btv_can_edit('global_calendar')
      or public.btv_can_edit('linesheet');
$$;

revoke execute on function public.btv_is_member()        from public, anon;
revoke execute on function public.btv_is_admin()         from public, anon;
revoke execute on function public.btv_can_edit(text)     from public, anon;
revoke execute on function public.btv_can_edit_any()     from public, anon;
grant  execute on function public.btv_is_member()        to authenticated;
grant  execute on function public.btv_is_admin()         to authenticated;
grant  execute on function public.btv_can_edit(text)     to authenticated;
grant  execute on function public.btv_can_edit_any()     to authenticated;


-- ── 2. New signups start with no access ──────────────────────
-- Existing rows are untouched — only the defaults and the signup trigger
-- change. An admin grants access by ticking boxes in User Management.

alter table public.user_profiles
  alter column can_access_product_calendar set default false,
  alter column can_access_global_calendar  set default false,
  alter column can_access_linesheet        set default false,
  alter column can_edit_product_calendar   set default false,
  alter column can_edit_global_calendar    set default false,
  alter column can_edit_linesheet          set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email)   -- every permission column takes its default (false)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ── 3. Drop every existing policy on the tables being rewritten ──
-- By table rather than by name, so policies created by hand in the
-- dashboard (or named differently from the repo files) go too.

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('app_state', 'user_profiles', 'change_log',
                        'calendar_entries', 'global_cal_entries', 'marketing_entries',
                        'linesheet_products', 'linesheet_product_locks')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;


-- ── 4. user_profiles ──────────────────────────────────────────

alter table public.user_profiles enable row level security;

create policy "Own profile, or all profiles for approved staff"
  on public.user_profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.btv_is_member()));

create policy "Admins can update any profile"
  on public.user_profiles for update
  to authenticated
  using      ((select public.btv_is_admin()))
  with check ((select public.btv_is_admin()));

-- No insert/delete policies: rows are created by handle_new_user() and
-- removed by the auth.users cascade.


-- ── 5. app_state ──────────────────────────────────────────────
-- Keys written by the site today (js/supabase-sync.js SYNCED_KEYS + index.html):
--   calendar-YYYY-working-v5-{history,versions,changelog},
--   calendar-YYYY-{marketing-workflow-v1,markdown-bars-v1},
--   linesheetCalendarData, launchListMaster, btvLinesheetChangeLog,
--   btv-admin-config-v1                      → any editor
--   btv-linesheet-notify-emails-v1           → admins (Notify Emails panel)
-- Anything else — including the retired calendar-YYYY-working-v5 and
-- btv_linesheet_products blobs kept for rollback — is admin-only.
-- No delete policy (unchanged: app_state rows were never deletable).

alter table public.app_state enable row level security;

create or replace function public.btv_can_write_app_state_key(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_key = 'btv-linesheet-notify-emails-v1' then public.btv_is_admin()
    when p_key in ('linesheetCalendarData', 'launchListMaster',
                   'btvLinesheetChangeLog', 'btv-admin-config-v1')
      or p_key ~ '^calendar-[0-9]{4}-(working-v5-(history|versions|changelog)|marketing-workflow-v1|markdown-bars-v1)$'
      then public.btv_can_edit_any()
    else public.btv_is_admin()
  end;
$$;
revoke execute on function public.btv_can_write_app_state_key(text) from public, anon;
grant  execute on function public.btv_can_write_app_state_key(text) to authenticated;

create policy "Approved staff can read app_state"
  on public.app_state for select
  to authenticated
  using ((select public.btv_is_member()));

create policy "Editors can insert app_state"
  on public.app_state for insert
  to authenticated
  with check (public.btv_can_write_app_state_key(key));

create policy "Editors can update app_state"
  on public.app_state for update
  to authenticated
  using      (public.btv_can_write_app_state_key(key))
  with check (public.btv_can_write_app_state_key(key));


-- ── 6. calendar_entries (Product Calendar Input) ─────────────
-- Global Calendar editors may only touch section 'events' — that is the
-- synthetic marketing-event entry btvPushMarketingEventEntry deletes and
-- re-inserts. The lock RPCs are SECURITY DEFINER and unaffected.

alter table public.calendar_entries enable row level security;

create policy "Approved staff can read calendar_entries"
  on public.calendar_entries for select
  to authenticated
  using ((select public.btv_is_member()));

create policy "Calendar editors can insert calendar_entries"
  on public.calendar_entries for insert
  to authenticated
  with check (
    (select public.btv_can_edit('product_calendar'))
    or (section = 'events' and (select public.btv_can_edit('global_calendar')))
  );

create policy "Calendar editors can update calendar_entries"
  on public.calendar_entries for update
  to authenticated
  using (
    (select public.btv_can_edit('product_calendar'))
    or (section = 'events' and (select public.btv_can_edit('global_calendar')))
  )
  with check (
    (select public.btv_can_edit('product_calendar'))
    or (section = 'events' and (select public.btv_can_edit('global_calendar')))
  );

create policy "Calendar editors can delete calendar_entries"
  on public.calendar_entries for delete
  to authenticated
  using (
    (select public.btv_can_edit('product_calendar'))
    or (section = 'events' and (select public.btv_can_edit('global_calendar')))
  );


-- ── 7. global_cal_entries + marketing_entries (Global Calendar) ──

alter table public.global_cal_entries enable row level security;
alter table public.marketing_entries  enable row level security;

create policy "Approved staff can read global_cal_entries"
  on public.global_cal_entries for select to authenticated
  using ((select public.btv_is_member()));
create policy "Global Calendar editors can insert global_cal_entries"
  on public.global_cal_entries for insert to authenticated
  with check ((select public.btv_can_edit('global_calendar')));
create policy "Global Calendar editors can update global_cal_entries"
  on public.global_cal_entries for update to authenticated
  using      ((select public.btv_can_edit('global_calendar')))
  with check ((select public.btv_can_edit('global_calendar')));
create policy "Global Calendar editors can delete global_cal_entries"
  on public.global_cal_entries for delete to authenticated
  using ((select public.btv_can_edit('global_calendar')));

create policy "Approved staff can read marketing_entries"
  on public.marketing_entries for select to authenticated
  using ((select public.btv_is_member()));
create policy "Global Calendar editors can insert marketing_entries"
  on public.marketing_entries for insert to authenticated
  with check ((select public.btv_can_edit('global_calendar')));
create policy "Global Calendar editors can update marketing_entries"
  on public.marketing_entries for update to authenticated
  using      ((select public.btv_can_edit('global_calendar')))
  with check ((select public.btv_can_edit('global_calendar')));
create policy "Global Calendar editors can delete marketing_entries"
  on public.marketing_entries for delete to authenticated
  using ((select public.btv_can_edit('global_calendar')));


-- ── 8. linesheet_products + linesheet_product_locks (Linesheet) ──
-- Pricing, SKUs, barcodes and launch dates live here — this is the table
-- the review flagged as readable AND deletable by any login.

alter table public.linesheet_products      enable row level security;
alter table public.linesheet_product_locks enable row level security;

create policy "Approved staff can read linesheet_products"
  on public.linesheet_products for select to authenticated
  using ((select public.btv_is_member()));
create policy "Linesheet editors can insert linesheet_products"
  on public.linesheet_products for insert to authenticated
  with check ((select public.btv_can_edit('linesheet')));
create policy "Linesheet editors can update linesheet_products"
  on public.linesheet_products for update to authenticated
  using      ((select public.btv_can_edit('linesheet')))
  with check ((select public.btv_can_edit('linesheet')));
create policy "Linesheet editors can delete linesheet_products"
  on public.linesheet_products for delete to authenticated
  using ((select public.btv_can_edit('linesheet')));

-- Lock rows are written only by the SECURITY DEFINER lock functions.
create policy "Approved staff can read linesheet_product_locks"
  on public.linesheet_product_locks for select to authenticated
  using ((select public.btv_is_member()));


-- ── 9. change_log ─────────────────────────────────────────────
-- The site only reads this today; inserts are limited to staff writing
-- under their own id. No update/delete — it's an audit trail.

alter table public.change_log enable row level security;

create policy "Approved staff can read change_log"
  on public.change_log for select to authenticated
  using ((select public.btv_is_member()));

create policy "Approved staff can insert own change_log rows"
  on public.change_log for insert to authenticated
  with check ((select public.btv_is_member()) and changed_by = (select auth.uid()));


-- ── 10. Stamp updated_by server-side ─────────────────────────
-- The client still sends updated_by, but the database now overwrites it with
-- the real caller, so a wrong or spoofed author can't be recorded. Only when
-- the content actually changes — the calendar lock RPCs update
-- calendar_entries rows too, and taking a lock shouldn't make you the "last
-- editor". Skipped when auth.uid() is null (service role, e.g. the Monday
-- reminder Edge Function, or SQL run from the dashboard).

create or replace function public.btv_stamp_updated_by()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    NEW.updated_by := auth.uid();
  elsif TG_TABLE_NAME = 'app_state' then
    if NEW.value is distinct from OLD.value then NEW.updated_by := auth.uid(); end if;
  else
    if NEW.data is distinct from OLD.data then NEW.updated_by := auth.uid(); end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists btv_stamp_updated_by on public.app_state;
drop trigger if exists btv_stamp_updated_by on public.calendar_entries;
drop trigger if exists btv_stamp_updated_by on public.global_cal_entries;
drop trigger if exists btv_stamp_updated_by on public.marketing_entries;
drop trigger if exists btv_stamp_updated_by on public.linesheet_products;

create trigger btv_stamp_updated_by before insert or update on public.app_state
  for each row execute function public.btv_stamp_updated_by();
create trigger btv_stamp_updated_by before insert or update on public.calendar_entries
  for each row execute function public.btv_stamp_updated_by();
create trigger btv_stamp_updated_by before insert or update on public.global_cal_entries
  for each row execute function public.btv_stamp_updated_by();
create trigger btv_stamp_updated_by before insert or update on public.marketing_entries
  for each row execute function public.btv_stamp_updated_by();
create trigger btv_stamp_updated_by before insert or update on public.linesheet_products
  for each row execute function public.btv_stamp_updated_by();

commit;


-- ── TESTING (after running) ──────────────────────────────────
-- Use a real non-admin staff account, NOT your admin account — admins pass
-- more checks and would hide a problem.
--   1. Sign in: all three tabs load with data; no red "could not save" bar.
--   2. Edit + save in each tab you have edit rights on; reload; still there.
--   3. Global Calendar: publish a marketing event to the calendar and check
--      it shows in Product Calendar Input (the 'events' bridge).
--   4. Untick one module's "edit" for that account in User Management and
--      confirm a save there now fails (the site shows its save-error bar).
--      Note: pages may still show edit controls to view-only users — the
--      database now refuses the write, but the UI doesn't pre-empt it.
--   5. Create a throwaway account via Authentication → Users → Add user:
--      it should sign in and see "You don't have access". Delete it after.
--
-- Spot-check as a given user from the SQL Editor (run all five lines together):
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<user uuid>","role":"authenticated"}';
--   select public.btv_is_member(), public.btv_can_edit('linesheet'),
--          (select count(*) from public.linesheet_products) as visible_products;
--   rollback;


-- ── ROLLBACK (only if the site breaks and you need the old behaviour back) ──
-- Restores "any login can do anything" on the data tables. Signup should
-- stay OFF if you ever run this.
--
--   do $$
--   declare t text;
--   begin
--     foreach t in array array['app_state','calendar_entries','global_cal_entries',
--                              'marketing_entries','linesheet_products','change_log','linesheet_product_locks']
--     loop
--       execute format('create policy "rollback all select" on public.%I for select to authenticated using (true)', t);
--       if t not in ('linesheet_product_locks') then
--         execute format('create policy "rollback all insert" on public.%I for insert to authenticated with check (true)', t);
--       end if;
--       if t not in ('change_log','linesheet_product_locks') then
--         execute format('create policy "rollback all update" on public.%I for update to authenticated using (true)', t);
--       end if;
--       if t in ('calendar_entries','global_cal_entries','marketing_entries','linesheet_products') then
--         execute format('create policy "rollback all delete" on public.%I for delete to authenticated using (true)', t);
--       end if;
--     end loop;
--   end $$;
