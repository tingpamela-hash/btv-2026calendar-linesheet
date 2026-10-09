create or replace function btv.can_access(scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case scope
    when 'product' then exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid()
        and (p.is_admin or p.can_access_product_calendar)
    )
    when 'global' then exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid()
        and (p.is_admin or p.can_access_global_calendar)
    )
    when 'linesheet' then exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid()
        and (p.is_admin or p.can_access_linesheet)
    )
    else false
  end;
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
    when 'product' then exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid()
        and (p.is_admin or p.can_edit_product_calendar)
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

create or replace function btv.app_state_scope(item_key text)
returns text
language sql
immutable
as $$
  select case
    when item_key ~ '^calendar-[0-9]{4}-working-v5(-history|-versions|-changelog)?$' then 'product'
    when item_key ~ '^calendar-[0-9]{4}-marketing-workflow-v1$' then 'product'
    when item_key ~ '^calendar-[0-9]{4}-markdown-bars-v1$' then 'product'
    when item_key = 'linesheetCalendarData' or item_key ~ '^linesheetCalendarData-[0-9]{4}$' then 'linesheet'
    when item_key in ('launchListMaster', 'btvLinesheetChangeLog') then 'linesheet'
    when item_key = 'creative-cal-2026-v1' then 'global'
    when item_key = 'btv-admin-config-v1' then 'admin-config'
    when item_key = 'btv-linesheet-notify-emails-v1' then 'notify'
    else 'deny'
  end;
$$;

create or replace function btv.app_state_read(item_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case btv.app_state_scope(item_key)
    when 'product' then btv.can_access('product') or btv.can_access('global')
    when 'linesheet' then btv.can_access('linesheet') or btv.can_access('product')
    when 'global' then btv.can_access('global') or btv.can_access('product')
    when 'admin-config' then btv.can_access('product')
    when 'notify' then btv.is_admin()
    else false
  end;
$$;

create or replace function btv.app_state_write(item_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case btv.app_state_scope(item_key)
    when 'product' then btv.can_write('product')
    when 'linesheet' then btv.can_write('linesheet') or btv.can_write('product')
    when 'global' then btv.can_write('global')
    when 'admin-config' then btv.can_write('product')
    when 'notify' then btv.is_admin()
    else false
  end;
$$;

revoke all on function btv.can_access(text) from public;
revoke all on function btv.can_write(text) from public;
revoke all on function btv.app_state_scope(text) from public;
revoke all on function btv.app_state_read(text) from public;
revoke all on function btv.app_state_write(text) from public;
grant execute on function btv.can_access(text) to authenticated;
grant execute on function btv.can_write(text) to authenticated;
grant execute on function btv.app_state_scope(text) to authenticated;
grant execute on function btv.app_state_read(text) to authenticated;
grant execute on function btv.app_state_write(text) to authenticated;

drop policy if exists app_state_select_reader on public.app_state;
drop policy if exists app_state_insert_editor on public.app_state;
drop policy if exists app_state_update_editor on public.app_state;
drop policy if exists app_state_select_scoped on public.app_state;
drop policy if exists app_state_insert_scoped on public.app_state;
drop policy if exists app_state_update_scoped on public.app_state;

create policy app_state_select_scoped
  on public.app_state for select to authenticated
  using (btv.app_state_read(key));

create policy app_state_insert_scoped
  on public.app_state for insert to authenticated
  with check (btv.app_state_write(key));

create policy app_state_update_scoped
  on public.app_state for update to authenticated
  using (btv.app_state_write(key))
  with check (btv.app_state_write(key));

drop policy if exists user_profiles_select_reader on public.user_profiles;
drop policy if exists user_profiles_select_own on public.user_profiles;
drop policy if exists user_profiles_select_admin on public.user_profiles;

create policy user_profiles_select_own
  on public.user_profiles for select to authenticated
  using (id = auth.uid());

create policy user_profiles_select_admin
  on public.user_profiles for select to authenticated
  using (btv.is_admin());

drop policy if exists global_cal_entries_select_reader on public.global_cal_entries;
create policy global_cal_entries_select_reader
  on public.global_cal_entries for select to authenticated
  using (btv.can_access('global'));

drop policy if exists marketing_entries_select_reader on public.marketing_entries;
create policy marketing_entries_select_reader
  on public.marketing_entries for select to authenticated
  using (btv.can_access('global'));

insert into storage.buckets (id, name, public)
values ('creative-marketing', 'creative-marketing', false)
on conflict (id) do update set public = false;

drop policy if exists creative_marketing_read on storage.objects;
create policy creative_marketing_read
  on storage.objects for select
  to authenticated
  using (bucket_id = 'creative-marketing' and btv.can_access('global'));

revoke select on storage.objects from anon;
