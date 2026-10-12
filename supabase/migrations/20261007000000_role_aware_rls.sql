create schema if not exists btv;
revoke all on schema btv from public;
grant usage on schema btv to authenticated;

create or replace function btv.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_admin
    from public.user_profiles p
    where p.id = auth.uid()
  ), false);
$$;

create or replace function btv.can_write(scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case scope
    when 'shared' then exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid()
        and (
          p.is_admin
          or p.can_edit_product_calendar
          or p.can_edit_global_calendar
          or p.can_edit_linesheet
        )
    )
    when 'linesheet' then exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid()
        and (p.is_admin or p.can_edit_linesheet)
    )
    when 'global' then exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid()
        and (p.is_admin or p.can_edit_global_calendar)
    )
    else false
  end;
$$;

revoke all on function btv.is_admin() from public;
revoke all on function btv.can_write(text) from public;
grant execute on function btv.is_admin() to authenticated;
grant execute on function btv.can_write(text) to authenticated;

create or replace function btv.guard_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if btv.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.id is distinct from auth.uid() then
      raise exception 'profile insert is own-row only' using errcode = '42501';
    end if;
    new.is_admin := false;
    new.can_edit_product_calendar := false;
    new.can_edit_global_calendar := false;
    new.can_edit_linesheet := false;
    return new;
  end if;
  if new.id is distinct from old.id or new.id is distinct from auth.uid() then
    raise exception 'profile update is own-row only' using errcode = '42501';
  end if;
  if new.is_admin is distinct from old.is_admin
     or new.can_edit_product_calendar is distinct from old.can_edit_product_calendar
     or new.can_edit_global_calendar is distinct from old.can_edit_global_calendar
     or new.can_edit_linesheet is distinct from old.can_edit_linesheet
     or new.can_access_product_calendar is distinct from old.can_access_product_calendar
     or new.can_access_global_calendar is distinct from old.can_access_global_calendar
     or new.can_access_linesheet is distinct from old.can_access_linesheet
  then
    raise exception 'role change is admin-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function btv.guard_profile() from public;

drop trigger if exists user_profiles_guard on public.user_profiles;
create trigger user_profiles_guard
  before insert or update on public.user_profiles
  for each row
  execute function btv.guard_profile();

drop policy if exists "Authenticated users can read app_state" on public.app_state;
drop policy if exists "Authenticated users can write app_state" on public.app_state;
drop policy if exists "Authenticated users can update app_state" on public.app_state;
drop policy if exists app_state_select_reader on public.app_state;
drop policy if exists app_state_insert_editor on public.app_state;
drop policy if exists app_state_update_editor on public.app_state;

create policy app_state_select_reader
  on public.app_state for select to authenticated
  using (true);

create policy app_state_insert_editor
  on public.app_state for insert to authenticated
  with check (btv.can_write('shared'));

create policy app_state_update_editor
  on public.app_state for update to authenticated
  using (btv.can_write('shared'))
  with check (btv.can_write('shared'));

drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Authenticated users can read all profiles" on public.user_profiles;
drop policy if exists "Authenticated users can update profiles" on public.user_profiles;
drop policy if exists "Allow insert on user_profiles" on public.user_profiles;
drop policy if exists "Admins can update any profile" on public.user_profiles;
drop policy if exists user_profiles_select_reader on public.user_profiles;
drop policy if exists user_profiles_insert_own on public.user_profiles;
drop policy if exists user_profiles_update_own on public.user_profiles;
drop policy if exists user_profiles_update_admin on public.user_profiles;

create policy user_profiles_select_reader
  on public.user_profiles for select to authenticated
  using (true);

create policy user_profiles_insert_own
  on public.user_profiles for insert to authenticated
  with check (
    id = auth.uid()
    and (
      btv.is_admin()
      or (
        coalesce(is_admin, false) = false
        and coalesce(can_edit_product_calendar, false) = false
        and coalesce(can_edit_global_calendar, false) = false
        and coalesce(can_edit_linesheet, false) = false
      )
    )
  );

create policy user_profiles_update_own
  on public.user_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy user_profiles_update_admin
  on public.user_profiles for update to authenticated
  using (btv.is_admin())
  with check (btv.is_admin());

drop policy if exists "Authenticated users can read change_log" on public.change_log;
drop policy if exists "Authenticated users can insert change_log" on public.change_log;
drop policy if exists change_log_select_reader on public.change_log;
drop policy if exists change_log_insert_editor on public.change_log;

create policy change_log_select_reader
  on public.change_log for select to authenticated
  using (true);

create policy change_log_insert_editor
  on public.change_log for insert to authenticated
  with check (btv.can_write('shared'));

