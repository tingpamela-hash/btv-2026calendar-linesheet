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

revoke all on function btv.can_write(text) from public;
grant execute on function btv.can_write(text) to authenticated;

drop policy if exists app_state_select_scoped on public.app_state;
drop policy if exists app_state_insert_scoped on public.app_state;
drop policy if exists app_state_update_scoped on public.app_state;
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

drop policy if exists user_profiles_select_own on public.user_profiles;
drop policy if exists user_profiles_select_admin on public.user_profiles;
drop policy if exists user_profiles_select_reader on public.user_profiles;

create policy user_profiles_select_reader
  on public.user_profiles for select to authenticated
  using (true);

drop policy if exists global_cal_entries_select_reader on public.global_cal_entries;
create policy global_cal_entries_select_reader
  on public.global_cal_entries for select to authenticated
  using (true);

drop policy if exists marketing_entries_select_reader on public.marketing_entries;
create policy marketing_entries_select_reader
  on public.marketing_entries for select to authenticated
  using (true);

drop function if exists btv.app_state_read(text);
drop function if exists btv.app_state_write(text);
drop function if exists btv.app_state_scope(text);
drop function if exists btv.can_access(text);
