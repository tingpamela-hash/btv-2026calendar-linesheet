-- ============================================================
-- BTV Planner – Linesheet: hard product-group locking
--
-- WHY: Linesheet already has a presence-based "who's editing" indicator
-- (a WebSocket broadcast each browser sends about what it's looking at) —
-- useful for the "🔒 Jane is editing" badge and the amber outline in
-- Master Data, but not a real lock. Nothing stops a browser from saving
-- anyway if it never received (or raced ahead of) the other person's
-- broadcast. Two people opening the same product within the same second
-- or so can both slip past the check before either has heard about the
-- other, because nothing actually adjudicates who got there first.
--
-- This is the exact same gap that was found and fixed for Product
-- Calendar Input (see supabase-calendar-entries-lock-migration.sql). This
-- migration brings Linesheet's product editor in line with the same
-- pattern.
--
-- A product in Linesheet is really a GROUP of rows (one per colour
-- variant) sharing the same group_id — the editor opens/saves/deletes the
-- whole group at once. So the lock is keyed on group_id, in its own small
-- table, rather than adding lock columns to every variant row:
--   • try_lock_linesheet_group() atomically claims the lock in a single
--     upsert — Postgres itself serialises concurrent calls on the same
--     group_id, so exactly one caller can ever win a contested lock. This
--     is the actual fix for the race; nothing client-side can replicate it.
--   • unlock_linesheet_group() releases a lock you hold.
--   • A trigger on linesheet_products rejects any insert/update to a row
--     whose group_id is locked by someone else, so even a buggy or
--     bypassing client can't overwrite a locked product — this is what
--     makes it a hard lock rather than a UI courtesy.
--   • Locks auto-expire after 2 minutes of inactivity (matches the
--     existing presence-based stale-lock window), so a crashed tab can
--     never permanently strand a product.
--
-- Safe to re-run — every statement is idempotent (create-or-replace,
-- drop-if-exists).
-- ============================================================

-- ── 1. Lock table ─────────────────────────────────────────────
-- One row per product group, created on first lock attempt.

create table if not exists public.linesheet_product_locks (
  group_id        text primary key,
  locked_by       uuid references auth.users(id) on delete set null,
  locked_by_email text,
  locked_at       timestamptz
);

alter table public.linesheet_product_locks enable row level security;

drop policy if exists "Authenticated users can read linesheet_product_locks" on public.linesheet_product_locks;
create policy "Authenticated users can read linesheet_product_locks"
  on public.linesheet_product_locks for select
  to authenticated
  using (true);

-- No direct insert/update/delete policies — all writes go through the
-- security-definer functions below, which run as the function owner and
-- enforce the actual lock-ownership rules themselves.


-- ── 2. Acquire a lock ─────────────────────────────────────────
-- Single atomic upsert — the WHERE clause on the conflict branch only
-- matches an unlocked, self-held, or stale (> p_stale_minutes old) lock.
-- Under concurrent calls on the same group_id, Postgres processes one
-- statement at a time; whichever commits first changes locked_by, so the
-- second caller's conflict-update no longer matches the WHERE clause and
-- affects 0 rows. Returns true if THIS call won the lock, false if
-- someone else already holds it.

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

grant execute on function public.try_lock_linesheet_group(text, text, int) to authenticated;


-- ── 3. Release a lock ─────────────────────────────────────────
-- Only clears the lock if the caller is the one holding it — one user
-- can never release another user's active lock.

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

grant execute on function public.unlock_linesheet_group(text) to authenticated;


-- ── 4. Refresh a lock (heartbeat while the editor stays open) ──
-- Called every ~30s while someone has the editor open so a long edit
-- session doesn't have its own lock expire out from under it.

create or replace function public.refresh_linesheet_group_lock(p_group_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.linesheet_product_locks
  set locked_at = now()
  where group_id = p_group_id and locked_by = auth.uid();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.refresh_linesheet_group_lock(text) to authenticated;


-- ── 5. Server-side enforcement ────────────────────────────────
-- The real protection: rejects any insert/update to a linesheet_products
-- row whose group_id is held by someone else's un-expired lock,
-- regardless of what the calling client thinks it's allowed to do.

-- Fields toggled directly from the Master Data list (approval checkboxes,
-- linesheet-complete, linesheet-selected) — these are single-checkbox flips
-- by design, meant to work regardless of who else has the product open for
-- editing. Only changes OUTSIDE this set (name, description, sku, images,
-- pricing, measurements, etc. — the actual editable content of the form)
-- are protected by the lock.
create or replace function public.enforce_linesheet_product_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock record;
  v_exempt_keys text[] := array['approvedDesigner','approvedSC','approvedMerch','linesheetComplete','selectedForLinesheet'];
begin
  if TG_OP = 'UPDATE'
     and (OLD.data - v_exempt_keys) is not distinct from (NEW.data - v_exempt_keys) then
    return NEW; -- only exempt toggle fields (or nothing) changed — never blocked by the lock
  end if;

  select locked_by, locked_by_email, locked_at into v_lock
  from public.linesheet_product_locks
  where group_id = NEW.group_id;

  if v_lock.locked_by is not null
     and v_lock.locked_by <> auth.uid()
     and v_lock.locked_at > now() - interval '2 minutes' then
    raise exception 'This product is locked by another user (%).', v_lock.locked_by_email
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return NEW;
end;
$$;

drop trigger if exists linesheet_products_enforce_lock on public.linesheet_products;
create trigger linesheet_products_enforce_lock
  before insert or update on public.linesheet_products
  for each row execute function public.enforce_linesheet_product_lock();


-- ── Done! ─────────────────────────────────────────────────────
-- Run this after supabase-linesheet-products-migration.sql. No product
-- data is touched — this only adds a new lock table plus functions/a
-- trigger on the existing linesheet_products table.
