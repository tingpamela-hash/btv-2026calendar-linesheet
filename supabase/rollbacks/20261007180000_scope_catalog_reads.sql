do $$
begin
  if to_regclass('public.linesheet_products') is null then
    return;
  end if;
  execute 'drop policy if exists linesheet_products_select_reader on public.linesheet_products';
  execute 'create policy linesheet_products_select_reader on public.linesheet_products for select to authenticated using (true)';
end $$;

drop policy if exists change_log_select_reader on public.change_log;
create policy change_log_select_reader
  on public.change_log for select to authenticated
  using (true);
