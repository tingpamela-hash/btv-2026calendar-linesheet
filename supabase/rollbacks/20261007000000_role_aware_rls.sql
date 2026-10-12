drop policy if exists app_state_select_reader on public.app_state;
drop policy if exists app_state_insert_editor on public.app_state;
drop policy if exists app_state_update_editor on public.app_state;
drop policy if exists "Authenticated users can read app_state" on public.app_state;
drop policy if exists "Authenticated users can write app_state" on public.app_state;
drop policy if exists "Authenticated users can update app_state" on public.app_state;

create policy "Authenticated users can read app_state"
  on public.app_state for select to authenticated
  using (true);
create policy "Authenticated users can write app_state"
  on public.app_state for insert to authenticated
  with check (true);
create policy "Authenticated users can update app_state"
  on public.app_state for update to authenticated
  using (true);

drop policy if exists user_profiles_select_reader on public.user_profiles;
drop policy if exists user_profiles_insert_own on public.user_profiles;
drop policy if exists user_profiles_update_own on public.user_profiles;
drop policy if exists user_profiles_update_admin on public.user_profiles;
drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Authenticated users can read all profiles" on public.user_profiles;
drop policy if exists "Allow insert on user_profiles" on public.user_profiles;
drop policy if exists "Admins can update any profile" on public.user_profiles;

create policy "Users can read own profile"
  on public.user_profiles for select to authenticated
  using (auth.uid() = id);
create policy "Authenticated users can read all profiles"
  on public.user_profiles for select to authenticated
  using (true);
create policy "Allow insert on user_profiles"
  on public.user_profiles for insert to authenticated
  with check (true);
create policy "Admins can update any profile"
  on public.user_profiles for update to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

drop policy if exists change_log_select_reader on public.change_log;
drop policy if exists change_log_insert_editor on public.change_log;
drop policy if exists "Authenticated users can read change_log" on public.change_log;
drop policy if exists "Authenticated users can insert change_log" on public.change_log;

create policy "Authenticated users can read change_log"
  on public.change_log for select to authenticated
  using (true);
create policy "Authenticated users can insert change_log"
  on public.change_log for insert to authenticated
  with check (true);

do $$
begin
  if to_regclass('public.linesheet_products') is not null then
    execute 'drop policy if exists linesheet_products_select_reader on public.linesheet_products';
    execute 'drop policy if exists linesheet_products_insert_editor on public.linesheet_products';
    execute 'drop policy if exists linesheet_products_update_editor on public.linesheet_products';
    execute 'drop policy if exists linesheet_products_delete_editor on public.linesheet_products';
    execute 'drop policy if exists "Authenticated users can read linesheet_products" on public.linesheet_products';
    execute 'drop policy if exists "Authenticated users can insert linesheet_products" on public.linesheet_products';
    execute 'drop policy if exists "Authenticated users can update linesheet_products" on public.linesheet_products';
    execute 'drop policy if exists "Authenticated users can delete linesheet_products" on public.linesheet_products';
    execute 'create policy "Authenticated users can read linesheet_products" on public.linesheet_products for select to authenticated using (true)';
    execute 'create policy "Authenticated users can insert linesheet_products" on public.linesheet_products for insert to authenticated with check (true)';
    execute 'create policy "Authenticated users can update linesheet_products" on public.linesheet_products for update to authenticated using (true)';
    execute 'create policy "Authenticated users can delete linesheet_products" on public.linesheet_products for delete to authenticated using (true)';
  end if;
end $$;

drop policy if exists creative_marketing_read on storage.objects;
drop policy if exists creative_marketing_insert_editor on storage.objects;
drop policy if exists creative_marketing_delete_editor on storage.objects;
drop policy if exists "creative_marketing_upload" on storage.objects;
drop policy if exists "creative_marketing_read" on storage.objects;
drop policy if exists "creative_marketing_delete" on storage.objects;

create policy "creative_marketing_upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'creative-marketing');
create policy "creative_marketing_read"
  on storage.objects for select
  using (bucket_id = 'creative-marketing');
create policy "creative_marketing_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'creative-marketing');

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'global_cal_entries'
  ) then
    alter publication supabase_realtime drop table public.global_cal_entries;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'marketing_entries'
  ) then
    alter publication supabase_realtime drop table public.marketing_entries;
  end if;
end $$;

drop table if exists public.global_cal_entries;
drop table if exists public.marketing_entries;

drop trigger if exists user_profiles_guard on public.user_profiles;
drop function if exists btv.guard_profile();
drop function if exists btv.can_write(text);
drop function if exists btv.is_admin();
drop schema if exists btv;
