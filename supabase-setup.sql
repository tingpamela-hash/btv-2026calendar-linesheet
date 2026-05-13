-- ============================================================
-- BTV Planner – Supabase Setup SQL
-- Run this entire script in Supabase → SQL Editor → New query
-- ============================================================

-- ── 1. app_state ─────────────────────────────────────────────
-- Key-value store for all shared app data (calendar state,
-- linesheet launch list, change logs, etc.)

create table if not exists public.app_state (
  key        text        primary key,
  value      jsonb       not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

alter table public.app_state enable row level security;

-- Authenticated users can read and write all app state.
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
-- Controls which users can access the Calendar and/or Linesheet.

create table if not exists public.user_profiles (
  id             uuid        primary key references auth.users(id) on delete cascade,
  email          text,
  can_access_cal boolean     not null default false,
  can_access_ls  boolean     not null default false,
  created_at     timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Users can read their own profile.
create policy "Users can read own profile"
  on public.user_profiles for select
  to authenticated
  using (auth.uid() = id);

-- Any authenticated user can read ALL profiles (needed for the admin panel).
create policy "Authenticated users can read all profiles"
  on public.user_profiles for select
  to authenticated
  using (true);

-- Any authenticated user can update profiles (admin panel uses this).
-- For a tighter setup, restrict this to users where is_admin = true.
create policy "Authenticated users can update profiles"
  on public.user_profiles for update
  to authenticated
  using (true);

-- Allow the trigger function to insert new rows.
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
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ── 4. Grant yourself admin access ───────────────────────────
-- Run this AFTER you have signed in at least once so your row exists.
-- Replace the email with yours.

update public.user_profiles
set can_access_cal = true,
    can_access_ls  = true
where email = 'charmaine.lau.btv@gmail.com';

-- ── Done! ─────────────────────────────────────────────────────
