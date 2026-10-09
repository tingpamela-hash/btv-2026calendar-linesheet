# BTV Planner — Rebuild Specification

**Goal:** rebuild BTV Planner as **one website** (one app, one login, one database connection) with **proper role-based access enforced by the server**, keeping every feature the team uses today.

**Source of truth for this document:** a full read of the current code on 2026-09-23 — `index.html`, `js/supabase-sync.js`, `js/supabase-config.js`, `btv_calendar_linesheet_files/input calendar-2026.html`, `global calendar.html`, `linesheet.html`, the `supabase/functions/linesheet-monday-reminder` Edge Function, and every `supabase-*.sql` migration. Where the current code has a bug or a contradiction, it is called out in **§10 Known issues** so it is not copied into the new build.

---

## Contents

1. [What the app is](#1-what-the-app-is)
2. [How it is built today (and why it should change)](#2-how-it-is-built-today-and-why-it-should-change)
3. [Target architecture](#3-target-architecture)
4. [Users, roles and access](#4-users-roles-and-access)
5. [Module A — Product Calendar Input](#5-module-a--product-calendar-input)
6. [Module B — Global Calendar](#6-module-b--global-calendar)
7. [Module C — Linesheet](#7-module-c--linesheet)
8. [Shared platform features](#8-shared-platform-features)
9. [Data model](#9-data-model)
10. [Known issues in the current build — do not replicate](#10-known-issues-in-the-current-build--do-not-replicate)
11. [Migration plan](#11-migration-plan)
12. [Acceptance checklist](#12-acceptance-checklist)
13. [Appendix — reference constants](#13-appendix--reference-constants)

---

## 1. What the app is

BTV Planner is Beyond The Vines' internal planning tool. It has three connected modules:

| Module | Who uses it | What it's for |
|---|---|---|
| **Product Calendar Input** | Merch, Production, Design | The master launch calendar: every product launch, China launch, restock, event/activation and store opening, week by week, per year. |
| **Global Calendar** | Marketing / Creative, per market (SG, TH, ID, PH, JP, CN) | The creative & marketing calendar: themes, key moments, holidays, social/EDM/media content, and marketing activations — with the product calendar shown alongside as read-only reference. |
| **Linesheet** | Merch, Design, Prod, Product Designers, Supply Chain | The product master data for every launched variant (SKU, barcode, HS code, fabric, measurements, pricing, images), a 3-way approval workflow, and the exportable/printable linesheet for trade. |

**Data flows between modules (these connections are the heart of the app):**

```
Product Calendar ──(launch lines, every year)──────────────► Linesheet product variants
Product Calendar ──(launches, restocks, stores, markdowns)─► Global Calendar (read-only rows)
Global Calendar  ──(published marketing activation)────────► Product Calendar "Events" row
Linesheet        ──(product details, approvals)────────────► Global Calendar launch detail popup
```

---

## 2. How it is built today (and why it should change)

| Today | Problem | Rebuild |
|---|---|---|
| A shell page (`index.html`) loads **three separate HTML apps in iframes**. | Each iframe runs its own copy of the sync engine, has its own Supabase clients, and latched onto the first signed-in user (the session-state bugs). ~31,000 lines across 3 files with heavy duplication. | One app, one router, one Supabase client, shared components. |
| **localStorage is the working database.** Pages read/write localStorage; `supabase-sync.js` monkey-patches `localStorage.setItem` to mirror some keys to an `app_state` table as whole JSON blobs. | Whole-blob last-write-wins overwrites teammates; stale local data can be pushed up; data exposed on shared machines. | Database is the source of truth. Client cache (e.g. TanStack Query) only. Every record is its own row. |
| Calendar entries, Global Calendar entries, marketing entries and linesheet products were **already migrated to per-row tables** (`calendar_entries`, `global_cal_entries`, `marketing_entries`, `linesheet_products`) with Realtime. | Good — but several things still live in blobs (markdowns, stores/categories, versions, undo history, change log, notify emails). | Move the remaining blobs to proper tables (see §9). |
| **Access control is UI-only.** `can_access_*` / `can_edit_*` hide tabs; the database allowed any login to do anything (being fixed by `supabase-rls-lockdown-migration.sql`). | Anyone who could sign up could read/rewrite pricing and launch dates. | Invite-only auth + RLS policies from the start (§4). |
| Secrets in client code: a Power Automate webhook URL (the signature is the credential) and `adminPasscode: 'admin'`. | Anyone can View Source. | Webhooks called from an Edge Function; admin determined by `user_profiles.is_admin`. |
| Product images stored as **base64 inside the product record**, and stripped before upload. | Images never reach other users (see §10 #1). | Supabase Storage (private bucket, signed URLs). |

**Keep these good ideas from the current build:** per-row sync, Realtime updates, server-enforced edit locks (`try_lock_*` RPCs + triggers), pending-save queue with a visible "N not synced" badge and retry, deterministic product IDs derived from calendar colour IDs, "never auto-delete — flag as Removed from Calendar", jump-to-entry after save, offline banner.

---

## 3. Target architecture

**Recommended stack** (any modern equivalent is fine):

| Layer | Recommendation |
|---|---|
| Frontend | Single-page app — React + TypeScript (Next.js or Vite), or SvelteKit. Routes: `/calendar`, `/global`, `/linesheet`, `/admin`, `/account`. |
| Hosting | Netlify (already used) — **deploy previews for every change; production published manually.** |
| Database | Supabase Postgres (existing project) with RLS on every table. |
| Auth | Supabase Auth, **public signup disabled**, users added by admin invite. Password reset + change password. |
| Realtime | Supabase Realtime `postgres_changes` per table (filtered by year where relevant) + one Presence channel for the whole app. |
| Files | Supabase Storage: `product-images` (private), `marketing-images` (private). Signed URLs for display and exports. |
| Server logic | Edge Functions: Teams webhook relay, Monday reminder email (Resend), any bulk import. |
| Exports | CSV / Excel (use a library such as SheetJS instead of hand-written SpreadsheetML), print-to-PDF via print stylesheets. |

**Principles**

1. **Server is the authority.** Every permission check in the UI is repeated in RLS. The UI only hides what the server would reject anyway.
2. **One record = one row.** No blob keys. Edits touch only the rows they change.
3. **Optimistic UI with a durable pending queue.** Show the change instantly, queue the write (persisted, tagged with the user id), retry with backoff, show a "not synced" badge, warn on sign-out/close if the queue is non-empty.
4. **Hard locks for editing a record** (existing `try_lock_calendar_entry` / `try_lock_linesheet_group` pattern — keep it and generalise).
5. **Audit everything** in one `audit_log` table written by database triggers (who, when, what changed), instead of client-assembled change-log blobs.
6. **Dates are real dates.** Store ISO dates (`date` type); derive weeks in code. Do not use week-ID strings as keys (see §10 #2).

---

## 4. Users, roles and access

### 4.1 What exists today

`user_profiles` columns: `is_admin`, and for each module `can_access_*` (see the tab) and `can_edit_*` (change data):

- `product_calendar` — Product Calendar Input
- `global_calendar` — Global Calendar
- `linesheet` — Linesheet

Admins toggle these in **User Management**. Separately, the UI labels fields with **team badges** (Merch, Design, Prod, Product Designers, Production) and the Linesheet has **three approval checkboxes** (Designer / SC / Merch) — but today anyone with Linesheet edit can edit any field and tick any approval.

### 4.2 Proposed model

Two layers — **module access** (keep, now enforced server-side) and optional **team membership** (new, for field ownership and approvals).

**Layer 1 — module access (required):**

| Level | Meaning |
|---|---|
| None | Module hidden; API returns nothing. |
| Viewer | Can see and export; cannot create/edit/delete. |
| Editor | Full create/edit/delete in that module. |
| Admin (global) | Everything, plus User Management and Settings. |

**Layer 2 — teams (decide whether to enforce):**

`merch`, `design`, `prod`, `product_designers`, `supply_chain`, `marketing` (a user can belong to several).

| Option | Behaviour | Trade-off |
|---|---|---|
| **A. Labels only** (today) | Team badges are guidance; any Linesheet editor can edit any field and tick any approval. | Simplest; approvals are not trustworthy. |
| **B. Approvals only** *(recommended)* | Only Design can tick **D**, Supply Chain **SC**, Merch **M**. Fields stay editable by any Linesheet editor. | Makes approvals mean something, small effort. |
| **C. Field ownership** | Each field editable only by its owning team (see §7.3 table). | Strictest; more RLS/UI work; may slow the team down. |

**Optional — market scoping for the Global Calendar:** restrict a user to editing specific markets (e.g. the TH team edits only the TH tab). Not in the current build; add a `markets text[]` on the profile if wanted.

### 4.3 Access matrix (with option B)

| Action | None | Viewer | Editor | Team rule | Admin |
|---|---|---|---|---|---|
| See module tab / read data | ✗ | ✓ | ✓ | — | ✓ |
| Export (CSV/Excel/PDF/JSON) | ✗ | ✓ | ✓ | — | ✓ |
| Create/edit/delete calendar entries | ✗ | ✗ | ✓ (Product Calendar editors) | — | ✓ |
| Publish a marketing activation (creates a Product Calendar event) | ✗ | ✗ | ✓ (Global Calendar editors) | — | ✓ |
| Edit Linesheet product fields | ✗ | ✗ | ✓ | (option C only) | ✓ |
| Tick approval D / SC / M | ✗ | ✗ | ✓ | Design / Supply Chain / Merch | ✓ |
| Pick for linesheet | ✗ | ✗ | ✓ (only if all 3 approvals ticked) | — | ✓ |
| Manage stores, categories, price directory | ✗ | ✗ | ✗ | — | ✓ |
| Manage users, notify emails, webhooks | ✗ | ✗ | ✗ | — | ✓ |

### 4.4 Account lifecycle

- **Invite:** Admin adds the email (Supabase "Invite user"). The profile is created with no access; the admin sets module levels/teams in User Management.
- **First login / reset:** password via the emailed link (`PASSWORD_RECOVERY` → change-password modal).
- **Sign-out:** clears all client state and cache; if the pending-save queue is non-empty, warn first.
- **Deactivate:** set all access to None (keeps the audit history); delete in Supabase only if required.
- **Who's online:** a presence list in the top nav (email → display name).

### 4.5 Enforcement

- RLS pattern: `SECURITY DEFINER` helper functions reading the caller's own profile (`btv_is_member()`, `btv_is_admin()`, `btv_can_edit(module)`), as drafted in `supabase-rls-lockdown-migration.sql`. Extend with `btv_in_team(team)` for option B/C.
- Approval columns guarded by an `UPDATE` trigger that checks the team when `approved_*` changes.
- `updated_by` / audit author stamped server-side from `auth.uid()`, never trusted from the client.

---

## 5. Module A — Product Calendar Input

### 5.1 Layout

- **Year selector** (current year −2 … +4) and a nav year toggle. Each year is its own calendar; switching years reloads that year's data.
- **Grid:** columns = ISO weeks of the year (Mon–Sun), grouped by Quarter → Month → Week number → date range; current week highlighted. Rows:
  1. **Markdown** (multi-week bars, stacked in lanes when they overlap)
  2. **Global** (launches)
  3. **China** (launches)
  4. **Restocks**
  5. **Events / Activations**
  6. **Store Openings**
- Each cell lists entry cards plus a **+ Add** button. Cards show date + weekday, market chips (or "Global" when all 6), title, product lines grouped by category (name, price, colour, size), SKU count, markets, channels, launch status and Draft/Published badge. Click a card to expand it; **Edit** opens the editor.
- Card colour: Global launches are coloured by the first line's category; the dot shows priority (Brand 🟡 / Revenue 🔵 / Both 🟢); Draft cards are visually distinct from Published.

### 5.2 Toolbar

| Control | Behaviour |
|---|---|
| Search | Type-ahead dropdown of all entries (title + date); also filters the grid live; selecting jumps to and highlights the entry. |
| Market filter | All / SG / TH / ID / PH / JP / CN (multi-select, in-memory only). |
| View mode | Full Year / Month focus / Quarter focus. |
| Today | Switches to the current year if needed and scrolls to this week. |
| Undo (←) | Reverts the last edit (up to 50 steps). *Rebuild note: implement from the audit log, not full-state snapshots.* |
| Export | CSV (flat list), Excel (calendar grid, current view), JSON (full backup), PDF: next 3 months, Q1–Q4 (one month per landscape page). |
| Import | CSV (template: Launch Title, Launch Date, Section, Key Level, Status, Category, Product Name, Colour(s), Size(s), SGD RRP, Markets, Promo Start, Promo End, Till Sold Out, Mechanics, ETA Date; dates accept `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-Mon`, `Friday 23 January 2026`; duplicates skipped); JSON (replace all, with confirmation). |
| Save Version | Snapshots the calendar, computes a grouped change summary vs the previous version, shows a Teams-ready summary, and posts it to the calendar webhook. Up to 20 versions. |
| Version History | List of versions → view the summary / restore (with confirmation). |
| Cal Webhook | *Admin setting in the rebuild* (Teams URLs, comma-separated). |
| Tabs | Calendar · KPI Dashboard · Admin (stores & categories). A hidden legacy "Launch List" tab exists — drop it. |

### 5.3 Entry types and fields

Common to all: `id`, `section`, `week` (derived from the date), `workflow_status` (Draft/Published), `updated_by`. The editor has Draft/Publish toggle buttons, **Delete**, **Duplicate** (same week) and, for Global only, **Copy to China**.

**Launch (Global / China)**

| Field | Rules | Team |
|---|---|---|
| Launch Title | text | Merch |
| Launch Date | **required**; must fall inside the selected year; determines the week | Merch |
| Priority | Brand / Revenue / Both (default Brand) | — |
| Products (lines, min 5 shown, add/move/duplicate/delete) | per line: Category* (from admin list), Product Title*, SGD RRP*, Colour/Variant (comma-separated = multiple colours), Size (comma-separated). At least one complete line required. Each line has a stable `line_id`; each colour a stable `colour_id`. | Merch / Design |
| No. of SKUs | auto = total colour count; can be overridden | Merch |
| Markets* | checkboxes, all 6 by default (stored today as the *excluded* set) | Merch |
| Launch (Channel) | per market, stores active on the launch date (from Admin → Stores) | Merch |
| Launch Status | On Time / Delay Flagged | Production |
| Delay markets | if delayed: rows of market + ETA date | Production |

**Restock:** product lines (Product Title, Colour, Size) · ETA date (determines the week) · Priority · Markets (All or a subset).

**Event / Activation:** Title · Start date (determines the week) · End date or **Till Sold Out** (shows day count) · Markets · Anthem Included (PH) · Notes. Events created by publishing a Global Calendar activation are linked (`linked_marketing_id`) and must update/disappear with it.

**Store Opening:** Market · Store name · Target open date (determines the week) · Store size · Address.

**Markdown bar** (separate "Markdown" row): Title · Start · End · No. of days (auto) · No. of weekend days (auto) · Participating markets. Edit/delete by clicking the bar.

**Behaviours to keep**

- Drag an entry to another week in the same section (clears its dates and reopens the editor to confirm); drag within a cell to reorder. Disabled for viewers.
- After saving, the grid clears any filter that would hide the entry, scrolls to it and highlights it.
- **Hard lock:** opening an existing entry acquires a server lock (2-minute expiry, 30-second heartbeat). If someone else holds it, the form is read-only with "🔒 name is editing" and polls every 4 s until free. The lock is released on every close path. Lock badges also appear on cards.
- Unsaved-changes indicator in the modal and a confirm-on-close prompt.
- Warn before leaving the page while saves are still in flight.

### 5.4 KPI Dashboard (calendar)

Launches by category · SKUs by category (proportional split of the SKU count) · Country exclusives by market · Activations by market · Store openings count · Recent calendar changes (field: from → to, who, when) · Teams summary of the last saved version (copyable).

### 5.5 Admin (calendar settings → move to global Admin in the rebuild)

- **Categories** (default: ACC, BAGS, EYEWEAR, FOOTWEAR, KRTW, LF, MRTW, PETS, WRTW) — add/remove.
- **Stores & channels:** market, name, open-from, open-to (blank = always). Only stores active on an entry's date are offered. Defaults are listed in §13.

### 5.6 Notifications

- Every saved change → one batched Teams message (400 ms debounce) listing product / field / from → to.
- Save Version → grouped summary message ("Update Summary – Version YYYY-MM-DD HH:MM", with sections Global / China / Restock / Store Openings / Events).

---

## 6. Module B — Global Calendar

### 6.1 Layout

- Year selector; **Today** button; **Webhooks** setting; **Load Excel Data** (2026 seed only, see §10 #8).
- Tabs: **Global** (consolidated, read-only) and one per market: **SG, TH, ID, PH, JP, CN** (editable).
- Filter bar: search; on the Global tab also a market filter and a status filter (Not Started / In Progress / In Review / Approved / Delivered), with a "N matching" count and Clear.
- Legend of market colours; a multi-market item shows in "Global" yellow.
- Grid: 53 weeks (Wk n + date range), current-week column tinted.
- **Export Grid (Excel)** of the Global tab, respecting the market filter.

### 6.2 Rows per market tab

| Group | Rows | Source / editing |
|---|---|---|
| Context | Theme / Season · Key Moments · Public Holidays | Editable. No status. Multi-week bars. Key Moments / Public Holidays use only title + market + start/end date. |
| Product (read-only) | Markdown · Launch · Restock · Store Opening | Live from Product Calendar for this market. Launch cards open the **Launch Detail popup** (§6.5). |
| Marketing | Brand Events · Community Activation · Retail Activation · Digital Activation | Editable activation records (§6.4). |
| Communication | EDM · IG Grid · IG Stories · IG Marketing Tag-ons · TikTok · LINE (TH, JP only) · RED/Xiaohongshu (CN) · WeChat (CN) · Livestreaming (CN) · Media/OOH · In-Mall Visibility · Mall's Social Media Visibility · Performance Marketing Tier 1/2/3 | Editable content entries. Social rows show 7 day-slots per week (click a day to add; undated items listed on top). EDM/Media/In-Mall/Performance show rich cards. |

### 6.3 Content entry (Context & Communication rows)

Title* · Market · Row · Start week · optional End week (multi-week span) · Specific date (auto-sets the week) · Status (not for context rows) · Content Pillar (social rows: 01 Life in Motion, 02 Design Intent, 03 BTV In Use, 04 Ways We Use It, 05 Ways of Living, 07 Studio Notes, 08 In Praise of Play) · EDM market scope + EDM type (EDM row) · Ad objective (Performance rows) · Brief/Notes · Reference links · Owner.
Actions: Save, Delete, **Duplicate** (choose date, country, row).

### 6.4 Marketing activation

Title* · Market · Start date* (must be in the selected year) · End date · Status **Draft / Published** · Owner · Reference links · Reference images (upload; each image gets its own title + notes) · T&Cs.
Plus, per row type:
- **Brand Events / Community / Retail Activation:** Time · Store · No. of guests · Objective (bullets) · Target audience (bullets) · Event rundown · Mechanics · Comms.
- **Digital Activation:** Online/Offline (Online Only / Offline Only / Online + Offline) · Objective · Mechanics · Breakdown of details.

Behaviours:
- **Publishing** creates or updates a linked Event in the Product Calendar (Events row, same market, same dates, notes = row + summary). Unpublishing or deleting removes it.
- **Duplicate** to another country/date/row (keeps the duration, always as Draft).
- **Export** a formatted one-page A4 landscape brief (breadcrumb "SG / Q2 / Jun 2026", LIVE/DRAFT badge, fields, image thumbnails 2 per row). Works on unsaved drafts too.
- Teams webhook on change: separate URL lists for **Published** and **Draft** entries; message lists each changed field (from → to) and who changed it.

### 6.5 Global (consolidated) tab — read-only

- **Context:** Theme / Key Moments / Public Holidays as spanning bars; entries with the same title across markets merge into one chip listing the markets.
- **From BTV Calendar (reference):** Markdown · Calendar (launches) · China · Restock · Store Opening, with market filtering.
- **Creative Calendar:** Social/Content · Channel (EDM/Media) · In-Mall & Performance — merged across markets by title.
- **Marketing:** the 4 activation rows — merged only when *all* details match across markets.
- Clicking opens read-only viewers (never the edit form).

**Launch Detail popup** (from any launch card): every Linesheet variant linked to that launch (and sibling launches with the same title minus a market suffix) — images, name/variant, HS codes, category, launch date, markets, channels, sizes, weight, fabric, washcare, measurement table, description, pricing grid (SGD, SGD ex GST, JPY, IDR, THB, PHP, CNY), D/SC/M approvals with a **"NOT READY — awaiting approval from …"** or **"Approved — ready for linesheet"** banner, and a SKU/barcode-by-size table. Export to PDF.

---

## 7. Module C — Linesheet

### 7.1 Views

1. **Product Form** — create/edit one product (shared info + variants). Hidden for viewers.
2. **Master Data** — flat table of all variants.
3. **Linesheet View** — the trade document built from picked variants.
4. **KPI Dashboard** — outstanding work by team.

Header: variant count · picked SKU count · sync spinner · "● N not synced" badge (click = retry) · LS Webhook setting.

### 7.2 Calendar → Linesheet sync (critical logic — preserve exactly)

1. Take **all** Global + China launch lines from the Product Calendar across **all years** (not just the year on screen).
2. Expand each line into one row per **colour** (split on `,` / `;`); collect sizes.
3. Deduplicate by name + category + colour (keep the earliest launch date; merge sizes).
4. **Product ID is deterministic:** `p_<colour_id>` (fallbacks: `p_<line_id>_<hash(colour)>`, then a hash of date+category+name+colour). This prevents duplicates when two devices sync at once.
5. **Group** = product name (case-insensitive). Group ID is deterministic `g_<hash(name)>` when new.
6. Calendar-owned fields (launch date, launch title, category, name, colour, sizing, SGD, draft/published, calendar markets & launching stores) are refreshed from the calendar. Enriched fields (description, washcare, fabric, measurements, weight, HS codes, SKUs/barcodes, images, overseas prices, approvals, pick) are **kept**; if a colour row is new, shared fields are inherited from any sibling colour of the same product.
7. A variant whose calendar line/colour disappears is **never auto-deleted** — it is flagged **"Removed from Calendar"** (filterable) with all data kept.
8. Safety: if the calendar yields zero products but products existed, keep the existing list. Don't write anything until the first full load from the server has completed.
9. New variants trigger a Teams message "New items synced from calendar".

*In the rebuild this should be a database-side job (trigger or function on `calendar_entries` changes), not something every browser recomputes.*

### 7.3 Product Form

**Shared product information** (applies to all variants):

| Field | Notes | Team badge |
|---|---|---|
| Product Category | fixed list | Merch |
| Product Name | read-only once linked to the calendar | Merch |
| Description | | Design |
| Washcare | | Design |
| Fabric Composition | | Product Designers |
| Sizing | comma-separated; drives the measurement and SKU tables; read-only once linked | Design |
| Product Weight (g) | | Product Designers |
| HS Code (8-digit) | | Prod |
| HS Code (10-digit) | auto = 8-digit + ".00", overridable | Prod |
| Measurements | matrix: rows = measurement points, columns = sizes, plus tolerance. Enter in CM **or** inches (toggle; fractions like `1 1/4` and ranges like `12-13` accepted; the other unit is auto-converted: inches to the nearest 1/8, cm to 1 dp). Download a CSV template / upload a CSV. Plus two free-text notes (inch / cm). | Product Designers |
| Pricing | SGD RRP (read-only once linked); SGD w/o GST = SGD ÷ 1.09; JP / ID / TH / PH / CN RRP auto-filled from the **price directory** (nearest SGD match), overridable | Merch |

**Variants / colours** (one card each, pastel-tinted by colour name): Launch Date · Colour/Variant name (read-only once linked) · SKU + Barcode **per size** · Product image · Lookbook image (click or drag-drop, JPG/PNG) · Remove.

**Save rules**
- Product name required; colours must be unique within the product and not clash with another product of the same name.
- Save writes only this product's rows (upsert changed, delete removed variants).
- Every changed field is logged (shared fields once; variant fields per variant; new/removed variants), and one Teams summary is sent per save (also shown in a copyable "Teams Summary Note").
- **Hard lock** on open (same pattern as the calendar); soft presence on top: co-editors bar ("Also here: name · editing/viewing"), whole-form lock while a peer has unsaved changes, unsaved-changes badge, confirm on navigating away.
- Search box: find a product by name/category and open it.

### 7.4 Master Data

Columns: Pick · Approval (D / SC / M checkboxes) · # · [Images] · SKU (per size) · Barcode (per size) · HS 8 · HS 10 · Launch Date · Product Name (click = open in form) · Colour · Category · [Description · Fabric · Sizing · Weight · Measurements · Washcare] · Pricing (SGD shown, other markets on hover) · [Cal Status · Markets · Launch Channels]. Bracketed groups are toggleable (saved per user).

- **Pick** is enabled only when all three approvals are ticked; unticking an approval un-picks the row. Pick all visible (only approved rows).
- Search across all fields · filter by category, launch date, "Removed from Calendar only" · sort by name / launch date / category / colour / SKU (also by clicking headers).
- Lock badge / amber outline on rows being edited by someone else.
- Actions: Refresh from Calendar · Export CSV · Export JSON · Import JSON (replace all, confirmed) · + Add Product.

### 7.5 Linesheet View

- Shows only **picked** variants. Launch Title auto-derived (from the linked calendar entry, else the shared launch date); optional Notes subtitle.
- Header "Beyond The Vines — Linesheet — {Launch Title} · {note}", launch date, variant count; footer "Confidential — For trade use only".
- Per product card: product + lookbook images, name — colour, HS codes, brand, launch title, category, launch date, markets, launch channels, sizes, weight, fabric, washcare, measurement notes, SKU/barcode by size, description, measurement table, pricing grid (7 currencies).
- **Export / Print PDF** (print stylesheet) and **Export Excel** (23 columns).

### 7.6 KPI Dashboard (linesheet)

Per team, the outstanding variants (not complete, launch date not yet passed) that are missing any of the team's fields, sorted by urgency. **Due date = launch date − 30 days**; tags: Overdue / Due today / ≤7 days (amber) / ≤21 days (blue) / later / No date. Click opens the product.

| Team | Fields checked |
|---|---|
| Merch | Product Name, Category, Colour/Variant, SGD RRP, Launch Date |
| Design | Description, Washcare, Fabric, Product Image, Lookbook Image |
| Prod | HS Code, SKU, Barcode |
| Product Designers | Fabric Composition, Product Weight, Measurement Chart |

Also: Recent Changes list (field from → to, who, when) with Clear (admin only in the rebuild).

### 7.7 Weekly reminder (Monday)

Every Monday 09:00 SGT, email each team's configured recipients the list of items due within the next 30 days (the same rule as the dashboard), via the Edge Function + Resend. Recipients per team are set in **Notify Emails** (admin), with a "Send Test Now" button. *Drop the duplicate client-side Teams reminder (it fires once per browser).*

---

## 8. Shared platform features

| Feature | Requirement |
|---|---|
| Login | Email + password, retry on transient server errors (not on wrong password), friendly errors, "Forgot password?" → email link → set-new-password screen. |
| Loading state | Full-screen loader until the first view's data has loaded (with a timeout fallback). |
| Change password | Min 6 characters, confirm match. |
| Presence | One channel: who's online (nav dropdown), which record each person has open, which field they're in, whether they have unsaved changes. |
| Realtime | Live updates from teammates without a refresh; toast "Updated by {name}" when someone else's change lands. |
| Offline | Banner when offline; queue writes; flush and re-fetch on reconnect; "Back online — all changes synced". |
| Save failures | Retry with backoff; a persistent red bar with **Retry** after the final failure; never silently drop. |
| Pending queue | Durable (survives reload), tagged with the user, badge count, warn on sign-out/close. |
| Year handling | Everything year-scoped by date, current year −2 … +4 selectable. |
| Downloads | Direct downloads (no iframe postMessage proxy needed once there are no iframes). |
| Admin → Settings | Stores & channels · Categories · Price directory · Teams webhook URLs (calendar changes, Save Version, marketing published, marketing draft, linesheet) · Notify emails · Holidays per year. |
| Admin → Users | List users with module levels, teams and admin flag; invite; deactivate. |
| Audit | Every create/update/delete recorded server-side with user and before/after values; feeds the Recent Changes panels and Undo. |

---

## 9. Data model

Proposed tables (Postgres). Existing tables marked **(keep)** already exist in Supabase; migrate the others out of `app_state` blobs.

### 9.1 Identity & settings

```text
user_profiles (keep, extend)
  id uuid PK → auth.users, email, is_admin bool,
  product_calendar_access  enum('none','viewer','editor'),
  global_calendar_access   enum(...), linesheet_access enum(...),
  teams text[]            -- merch, design, prod, product_designers, supply_chain, marketing
  markets text[] NULL     -- optional Global Calendar scoping
  created_at, deactivated_at

stores            (id, market, name, open_from date NULL, open_to date NULL)
categories        (code PK, label, sort)
price_directory   (sgd numeric PK, jp, id, th, ph, cn)
webhooks          (id, purpose enum, url text)          -- admin-only; read by the Edge Function only
notify_recipients (team, email)                          -- Monday reminder
holidays          (market, date, title)                  -- replaces the hardcoded 2026 week table
```

### 9.2 Product Calendar

```text
calendar_entries (keep; normalise the JSON)
  id text PK, year int, section enum('global','china','restocks','events','store_openings'),
  entry_date date          -- launch date / ETA / event start / target open date
  end_date date NULL, till_sold_out bool,
  workflow_status enum('draft','published'),
  title text, priority enum('brand','revenue','both'),
  markets text[]           -- store the INCLUDED markets (not the excluded set)
  launch_status enum('on_time','delay'), sku_count int,
  data jsonb               -- section-specific extras (store size/address, notes, anthem, mechanics)
  linked_marketing_id text NULL, sort_order int,
  locked_by, locked_by_email, locked_at, updated_at, updated_by

calendar_lines          (id = line_id PK, entry_id FK, sort, category, product_name, size_list text, price numeric)
calendar_line_colours   (id = colour_id PK, line_id FK, sort, colour)      -- 1 row per colour → 1 linesheet product
calendar_entry_channels (entry_id, market, store)                          -- launching stores
calendar_delay_markets  (entry_id, market, eta date)
restock_lines           (entry_id, sort, product_title, colour, size)
markdowns               (id, year, title, start_date, end_date, markets text[])
calendar_versions       (id, year, label, created_at, created_by, summary jsonb)   -- summary, not full snapshots
```

### 9.3 Global Calendar

```text
global_cal_entries (keep)  id, market, row_key, title, start_date, end_date NULL, week_span,
                           status enum NULL, pillar, edm_market, edm_type, perf_objective,
                           brief, links text[], owner, seeded bool, created_at, updated_at, updated_by
marketing_entries  (keep)  id, market, row_key, status enum('draft','published'), title,
                           start_date, end_date, time, channel, store, guests int, objective,
                           target_audience, rundown, mechanics, comms, tnc, owner, links text[],
                           created_at, updated_at, updated_by
marketing_images           (id, entry_id FK, storage_path, title, notes, sort)
```

### 9.4 Linesheet

```text
linesheet_products (keep; promote key fields out of the JSON)
  id text PK             -- p_<colour_id> for calendar-linked rows
  group_id text          -- one product = one group
  colour_id FK NULL, calendar_entry_id NULL, removed_from_calendar bool,
  launch_date, launch_title, category, name, variant, sizing,
  description, washcare, fabric, weight_grams, hs_code8, hs_code10,
  measurement_matrix jsonb, measurement_note_inch, measurement_note_cm,
  sgd, sgd_ex_gst, jp, id_rrp, th, ph, cn,
  sku_by_size jsonb, barcode_by_size jsonb,
  product_image_path, lookbook_image_path,         -- Storage paths, not base64
  approved_designer, approved_sc, approved_merch bool,
  picked bool, complete bool,
  updated_at, updated_by

linesheet_product_locks (keep)  group_id PK, locked_by, locked_by_email, locked_at
```

*Shared product fields (description, fabric, pricing, …) are duplicated on every variant today. Consider a `linesheet_groups` table for shared fields + `linesheet_variants` for per-colour fields.*

### 9.5 Audit

```text
audit_log (id bigserial, table_name, record_id, action enum('insert','update','delete'),
           changed_fields jsonb {field: [from, to]}, actor uuid, actor_email, at timestamptz)
```

Written by triggers. Replaces `btvLinesheetChangeLog`, `calendar-YYYY-working-v5-changelog`, `…-history` (undo) and the unused `change_log` table.

### 9.6 Current storage keys → new home

| Current key / table | Contents | New home |
|---|---|---|
| `calendar_entries` | per-entry Product Calendar | `calendar_entries` + child tables |
| `calendar-YYYY-working-v5` (blob) | retired pre-migration calendar | archive, then delete |
| `calendar-YYYY-working-v5-history` | 50 full-state undo snapshots | `audit_log` |
| `calendar-YYYY-working-v5-versions` | 20 full-state versions | `calendar_versions` |
| `calendar-YYYY-working-v5-changelog` | version change lines | `calendar_versions.summary` |
| `calendar-YYYY-markdown-bars-v1` | markdown bars | `markdowns` |
| `calendar-YYYY-marketing-workflow-v1` | legacy marketing blob | `marketing_entries` (already) |
| `btv-admin-config-v1` | categories + stores | `categories`, `stores` |
| `linesheetCalendarData` | derived calendar→linesheet rows | computed server-side; no storage |
| `launchListMaster` | legacy launch-list export | drop |
| `btvLinesheetChangeLog` | 300-entry change log (calendar + linesheet) | `audit_log` |
| `btv-linesheet-notify-emails-v1` | Monday reminder recipients | `notify_recipients` |
| `btv_linesheet_products` (blob) | retired products blob (still read by the Edge Function!) | archive, then delete |
| `creative-cal-YYYY-v1` (local) | Global Calendar local cache | none |
| localStorage `btvMgmtWebhook`, `btvLsWebhook`, `ccWebhookPublished`, `ccWebhookDraft` | per-browser webhook URLs | `webhooks` (admin) |
| localStorage `btv-ls-master-columns-v1`, `btv-cal-year` | UI preferences | per-user preferences (local is fine) |
| `global_cal_entries`, `marketing_entries`, `linesheet_products`, `*_locks` | per-row data | keep |

---

## 10. Known issues in the current build — do not replicate

Found while reading the code. Each should be designed out of the rebuild; items 1–5 may also be worth fixing in the current site.

1. **Linesheet product images are never shared.** Images are base64 data URLs; `_stripImagesForRemote` blanks any image over 512 characters before upload, and `_fetchAll` restores images only from the *local* copy. Other users, other devices and exports on other machines see no images. → Use Storage.
2. **Week IDs are shifted by timezone.** Week keys are `mondayLocal.toISOString().slice(0,10)`, which in UTC+7/+8 is the **Sunday before** the Monday. Every stored entry and the Global Calendar bridge depend on this. → Store real dates; migrate by recomputing the week from the entry's own date.
3. **"Launch (Channel)" means two opposite things.** The form, the card ("Launch (Channel): …") and the change log treat the ticked stores as *launching*, but the Linesheet bridge treats the same list (`noLaunchChannelsCollapsed`) as *excluded* and sends every other active store to the Linesheet as the launch channels. → Confirm the intended meaning with the team; store the included set explicitly.
4. **Launch Detail popup measurement table is always blank.** It reads `row.label` / `row.values[size]`, but products store `{ point, values: [{size, inch, cm}] }`.
5. **The Monday reminder email reads a retired blob** (`app_state` key `btv_linesheet_products`), so it reports stale or no items. The client also sends its own Monday Teams reminder once per browser. → One server-side job reading the live table.
6. **Security:** public signup was on with `using (true)` RLS; a Power Automate signature URL and `adminPasscode: 'admin'` are in client code; the `creative-marketing` bucket is world-readable; a legacy in-page passcode ("BTV2026") exists. → §4, Edge Function relay, private buckets.
7. **Session state:** iframes latched onto the first signed-in user and kept their dirty keys (fixed locally on 2026-09-23 by reloading on sign-out). → No iframes; clear state on sign-out.
8. **Hardcoded 2026 content:** Global Calendar seed launches/commercial items ("Load Excel Data") and public holidays keyed by 2026 week numbers. Seeded rows use `launch` and `commercial` row keys that no longer exist, so they don't display. The Global tab has "Consumer Mindset" and "Retail Impact" rows with no way to add entries. → Holidays table per year; drop the seed.
9. **Whole-state snapshots** for undo (50) and versions (20) are synced as JSON blobs; restoring a version pushes the whole calendar. → Audit-log-based undo; versions store summaries.
10. **Change log is one shared 300-entry blob**, written by two modules, last-write-wins. → `audit_log`.
11. **Webhook URLs are per browser** (localStorage), so each person configures their own and notifications depend on who made the change. → Admin-managed, sent server-side.
12. **Viewer mode is partial:** some delete/duplicate paths don't check edit rights (e.g. Global Calendar content `deleteEntry`), and view-only users still write derived data in hidden iframes. → Server-enforced permissions; derived data computed server-side.
13. **Dead code:** hidden Launch List tab, the `launchListMaster` fallback, the `btv_product_data` Excel lookup (never populated), "SEA/NEA" regional sections (migrated into Global).
14. **Price directory is hardcoded** in the Linesheet script. → `price_directory` table (admin editable).
15. **Three presence systems** (shell "who's online", calendar item locks, Linesheet field presence on the same channel name). → One presence channel with a clear payload.

---

## 11. Migration plan

| Phase | Work | Exit criteria |
|---|---|---|
| 0. Secure now | Disable signup, run the RLS lockdown, regenerate the webhook, lock the bucket (see the security review). | Strangers can't read data. |
| 1. Decide | Access model (§4.2 options, market scoping), meaning of Launch Channels (§10 #3), whether shared product fields move to a group table. | Signed-off decisions. |
| 2. Schema | Create new tables; write migration SQL from `calendar_entries.data` → normalised columns and child tables; recompute dates/weeks; move blobs (§9.6); upload base64 images found in any user's local storage to Storage (collect via a one-off export page). | Row counts reconcile; spot-checks pass. |
| 3. Build | App shell, auth, admin, then Product Calendar → Linesheet (with server-side sync) → Global Calendar. Reuse the existing Realtime/lock RPCs. | Feature parity checklist (§12). |
| 4. Parallel run | New app on a Netlify deploy preview against a **copy** of the database; the team tests real workflows for 1–2 weeks. | No blocking issues. |
| 5. Cut over | Freeze the old app (read-only), run the final migration, point the domain at the new app, keep old blobs archived for 90 days. | Old app retired. |

---

## 12. Acceptance checklist

**Access**
- [ ] Signup disabled; a new account sees nothing until an admin grants access.
- [ ] A viewer can read and export but every write is rejected **by the server** (test via API, not just the UI).
- [ ] A Linesheet-only user cannot read or write calendar tables via the API.
- [ ] Approval D/SC/M can only be ticked by the right team (if option B is chosen).
- [ ] Signing out and in as another user in the same tab never shows or pushes the previous user's data.

**Product Calendar**
- [ ] All 5 sections + markdown row render for any year −2…+4; the current week is highlighted.
- [ ] Add/edit/duplicate/copy-to-China/delete/drag/reorder work; the date decides the week; out-of-year dates are rejected.
- [ ] Two people opening the same entry: the second sees it locked and gets it when the first closes.
- [ ] CSV/JSON import, CSV/Excel/JSON/PDF export, Save Version + Teams summary, version restore.

**Global Calendar**
- [ ] Per-market editing of every row type; social day-slots; multi-week spans.
- [ ] Publishing an activation creates the linked Product Calendar event; unpublish/delete removes it.
- [ ] Global tab merges correctly and is read-only; the launch popup shows linked Linesheet products incl. images and measurements.
- [ ] Activation export, duplicate, image upload; webhooks fire for published vs draft.

**Linesheet**
- [ ] Adding a launch line with 3 colours in the calendar creates exactly 3 variants; renaming a colour keeps the same variant; removing one flags it "Removed from Calendar".
- [ ] Enriched fields survive every calendar change.
- [ ] Images uploaded by one user are visible to another user on another device.
- [ ] Measurements in cm/inch with fractions and ranges convert correctly; CSV template round-trips.
- [ ] Pick requires all 3 approvals; the linesheet view, PDF and Excel contain only picked rows.
- [ ] KPI dashboard urgency matches "launch − 30 days"; the Monday email matches the dashboard.

**Platform**
- [ ] Realtime updates appear without a refresh; offline editing queues and flushes.
- [ ] A failed save shows Retry and is never lost; the pending badge survives reload; sign-out warns.
- [ ] Every change appears in the audit log with the correct author.

---

## 13. Appendix — reference constants

**Markets:** SG, TH, ID, PH, JP, CN. Regions used by legacy data: SEA = SG/TH/ID/PH, NEA = CN/JP.

**Default stores / channels (seeded, always open):**

| Market | Stores |
|---|---|
| CN | JAKC, Online, TKH |
| ID | Online |
| JP | Marui, Online |
| PH | Anthem, Online |
| SG | CAGT2, CAGT3, Funan, Ion, MBS, NAC, NB, Online |
| TH | CW, MB, Online |

**Categories:** ACC, BAGS, EYEWEAR, FOOTWEAR, KRTW, LF, MRTW, PETS, WRTW.

**Calendar sections:** Global · China · Restocks · Events / Activations · Store Openings (+ Markdown row).

**Priority (key level):** Brand 🟡 · Revenue 🔵 · Both 🟢 (legacy high/medium/low map to these).

**Global Calendar content statuses:** Not Started · In Progress · In Review · Approved · Delivered. Marketing: Draft · Published.

**Global Calendar marketing rows:** Brand Events · Community Activation · Retail Activation (`Retail Events`) · Digital Activation (`Digital Activations`).

**EDM market scope:** All Markets, SG/ROW, ID, PH, TH, TH Local, JP, JP Tag-on, CN. **EDM type:** Launch, Teaser, Promo/Sale, Tag-on, Seasonal/Holiday.

**GST:** 9% (SGD ex GST = SGD ÷ 1.09). **HS code 10** = HS code 8 + ".00" by default.

**Price directory:** 53 rows mapping SGD RRP → JP / ID / TH / PH / CN (nearest-SGD match), currently hardcoded in `linesheet.html` (`PRICE_DIRECTORY`). Export it to seed the `price_directory` table.

**Lock timing:** lock expires after 2 minutes idle; heartbeat every 30 s; a blocked editor re-checks every 4 s; lock requests time out after 6 s and fail open (the server trigger still protects the data).

**Current files (for reference while rebuilding):**

| File | Lines | Role |
|---|---|---|
| `index.html` | ~1,300 | Shell: auth, nav, iframes, presence, user management, notify emails |
| `js/supabase-sync.js` | ~1,000 | Blob sync engine, realtime, presence, pause/resume per iframe |
| `btv_calendar_linesheet_files/input calendar-2026.html` | ~10,300 | Product Calendar Input (all years) |
| `btv_calendar_linesheet_files/global calendar.html` | ~4,100 | Global Calendar |
| `btv_calendar_linesheet_files/linesheet.html` | ~17,000 | Linesheet |
| `supabase/functions/linesheet-monday-reminder/index.ts` | ~150 | Monday email |
| `supabase-*.sql` | — | Schema, per-row migrations, lock RPCs, RLS lockdown |
