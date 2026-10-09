do $$
begin
  if to_regclass('public.linesheet_products') is null then
    return;
  end if;
  execute 'drop policy if exists "Authenticated users can read linesheet_products" on public.linesheet_products';
  execute 'drop policy if exists linesheet_products_select_reader on public.linesheet_products';
  execute 'create policy linesheet_products_select_reader on public.linesheet_products for select to authenticated using (btv.can_access(''linesheet''))';
end $$;

drop policy if exists "Authenticated users can read change_log" on public.change_log;
drop policy if exists change_log_select_reader on public.change_log;
create policy change_log_select_reader
  on public.change_log for select to authenticated
  using (btv.app_state_read(key));
