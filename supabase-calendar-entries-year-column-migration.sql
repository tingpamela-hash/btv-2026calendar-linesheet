-- ============================================================
-- BTV Planner – Product Calendar Input: add a `year` column to calendar_entries
--
-- WHY: Product Calendar Input used to be one hardcoded-year file per year
-- (input calendar-2026.html, input calendar-2027.html, each its own copy of
-- the entire app). It's now a single year-switchable page — see the
-- switchCalYear() work in input calendar-2026.html — so multiple years'
-- entries need to coexist in this one table instead of one table per year.
--
-- All existing rows are 2026 data (calendar_entries was only ever populated
-- from the 2026 blob), so backfilling everything to year=2026 is exactly
-- correct — nothing is being guessed or reclassified.
--
-- Safe to re-run — idempotent.
-- ============================================================

alter table public.calendar_entries
  add column if not exists year int;

update public.calendar_entries set year = 2026 where year is null;

alter table public.calendar_entries
  alter column year set not null;

create index if not exists calendar_entries_year_idx
  on public.calendar_entries (year);

-- Realtime filtering (channel subscriptions filtered by `year=eq.<N>`) needs the
-- column covered by the existing replica identity — REPLICA IDENTITY DEFAULT
-- (the table's default) already includes it via the primary key + this being a
-- plain column, so no further change is needed there.

-- ── Verify ────────────────────────────────────────────────────
--   select year, count(*) from public.calendar_entries group by year;
-- Should show one row: 2026 | <however many entries currently exist>.
