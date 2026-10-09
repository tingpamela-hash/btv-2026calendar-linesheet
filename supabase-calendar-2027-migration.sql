-- ============================================================
-- BTV Planner – Product Calendar Input: finish the 2027 migration
--
-- WHY: calendar-2026-working-v5 was migrated off the whole-blob app_state
-- path to the per-row calendar_entries table back in
-- supabase-calendar-entries-migration.sql, specifically to stop two people
-- editing different launches from silently overwriting each other's save.
-- input calendar-2027.html was left behind as a separate, still-blob-based
-- copy of the page (calendar-2027-working-v5), so it has had the exact same
-- clobber bug ever since. input calendar-2026.html has since grown a
-- year-switcher (switchCalYear / CAL_YEAR) that reads/writes calendar_entries
-- filtered by a `year` column — see supabase-calendar-entries-year-column-
-- migration.sql — so 2027 no longer needs its own file or its own table.
-- This is the one-time data copy that finishes that migration for 2027.
--
-- Safe to re-run — ON CONFLICT DO NOTHING means re-running it won't
-- duplicate or overwrite anything already copied across.
--
-- IMPORTANT — run this in Supabase → SQL Editor → New query BEFORE the
-- corresponding code change goes out (index.html pointing the "2027" year
-- button at the unified calendar page instead of the standalone
-- input calendar-2027.html). If the code deploys first, it will simply find
-- zero calendar_entries rows for year=2027 and show an empty 2027 calendar
-- until this runs — it will NOT wipe or touch the old blob.
-- ============================================================

-- ── 1. One-time data copy from the old app_state blob ────────
-- Same unpacking shape as the 2026 migration: app_state.key =
-- 'calendar-2027-working-v5' is { section: { weekId: [ entry, entry, ... ] } }.
-- Walks whatever top-level section keys are actually present. Rows already
-- migrated are skipped (ON CONFLICT DO NOTHING).

insert into public.calendar_entries (id, section, week_id, data, year, updated_at, updated_by)
select
  entry->>'id'                    as id,
  sec.key                         as section,
  week.key                        as week_id,
  entry                           as data,
  2027                            as year,
  coalesce(src.updated_at, now()) as updated_at,
  src.updated_by                  as updated_by
from public.app_state src,
     jsonb_each(src.value)         as sec,
     jsonb_each(sec.value)         as week,
     jsonb_array_elements(week.value) as entry
where src.key = 'calendar-2027-working-v5'
  and jsonb_typeof(sec.value)  = 'object'
  and jsonb_typeof(week.value) = 'array'
  and entry->>'id' is not null
on conflict (id) do nothing;


-- ── Verify ────────────────────────────────────────────────────
-- Run separately to confirm the row count matches the old blob's total
-- entry count before treating the migration as complete:
--
--   select count(*) from public.calendar_entries where year = 2027;
--
--   select sum(jsonb_array_length(week.value))
--   from public.app_state src,
--        jsonb_each(src.value) as sec,
--        jsonb_each(sec.value) as week
--   where src.key = 'calendar-2027-working-v5'
--     and jsonb_typeof(sec.value) = 'object'
--     and jsonb_typeof(week.value) = 'array';
--
-- These two numbers should match. Per-section sanity check:
--
--   select section, count(*) from public.calendar_entries where year = 2027 group by section;
--
-- And a spot check that no id collided across years (ids should already be
-- unique since they're generated client-side, but worth confirming once):
--
--   select id, count(*) from public.calendar_entries group by id having count(*) > 1;


-- ── Done! ─────────────────────────────────────────────────────
-- Do NOT delete the old app_state row for 'calendar-2027-working-v5' yet —
-- it's kept as a rollback safety net, same as the 2026 migration's row was.
-- Once index.html has been switched to route "2027" through the unified
-- calendar page and calendar_entries has been running cleanly for a while,
-- it can be removed with:
--
--   delete from public.app_state where key = 'calendar-2027-working-v5';
--   delete from public.app_state where key like 'calendar-2027-working-v5-%'; -- history/versions/changelog
