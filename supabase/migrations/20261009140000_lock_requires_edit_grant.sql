
create or replace function btv.can_lock_calendar_entry(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select btv.can_write('product')
    or (
      btv.can_write('global')
      and exists (
        select 1
          from public.calendar_entries
         where id = p_id
           and section = 'events'
      )
    );
$$;

revoke all on function btv.can_lock_calendar_entry(text) from public;

create or replace function public.try_lock_linesheet_group(
  p_group_id text,
  p_email text,
  p_stale_minutes int default 2
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if p_stale_minutes is null or p_stale_minutes <= 0 then
    raise exception 'stale threshold must be positive' using errcode = '22023';
  end if;
  if not btv.can_write('linesheet') then
    return false;
  end if;
  insert into public.linesheet_product_locks (group_id, locked_by, locked_by_email, locked_at)
  values (p_group_id, auth.uid(), p_email, now())
  on conflict (group_id) do update
    set locked_by       = excluded.locked_by,
        locked_by_email = excluded.locked_by_email,
        locked_at       = excluded.locked_at
    where public.linesheet_product_locks.locked_by is null
       or public.linesheet_product_locks.locked_by = auth.uid()
       or public.linesheet_product_locks.locked_at < now() - (p_stale_minutes || ' minutes')::interval;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.unlock_linesheet_group(p_group_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.linesheet_product_locks
  set locked_by = null, locked_by_email = null, locked_at = null
  where group_id = p_group_id and locked_by = auth.uid();
end;
$$;

create or replace function public.refresh_linesheet_group_lock(p_group_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if not btv.can_write('linesheet') then
    return false;
  end if;
  update public.linesheet_product_locks
  set locked_at = now()
  where group_id = p_group_id and locked_by = auth.uid();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.try_lock_calendar_entry(
  p_id text,
  p_email text,
  p_stale_minutes int default 2
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if p_stale_minutes is null or p_stale_minutes <= 0 then
    raise exception 'stale threshold must be positive' using errcode = '22023';
  end if;
  if not btv.can_lock_calendar_entry(p_id) then
    return false;
  end if;
  update public.calendar_entries
  set locked_by       = auth.uid(),
      locked_by_email = p_email,
      locked_at       = now()
  where id = p_id
    and (
      locked_by is null
      or locked_by = auth.uid()
      or locked_at < now() - (p_stale_minutes || ' minutes')::interval
    );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.unlock_calendar_entry(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.calendar_entries
  set locked_by = null, locked_by_email = null, locked_at = null
  where id = p_id and locked_by = auth.uid();
end;
$$;

create or replace function public.refresh_calendar_entry_lock(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if not btv.can_lock_calendar_entry(p_id) then
    return false;
  end if;
  update public.calendar_entries
  set locked_at = now()
  where id = p_id and locked_by = auth.uid();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