do $$
begin
  if to_regclass('public.linesheet_products') is null then
    return;
  end if;
  execute 'drop policy if exists "Authenticated users can read linesheet_products" on public.linesheet_products';
  execute 'drop policy if exists "Authenticated users can insert linesheet_products" on public.linesheet_products';
  execute 'drop policy if exists "Authenticated users can update linesheet_products" on public.linesheet_products';
  execute 'drop policy if exists "Authenticated users can delete linesheet_products" on public.linesheet_products';
  execute 'drop policy if exists linesheet_products_select_reader on public.linesheet_products';
  execute 'drop policy if exists linesheet_products_insert_editor on public.linesheet_products';
  execute 'drop policy if exists linesheet_products_update_editor on public.linesheet_products';
  execute 'drop policy if exists linesheet_products_delete_editor on public.linesheet_products';
  execute 'create policy linesheet_products_select_reader on public.linesheet_products for select to authenticated using (true)';
  execute 'create policy linesheet_products_insert_editor on public.linesheet_products for insert to authenticated with check (btv.can_write(''linesheet''))';
  execute 'create policy linesheet_products_update_editor on public.linesheet_products for update to authenticated using (btv.can_write(''linesheet'')) with check (btv.can_write(''linesheet''))';
  execute 'create policy linesheet_products_delete_editor on public.linesheet_products for delete to authenticated using (btv.can_write(''linesheet''))';
  execute 'grant select, insert, update, delete on public.linesheet_products to authenticated';
end $$;

drop policy if exists "creative_marketing_upload" on storage.objects;
drop policy if exists "creative_marketing_read" on storage.objects;
drop policy if exists "creative_marketing_delete" on storage.objects;
drop policy if exists creative_marketing_read on storage.objects;
drop policy if exists creative_marketing_insert_editor on storage.objects;
drop policy if exists creative_marketing_delete_editor on storage.objects;

create policy creative_marketing_read
  on storage.objects for select
  using (bucket_id = 'creative-marketing');

create policy creative_marketing_insert_editor
  on storage.objects for insert to authenticated
  with check (bucket_id = 'creative-marketing' and btv.can_write('global'));

create policy creative_marketing_delete_editor
  on storage.objects for delete to authenticated
  using (bucket_id = 'creative-marketing' and btv.can_write('global'));

create table if not exists public.global_cal_entries (
  id text primary key,
  market text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.marketing_entries (
  id text primary key,
  market text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.global_cal_entries enable row level security;
alter table public.marketing_entries enable row level security;

drop policy if exists global_cal_entries_select_reader on public.global_cal_entries;
drop policy if exists global_cal_entries_insert_editor on public.global_cal_entries;
drop policy if exists global_cal_entries_update_editor on public.global_cal_entries;
drop policy if exists global_cal_entries_delete_editor on public.global_cal_entries;
drop policy if exists marketing_entries_select_reader on public.marketing_entries;
drop policy if exists marketing_entries_insert_editor on public.marketing_entries;
drop policy if exists marketing_entries_update_editor on public.marketing_entries;
drop policy if exists marketing_entries_delete_editor on public.marketing_entries;

create policy global_cal_entries_select_reader
  on public.global_cal_entries for select to authenticated
  using (true);
create policy global_cal_entries_insert_editor
  on public.global_cal_entries for insert to authenticated
  with check (btv.can_write('global'));
create policy global_cal_entries_update_editor
  on public.global_cal_entries for update to authenticated
  using (btv.can_write('global'))
  with check (btv.can_write('global'));
create policy global_cal_entries_delete_editor
  on public.global_cal_entries for delete to authenticated
  using (btv.can_write('global'));

create policy marketing_entries_select_reader
  on public.marketing_entries for select to authenticated
  using (true);
create policy marketing_entries_insert_editor
  on public.marketing_entries for insert to authenticated
  with check (btv.can_write('global'));
create policy marketing_entries_update_editor
  on public.marketing_entries for update to authenticated
  using (btv.can_write('global'))
  with check (btv.can_write('global'));
create policy marketing_entries_delete_editor
  on public.marketing_entries for delete to authenticated
  using (btv.can_write('global'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'global_cal_entries'
  ) then
    alter publication supabase_realtime add table public.global_cal_entries;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'marketing_entries'
  ) then
    alter publication supabase_realtime add table public.marketing_entries;
  end if;
end $$;

grant select, insert, update on public.app_state to authenticated;
grant select, insert, update on public.user_profiles to authenticated;
grant select, insert on public.change_log to authenticated;
grant select, insert, update, delete on public.global_cal_entries to authenticated;
grant select, insert, update, delete on public.marketing_entries to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
