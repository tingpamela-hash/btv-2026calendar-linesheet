-- ============================================================
-- BTV Planner – Supabase Setup SQL
-- ⚠ ONCE supabase-rls-lockdown-migration.sql HAS BEEN RUN, DO NOT RE-RUN
--   THIS FILE: it recreates the old `using (true)` policies and section 4
--   re-grants access to every account. Run individual sections only.
-- Safe to re-run at any time — all statements are idempotent.
-- Run this entire script in Supabase → SQL Editor → New query
-- ============================================================

-- ── 1. app_state ─────────────────────────────────────────────

create table if not exists public.app_state (
  key        text        primary key,
  value      jsonb       not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

alter table public.app_state enable row level security;

drop policy if exists "Authenticated users can read app_state"   on public.app_state;
drop policy if exists "Authenticated users can write app_state"  on public.app_state;
drop policy if exists "Authenticated users can update app_state" on public.app_state;

create policy "Authenticated users can read app_state"
  on public.app_state for select
  to authenticated
  using (true);

create policy "Authenticated users can write app_state"
  on public.app_state for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update app_state"
  on public.app_state for update
  to authenticated
  using (true);


-- ── 2. user_profiles ─────────────────────────────────────────

create table if not exists public.user_profiles (
  id                        uuid        primary key references auth.users(id) on delete cascade,
  email                     text,
  can_access_product_calendar boolean  not null default true,
  can_access_linesheet      boolean     not null default true,
  created_at                timestamptz not null default now()
);

-- If table already existed with default false, update the defaults
alter table public.user_profiles
  alter column can_access_product_calendar set default true,
  alter column can_access_linesheet        set default true;

alter table public.user_profiles enable row level security;

drop policy if exists "Users can read own profile"               on public.user_profiles;
drop policy if exists "Authenticated users can read all profiles" on public.user_profiles;
drop policy if exists "Authenticated users can update profiles"  on public.user_profiles;
drop policy if exists "Allow insert on user_profiles"            on public.user_profiles;

create policy "Users can read own profile"
  on public.user_profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Authenticated users can read all profiles"
  on public.user_profiles for select
  to authenticated
  using (true);

create policy "Authenticated users can update profiles"
  on public.user_profiles for update
  to authenticated
  using (true);

create policy "Allow insert on user_profiles"
  on public.user_profiles for insert
  to authenticated
  with check (true);


-- ── 3. Trigger: auto-create profile on sign-up ───────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, can_access_product_calendar, can_access_linesheet)
  values (new.id, new.email, true, true)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ── 4. Grant access to all existing accounts ─────────────────
-- Fixes accounts that were created when the default was false.
-- Safe to re-run — only updates rows that are currently blocked.

update public.user_profiles
set can_access_product_calendar = true,
    can_access_linesheet        = true
where can_access_product_calendar = false
   or can_access_linesheet        = false;

-- Also ensure your own account has access.
insert into public.user_profiles (id, email, can_access_product_calendar, can_access_linesheet)
select id, email, true, true
from auth.users
where email = 'charmaine.lau.btv@gmail.com'
on conflict (id) do update
  set can_access_product_calendar = true,
      can_access_linesheet        = true;

-- ── Diagnostic: see all accounts and their access ────────────
-- Run this separately to check who has access and who doesn't:
--
--   select email, can_access_product_calendar, can_access_linesheet, created_at
--   from public.user_profiles
--   order by created_at;
--

-- ── 5. change_log ────────────────────────────────────────────

create table if not exists public.change_log (
  id          bigint      generated always as identity primary key,
  key         text        not null,
  label       text,
  changed_by  uuid        references auth.users(id) on delete set null,
  email       text,
  changed_at  timestamptz not null default now()
);

create index if not exists change_log_changed_at_idx on public.change_log (changed_at desc);

alter table public.change_log enable row level security;

drop policy if exists "Authenticated users can read change_log"   on public.change_log;
drop policy if exists "Authenticated users can insert change_log" on public.change_log;

create policy "Authenticated users can read change_log"
  on public.change_log for select
  to authenticated
  using (true);

create policy "Authenticated users can insert change_log"
  on public.change_log for insert
  to authenticated
  with check (true);


-- ── 6. Enable Realtime on app_state ─────────────────────────

-- Adds app_state to the Realtime publication if not already there.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end;
$$;


-- ── 7. Viewer / Editor permission columns ────────────────────
-- These let admins set per-user edit access for each module.
-- can_access_* controls visibility; can_edit_* controls write access.
-- Column names match the site's tab names exactly:
--   Product Calendar Input -> can_access_product_calendar / can_edit_product_calendar
--   Global Calendar         -> can_access_global_calendar  / can_edit_global_calendar
--   Linesheet               -> can_access_linesheet        / can_edit_linesheet

alter table public.user_profiles
  add column if not exists can_access_global_calendar  boolean not null default true,
  add column if not exists can_edit_product_calendar   boolean not null default true,
  add column if not exists can_edit_global_calendar    boolean not null default true,
  add column if not exists can_edit_linesheet          boolean not null default true;


-- ── 10. Storage bucket for Marketing event images ────────────
-- Used by the Creative Calendar's Marketing group (Brand Events,
-- Community Activation, Retail Activation, Digital Activation)
-- for the "Images Upload" field.

insert into storage.buckets (id, name, public)
values ('creative-marketing', 'creative-marketing', true)
on conflict (id) do nothing;

drop policy if exists "creative_marketing_upload" on storage.objects;
drop policy if exists "creative_marketing_read"   on storage.objects;
drop policy if exists "creative_marketing_delete" on storage.objects;

create policy "creative_marketing_upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'creative-marketing');

create policy "creative_marketing_read"
  on storage.objects for select
  using (bucket_id = 'creative-marketing');

create policy "creative_marketing_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'creative-marketing');


-- ── 11. Weekly linesheet email reminder (Monday cron) ────────
-- Notification recipients are stored as a normal app_state row
-- (key 'btv-linesheet-notify-emails-v1') edited from the "Notify
-- Emails" button in the top nav — no extra table needed.
--
-- This section schedules a database cron job that calls the
-- `linesheet-monday-reminder` Edge Function every Monday at
-- 01:00 UTC (09:00 Singapore time). Before this will work you must:
--   1. Deploy the function: supabase/functions/linesheet-monday-reminder
--   2. Set its secret:  supabase secrets set RESEND_API_KEY=re_xxx
--   3. Run this section (safe to re-run — it drops + recreates the job)

-- ── 12. Lock down user_profiles UPDATE to admins only ────────
-- Previously "Authenticated users can update profiles" used "using (true)",
-- meaning ANY logged-in user could grant themselves (or anyone else) full
-- access via a direct client call — the admin passcode in the User
-- Management panel is a client-side-only UI gate and was never actually
-- enforced by the database. This adds a real is_admin column and rewrites
-- the UPDATE policy to check it server-side.

alter table public.user_profiles
  add column if not exists is_admin boolean not null default false;

drop policy if exists "Authenticated users can update profiles" on public.user_profiles;

create policy "Admins can update any profile"
  on public.user_profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

-- Grant admin to your own account. Add more emails here (or run this
-- update manually) for anyone else who should be able to manage users.
update public.user_profiles
set is_admin = true
where email = 'charmaine.lau.btv@gmail.com';


-- ── Done! ─────────────────────────────────────────────────────
