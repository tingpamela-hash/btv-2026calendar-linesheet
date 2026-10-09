-- ============================================================
-- BTV Planner — Global Calendar & Marketing Workflow: per-entry migration
--
-- WHY: creative-cal-2026-v1 and calendar-2026-marketing-workflow-v1 were stored
-- as single JSON blobs in app_state. Every save — even adding one activation —
-- rewrote the ENTIRE object for every country. If two people saved at the same
-- time, the last writer silently erased the other person's work.
--
-- This migration creates two tables with ONE ROW PER ENTRY, so saving or
-- deleting an entry only ever touches that one row and can never clobber
-- anyone else's simultaneously-saved entry.
--
-- Safe to re-run — all statements are idempotent. The data-copy steps
-- use ON CONFLICT DO NOTHING so re-running won't duplicate anything.
--
-- Run this BEFORE deploying the corresponding code change.
-- ============================================================


-- ── 1. global_cal_entries ─────────────────────────────────────────────────────
-- One row per entry in the Global Calendar (all markets: SG, TH, ID, PH, JP, CN,
-- plus global/china sections used by the product calendar bridge).

create table if not exists public.global_cal_entries (
  id         text        primary key,
  market     text        not null,
  data       jsonb       not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

create index if not exists global_cal_entries_market_idx
  on public.global_cal_entries (market);

alter table public.global_cal_entries enable row level security;

drop policy if exists "Authenticated users can read global_cal_entries"   on public.global_cal_entries;
drop policy if exists "Authenticated users can insert global_cal_entries" on public.global_cal_entries;
drop policy if exists "Authenticated users can update global_cal_entries" on public.global_cal_entries;
drop policy if exists "Authenticated users can delete global_cal_entries" on public.global_cal_entries;

create policy "Authenticated users can read global_cal_entries"
  on public.global_cal_entries for select to authenticated using (true);

create policy "Authenticated users can insert global_cal_entries"
  on public.global_cal_entries for insert to authenticated with check (true);

create policy "Authenticated users can update global_cal_entries"
  on public.global_cal_entries for update to authenticated using (true);

create policy "Authenticated users can delete global_cal_entries"
  on public.global_cal_entries for delete to authenticated using (true);


-- ── 2. marketing_entries ──────────────────────────────────────────────────────
-- One row per Retail Activation / Digital Activation entry.

create table if not exists public.marketing_entries (
  id         text        primary key,
  market     text        not null,
  data       jsonb       not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

create index if not exists marketing_entries_market_idx
  on public.marketing_entries (market);

alter table public.marketing_entries enable row level security;

drop policy if exists "Authenticated users can read marketing_entries"   on public.marketing_entries;
drop policy if exists "Authenticated users can insert marketing_entries" on public.marketing_entries;
drop policy if exists "Authenticated users can update marketing_entries" on public.marketing_entries;
drop policy if exists "Authenticated users can delete marketing_entries" on public.marketing_entries;

create policy "Authenticated users can read marketing_entries"
  on public.marketing_entries for select to authenticated using (true);

create policy "Authenticated users can insert marketing_entries"
  on public.marketing_entries for insert to authenticated with check (true);

create policy "Authenticated users can update marketing_entries"
  on public.marketing_entries for update to authenticated using (true);

create policy "Authenticated users can delete marketing_entries"
  on public.marketing_entries for delete to authenticated using (true);


-- ── 3. Enable Realtime ────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'global_cal_entries'
  ) then
    alter publication supabase_realtime add table public.global_cal_entries;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'marketing_entries'
  ) then
    alter publication supabase_realtime add table public.marketing_entries;
  end if;
end;
$$;


-- ── 4. One-time data migration from the old app_state blobs ──────────────────
-- Both blobs have the same shape: { "SG": [...entries], "TH": [...], ... }
-- We unpack each market's array into individual rows.
-- ON CONFLICT DO NOTHING makes this safe to re-run.

-- Global Calendar entries
insert into public.global_cal_entries (id, market, data, updated_at, updated_by)
select
  (elem->>'id')                         as id,
  markets.mkt                           as market,
  elem                                  as data,
  coalesce(src.updated_at, now())       as updated_at,
  src.updated_by
from public.app_state src,
     jsonb_each(src.value)              as markets(mkt, market_entries),
     jsonb_array_elements(market_entries) as elem
where src.key = 'creative-cal-2026-v1'
  and jsonb_typeof(market_entries) = 'array'
  and (elem->>'id') is not null
on conflict (id) do nothing;

-- Marketing Workflow entries
insert into public.marketing_entries (id, market, data, updated_at, updated_by)
select
  (elem->>'id')                         as id,
  markets.mkt                           as market,
  elem                                  as data,
  coalesce(src.updated_at, now())       as updated_at,
  src.updated_by
from public.app_state src,
     jsonb_each(src.value)              as markets(mkt, market_entries),
     jsonb_array_elements(market_entries) as elem
where src.key = 'calendar-2026-marketing-workflow-v1'
  and jsonb_typeof(market_entries) = 'array'
  and (elem->>'id') is not null
on conflict (id) do nothing;


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Run these separately to confirm row counts match the old blobs before
-- considering the migration complete:
--
--   select count(*) from public.global_cal_entries;
--   select count(*) from public.marketing_entries;
--
--   -- Compare against the old blobs (sum across all market arrays):
--   select sum(jsonb_array_length(value->mkt))
--   from public.app_state,
--        jsonb_object_keys(value) as mkt
--   where app_state.key = 'creative-cal-2026-v1';
--
--   select sum(jsonb_array_length(value->mkt))
--   from public.app_state,
--        jsonb_object_keys(value) as mkt
--   where app_state.key = 'calendar-2026-marketing-workflow-v1';


-- ── DO NOT delete the old app_state rows yet ─────────────────────────────────
-- Keep creative-cal-2026-v1 and calendar-2026-marketing-workflow-v1 in app_state
-- as a rollback safety net. Once the new code has been running cleanly and you
-- have confirmed the entry counts match, remove with:
--
--   delete from public.app_state where key in (
--     'creative-cal-2026-v1',
--     'calendar-2026-marketing-workflow-v1'
--   );
