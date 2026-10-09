
drop policy if exists calendar_entries_select_member on public.calendar_entries;
drop policy if exists calendar_entries_insert_editor on public.calendar_entries;
drop policy if exists calendar_entries_update_editor on public.calendar_entries;
drop policy if exists calendar_entries_delete_editor on public.calendar_entries;

create policy "Authenticated users can read calendar_entries"
  on public.calendar_entries for select to authenticated using (true);
create policy "Authenticated users can insert calendar_entries"
  on public.calendar_entries for insert to authenticated with check (true);
create policy "Authenticated users can update calendar_entries"
  on public.calendar_entries for update to authenticated using (true);
create policy "Authenticated users can delete calendar_entries"
  on public.calendar_entries for delete to authenticated using (true);

drop policy if exists linesheet_product_locks_select_member on public.linesheet_product_locks;
create policy "Authenticated users can read linesheet_product_locks"
  on public.linesheet_product_locks for select to authenticated using (true);

create policy "Authenticated users can read global_cal_entries"
  on public.global_cal_entries for select to authenticated using (true);
create policy "Authenticated users can insert global_cal_entries"
  on public.global_cal_entries for insert to authenticated with check (true);
create policy "Authenticated users can update global_cal_entries"
  on public.global_cal_entries for update to authenticated using (true);
create policy "Authenticated users can delete global_cal_entries"
  on public.global_cal_entries for delete to authenticated using (true);
create policy "Authenticated users can read marketing_entries"
  on public.marketing_entries for select to authenticated using (true);
create policy "Authenticated users can insert marketing_entries"
  on public.marketing_entries for insert to authenticated with check (true);
create policy "Authenticated users can update marketing_entries"
  on public.marketing_entries for update to authenticated using (true);
create policy "Authenticated users can delete marketing_entries"
  on public.marketing_entries for delete to authenticated using (true);
