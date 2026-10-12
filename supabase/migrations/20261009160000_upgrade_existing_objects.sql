create table if not exists public.btv_upgrade_created (
  name text primary key
);

do $$
begin
  if to_regclass('public.app_state') is null then
    create table public.app_state (
      key text primary key,
      value jsonb not null default '{}',
      updated_at timestamptz not null default now(),
      updated_by uuid references auth.users(id) on delete set null
    );
    alter table public.app_state enable row level security;
    insert into public.btv_upgrade_created(name) values ('app_state') on conflict do nothing;
  end if;
  if to_regclass('public.change_log') is null then
    create table public.change_log (
      id bigint generated always as identity primary key,
      key text not null,
      label text,
      changed_by uuid references auth.users(id) on delete set null,
      email text,
      changed_at timestamptz not null default now()
    );
    create index change_log_changed_at_idx on public.change_log (changed_at desc);
    alter table public.change_log enable row level security;
    insert into public.btv_upgrade_created(name) values ('change_log') on conflict do nothing;
  end if;
  if to_regclass('public.user_profiles') is null then
    create table public.user_profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text,
      can_access_product_calendar boolean not null default true,
      can_access_linesheet boolean not null default true,
      created_at timestamptz not null default now()
    );
    alter table public.user_profiles enable row level security;
    insert into public.btv_upgrade_created(name) values ('user_profiles') on conflict do nothing;
  end if;
end $$;

alter table public.user_profiles
  add column if not exists can_access_global_calendar boolean not null default false,
  add column if not exists can_edit_product_calendar boolean not null default false,
  add column if not exists can_edit_global_calendar boolean not null default false,
  add column if not exists can_edit_linesheet boolean not null default false,
  add column if not exists is_admin boolean not null default false;

alter table public.user_profiles
  alter column can_access_product_calendar set default true,
  alter column can_access_global_calendar set default true,
  alter column can_access_linesheet set default true,
  alter column can_edit_product_calendar set default false,
  alter column can_edit_global_calendar set default false,
  alter column can_edit_linesheet set default false,
  alter column is_admin set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (
    id,
    email,
    can_access_product_calendar,
    can_access_global_calendar,
    can_access_linesheet,
    can_edit_product_calendar,
    can_edit_global_calendar,
    can_edit_linesheet,
    is_admin
  )
  values (new.id, new.email, true, true, true, false, false, false, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

insert into storage.buckets (id, name, public)
select 'creative-marketing', 'creative-marketing', false
where not exists (select 1 from storage.buckets where id = 'creative-marketing');

do $$
begin
  if to_regclass('public.app_state') is not null and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
  if to_regclass('public.change_log') is not null and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'change_log'
  ) then
    alter publication supabase_realtime add table public.change_log;
  end if;
end $$;
