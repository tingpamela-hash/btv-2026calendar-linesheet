-- ============================================================
-- BTV Planner – Product Calendar Input: hard entry locking
--
-- WHY: the existing "who's editing this" indicator is a presence broadcast
-- (a WebSocket message each browser sends about what it's looking at) —
-- useful for the "🔒 Jane is editing" badge, but not a real lock. Nothing
-- stops a browser from saving anyway if it never received (or raced ahead
-- of) the other person's broadcast. Two people opening the same entry
-- within the same second or so can both slip past the check before either
-- has heard about the other, because nothing actually adjudicates who got
-- there first.
--
-- This migration adds a real lock enforced by Postgres:
--   • try_lock_calendar_entry() atomically claims the lock in a single
--     UPDATE — Postgres itself serialises concurrent calls on the same
--     row, so exactly one caller can ever win a contested lock. This is
--     the actual fix for the race; nothing client-side can replicate it.
--   • unlock_calendar_entry() releases a lock you hold.
--   • A trigger rejects any write to `data` on a row locked by someone
--     else, so even a buggy or bypassing client can't overwrite a locked
--     entry — this is what makes it a hard lock rather than a UI courtesy.
--   • Locks auto-expire after 2 minutes of inactivity (matches the
--     existing presence-based stale-lock window), so a crashed tab can
--     never permanently strand an entry.
--
-- Safe to re-run — every statement is idempotent (create-or-replace,
-- drop-if-exists).
-- ============================================================

-- ── 1. Lock columns ───────────────────────────────────────────

alter table public.calendar_entries
  add column if not exists locked_by       uuid references auth.users(id) on delete set null,
  add column if not exists locked_by_email text,
  add column if not exists locked_at       timestamptz;

create index if not exists calendar_entries_locked_by_idx
  on public.calendar_entries (locked_by) where locked_by is not null;


-- ── 2. Acquire a lock ─────────────────────────────────────────
-- Single atomic UPDATE — the WHERE clause only matches an unlocked,
-- self-held, or stale (> p_stale_minutes old) lock. Under concurrent calls
-- on the same row, Postgres processes one UPDATE at a time; whichever
-- commits first changes locked_by, so the second caller's UPDATE no
-- longer matches the WHERE clause and affects 0 rows. Returns true if
-- THIS call won the lock, false if someone else already holds it.

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

grant execute on function public.try_lock_calendar_entry(text, text, int) to authenticated;


-- ── 3. Release a lock ─────────────────────────────────────────
-- Only clears the lock if the caller is the one holding it — one user
-- can never release another user's active lock.

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

grant execute on function public.unlock_calendar_entry(text) to authenticated;


-- ── 4. Refresh a lock (heartbeat while the editor stays open) ──
-- Same shape as acquiring, but intent is clearer separately: called every
-- ~30s while someone has the editor open so a long edit session doesn't
-- have its own lock expire out from under it.

create or replace function public.refresh_calendar_entry_lock(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.calendar_entries
  set locked_at = now()
  where id = p_id and locked_by = auth.uid();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.refresh_calendar_entry_lock(text) to authenticated;


-- ── 5. Server-side enforcement ────────────────────────────────
-- The real protection: rejects any change to `data` on a row someone
-- else's un-expired lock still holds, regardless of what the calling
-- client thinks it's allowed to do. Locking/unlocking metadata itself
-- (locked_by/locked_at) is untouched by this check — only the entry's
-- actual content is protected.

create or replace function public.enforce_calendar_entry_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.data is distinct from NEW.data then
    if OLD.locked_by is not null
       and OLD.locked_by <> auth.uid()
       and OLD.locked_at > now() - interval '2 minutes' then
      raise exception 'This entry is locked by another user (%).', OLD.locked_by_email
        using errcode = '42501'; -- insufficient_privilege
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists calendar_entries_enforce_lock on public.calendar_entries;
create trigger calendar_entries_enforce_lock
  before update on public.calendar_entries
  for each row execute function public.enforce_calendar_entry_lock();


-- ── Done! ─────────────────────────────────────────────────────
-- Run this after supabase-calendar-entries-migration.sql. No data is
-- touched — this only adds columns/functions/a trigger to the table that
-- migration already created.
