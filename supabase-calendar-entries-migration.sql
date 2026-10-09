-- ============================================================
-- BTV Planner – Product Calendar Input: per-entry storage migration
--
-- WHY: calendar-2026-working-v5 (every launch, every week, every product
-- line in the Product Calendar Input) has always been stored as ONE giant
-- JSON blob under a single row in app_state. Every save — even editing one
-- launch — pushed the ENTIRE calendar to Supabase as one value. If two
-- people edited two different launches around the same time, whoever
-- saved last silently overwrote the other person's changes, because their
-- save replaced the whole calendar, not just the one entry they touched.
--
-- This is the exact bug already found and fixed twice elsewhere in this
-- app: linesheet_products and global_cal_entries were both migrated off a
-- single blob to one-row-per-record for this same reason. This migration
-- brings the Product Calendar Input's own entries in line with the same
-- pattern.
--
-- This creates a dedicated table with ONE ROW PER CALENDAR ENTRY, so
-- saving/deleting/moving an entry only ever touches that one row and can
-- never clobber anyone else's work.
--
-- Safe to re-run — all statements are idempotent. The data-copy step uses
-- ON CONFLICT DO NOTHING so re-running it won't duplicate or overwrite
-- anything.
--
-- IMPORTANT — run this entire script in Supabase → SQL Editor → New query
-- BEFORE deploying the corresponding code change (the btvCalEntriesInit
-- sync module in "input calendar-2026.html"). If the code deploys first,
-- it will find this table empty and simply leave the existing blob-sourced
-- calendar on screen until the first edit/save — it will NOT wipe anything
-- — but there's no reason to leave that gap open.
-- ============================================================

-- ── 1. Table ──────────────────────────────────────────────────

create table if not exists public.calendar_entries (
  id         text        primary key,
  section    text        not null,   -- 'global' | 'china' | 'restocks' | 'events' | 'store_openings'
  week_id    text        not null,
  data       jsonb       not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

create index if not exists calendar_entries_section_week_idx
  on public.calendar_entries (section, week_id);

alter table public.calendar_entries enable row level security;

drop policy if exists "Authenticated users can read calendar_entries"   on public.calendar_entries;
drop policy if exists "Authenticated users can insert calendar_entries" on public.calendar_entries;
drop policy if exists "Authenticated users can update calendar_entries" on public.calendar_entries;
drop policy if exists "Authenticated users can delete calendar_entries" on public.calendar_entries;

create policy "Authenticated users can read calendar_entries"
  on public.calendar_entries for select
  to authenticated
  using (true);

create policy "Authenticated users can insert calendar_entries"
  on public.calendar_entries for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update calendar_entries"
  on public.calendar_entries for update
  to authenticated
  using (true);

create policy "Authenticated users can delete calendar_entries"
  on public.calendar_entries for delete
  to authenticated
  using (true);


-- ── 2. Enable Realtime ───────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calendar_entries'
  ) then
    alter publication supabase_realtime add table public.calendar_entries;
  end if;
end;
$$;


-- ── 3. One-time data copy from the old app_state blob ────────
-- Unpacks the existing nested JSON (app_state.key = 'calendar-2026-working-v5',
-- shaped as { section: { weekId: [ entry, entry, ... ] } }) into individual
-- rows. Walks whatever top-level section keys are actually present rather
-- than a hardcoded list, so it doesn't need updating if a section is ever
-- renamed or added. Rows already migrated are skipped (ON CONFLICT DO
-- NOTHING), so this is safe to re-run if new entries were added to the old
-- blob before the code deploy goes out.

insert into public.calendar_entries (id, section, week_id, data, updated_at, updated_by)
select
  entry->>'id'                    as id,
  sec.key                         as section,
  week.key                        as week_id,
  entry                           as data,
  coalesce(src.updated_at, now()) as updated_at,
  src.updated_by                  as updated_by
from public.app_state src,
     jsonb_each(src.value)         as sec,
     jsonb_each(sec.value)         as week,
     jsonb_array_elements(week.value) as entry
where src.key = 'calendar-2026-working-v5'
  and jsonb_typeof(sec.value)  = 'object'
  and jsonb_typeof(week.value) = 'array'
  and entry->>'id' is not null
on conflict (id) do nothing;


-- ── Verify ────────────────────────────────────────────────────
-- Run separately to confirm the row count matches the old blob's total
-- entry count before considering the migration complete:
--
--   select count(*) from public.calendar_entries;
--
--   select sum(jsonb_array_length(week.value))
--   from public.app_state src,
--        jsonb_each(src.value) as sec,
--        jsonb_each(sec.value) as week
--   where src.key = 'calendar-2026-working-v5'
--     and jsonb_typeof(sec.value) = 'object'
--     and jsonb_typeof(week.value) = 'array';
--
-- These two numbers should match. You can also sanity-check per section:
--
--   select section, count(*) from public.calendar_entries group by section;


-- ── Done! ─────────────────────────────────────────────────────
-- Do NOT delete the old app_state row for 'calendar-2026-working-v5' yet —
-- it's kept as a rollback safety net. The code no longer writes new entry
-- data into it (see js/supabase-sync.js's SYNCED_KEYS comment), so it will
-- simply stop updating from this point on. Once the new table has been
-- running cleanly for a while and you've confirmed everything looks right,
-- it can be removed with:
--
--   delete from public.app_state where key = 'calendar-2026-working-v5';
