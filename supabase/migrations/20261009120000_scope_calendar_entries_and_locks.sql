-- Access rules for calendar_entries and linesheet_product_locks.
-- Her create files leave both tables open to every signed-in user.
-- This file runs after the scoped-read migrations and uses those helpers.
-- Columns are the ones in her create, year, and lock SQL. Nothing else is added.

drop policy if exists "Authenticated users can read calendar_entries" on public.calendar_entries;
drop policy if exists "Authenticated users can insert calendar_entries" on public.calendar_entries;
drop policy if exists "Authenticated users can update calendar_entries" on public.calendar_entries;
drop policy if exists "Authenticated users can delete calendar_entries" on public.calendar_entries;
drop policy if exists calendar_entries_select_member on public.calendar_entries;
drop policy if exists calendar_entries_insert_editor on public.calendar_entries;
drop policy if exists calendar_entries_update_editor on public.calendar_entries;
drop policy if exists calendar_entries_delete_editor on public.calendar_entries;

-- Linesheet and Global Calendar both read this table. A per-module read
-- would hide rows those pages already load. Writes stay on the editor flag.
-- Global Calendar editors may write section 'events' only. That is the
-- marketing-event row her lockdown already allows.

create policy calendar_entries_select_member
  on public.calendar_entries for select to authenticated
  using (
    btv.can_access('product')
    or btv.can_access('global')
    or btv.can_access('linesheet')
  );

create policy calendar_entries_insert_editor
  on public.calendar_entries for insert to authenticated
  with check (
    btv.can_write('product')
    or (section = 'events' and btv.can_write('global'))
  );

create policy calendar_entries_update_editor
  on public.calendar_entries for update to authenticated
  using (
    btv.can_write('product')
    or (section = 'events' and btv.can_write('global'))
  )
  with check (
    btv.can_write('product')
    or (section = 'events' and btv.can_write('global'))
  );

create policy calendar_entries_delete_editor
  on public.calendar_entries for delete to authenticated
  using (
    btv.can_write('product')
    or (section = 'events' and btv.can_write('global'))
  );

drop policy if exists "Authenticated users can read linesheet_product_locks" on public.linesheet_product_locks;
drop policy if exists linesheet_product_locks_select_member on public.linesheet_product_locks;

-- Lock rows are written only by the security-definer lock functions.
-- There is no insert, update, or delete policy.

create policy linesheet_product_locks_select_member
  on public.linesheet_product_locks for select to authenticated
  using (
    btv.can_access('product')
    or btv.can_access('global')
    or btv.can_access('linesheet')
  );

-- Her global and marketing create files use open policy names that the
-- earlier migration does not drop. Drop them or they stay OR-ed with the
-- editor policies.

drop policy if exists "Authenticated users can read global_cal_entries" on public.global_cal_entries;
drop policy if exists "Authenticated users can insert global_cal_entries" on public.global_cal_entries;
drop policy if exists "Authenticated users can update global_cal_entries" on public.global_cal_entries;
drop policy if exists "Authenticated users can delete global_cal_entries" on public.global_cal_entries;
drop policy if exists "Authenticated users can read marketing_entries" on public.marketing_entries;
drop policy if exists "Authenticated users can insert marketing_entries" on public.marketing_entries;
drop policy if exists "Authenticated users can update marketing_entries" on public.marketing_entries;
drop policy if exists "Authenticated users can delete marketing_entries" on public.marketing_entries;
