do $$
begin
  if to_regclass('public.btv_upgrade_created') is null then
    return;
  end if;
  if exists (select 1 from public.btv_upgrade_created where name = 'app_state') then
    if exists (select 1 from public.app_state limit 1) then
      raise exception 'refusing to drop app_state while it has rows';
    end if;
    drop table public.app_state;
    delete from public.btv_upgrade_created where name = 'app_state';
  end if;
  if exists (select 1 from public.btv_upgrade_created where name = 'change_log') then
    if exists (select 1 from public.change_log limit 1) then
      raise exception 'refusing to drop change_log while it has rows';
    end if;
    drop table public.change_log;
    delete from public.btv_upgrade_created where name = 'change_log';
  end if;
  if exists (select 1 from public.btv_upgrade_created where name = 'user_profiles') then
    if exists (select 1 from public.user_profiles limit 1) then
      raise exception 'refusing to drop user_profiles while it has rows';
    end if;
    drop table public.user_profiles;
    delete from public.btv_upgrade_created where name = 'user_profiles';
  end if;
  if not exists (select 1 from public.btv_upgrade_created) then
    drop table public.btv_upgrade_created;
  end if;
end $$;
