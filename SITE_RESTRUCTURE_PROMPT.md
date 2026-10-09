# BTV Planner Site Restructure Prompt

Use this prompt before making major site changes. The goal is to rebuild the current calendar and linesheet tool into a cleaner, faster, single-app experience without losing the workflows the team depends on.

## Working Rules For Codex

- Read the existing code before editing: `index.html`, `js/supabase-sync.js`, `js/supabase-config.js`, `btv_calendar_linesheet_files/input calendar-2026.html`, `btv_calendar_linesheet_files/global calendar.html`, `btv_calendar_linesheet_files/linesheet.html`, Supabase migrations, and tests.
- Preserve user data and existing Supabase table contracts unless a migration is explicitly added.
- Prefer one shared implementation over duplicated HTML, duplicated sync logic, or iframe-specific code.
- Work in cohesive batches of related changes, including their data, display, import/export, and regression coverage. Avoid shipping one minor control at a time. Keep architecture migrations separately scoped when they need database changes or coordinated rollout. Verify every batch with available syntax/build checks, relevant tests, and real-browser workflow checks before publishing a Netlify preview.
- Keep code efficient: avoid whole-page reloads, whole-blob saves, duplicate render loops, and repeated Supabase clients. Use per-row data, shared helpers, and incremental rendering where practical.
- Do not silently remove features. If a current function is unclear, list it as `keep / remove / redesign decision needed`.
- Before final response, inspect the changed files, check for obvious regressions, and summarize tests run and risks.

## Target Structure

Build one website with one login, one Supabase client, one navigation system, shared state, shared realtime, and no iframe-based modules.

Primary tabs:

1. `Global Calendar`
2. `Management Calendar Input`
3. `Creative Calendar Input`
4. `Linesheet Input`
5. `Admin Settings`

The Global Calendar is the first page after login. It is read-only and shows all published information from Management Calendar, Creative Calendar, and Linesheet.

## Architecture Decisions

- One app shell, one router, one Supabase auth/session source.
- Database is the source of truth. Do not use localStorage as the working database.
- Store editable records as rows, not full JSON blobs.
- Keep realtime updates, edit locks, presence, offline save queue, and audit history.
- Use continuous date navigation centered on today. Do not split the main UX into separate year pages.
- Use real ISO dates in storage and derive week/month/year views from dates.
- Replace UI-only permissions with server-enforced RLS where possible.
- Move webhook calls server-side through an Edge Function, not directly from browser prompts or localStorage URLs.

## Navigation And UX

- Start on Global Calendar.
- Calendars should not auto-scroll on open; provide a clear `Today` button so users can jump manually.
- Provide `Today`, search, filters where useful, and clear tab navigation.
- Admin/settings must be easy to enter and return from; do not leave it as a confusing side button.
- Avoid nested cards, oversized marketing-style panels, and decorative UI that slows repeated work.
- Calendar cells and event bars must be clickable and open useful detail views.
- Delayed launches must be visually obvious on the Global Calendar with a red background or strong red status treatment.

## Notion-Inspired UI/UX Baseline

Use Notion as a product-reference baseline for interaction design and information architecture, not as the app database or implementation platform.

Adopt:

- Clean workspace shell: quiet navigation, compact headers, restrained borders, generous but efficient spacing.
- Database-view mental model: each module should feel like a configurable operational database view, not a static spreadsheet export.
- View tabs: support focused views such as Calendar, List/Table, Dashboard, and Admin/Settings where useful. Each view may have its own filters, visible properties, and sort/group logic.
- Properties-first editing: detail panels and modals should group fields like database properties, with clear labels, consistent field order, and optional/collapsed secondary fields.
- Fast page opening: clicking an item should open a useful side/center detail view while keeping the current calendar/table context available.
- Filter/sort/property controls: make controls discoverable and compact, similar to Notion database view controls, without crowding the main toolbar.
- Templates/buttons: use explicit action buttons for repeated flows such as new launch, new restock, duplicate launch, copy to China, publish, and mark delayed.
- Status clarity: use small badges and property chips rather than loud decorative panels.
- Lightweight dashboard patterns: use Notion-style linked database/dashboard thinking for summaries, but keep the app’s source of truth in Supabase.

Avoid:

- Using Notion as the operational source of truth for launches, linesheets, edit locks, realtime updates, or permissions.
- Recreating Notion’s entire feature set.
- Adding extra side panels, cards, or decoration that makes repeated supply-chain work slower.
- Hiding critical launch/product properties behind too many clicks.

Prioritize these Notion-like improvements in future slices:

1. A cleaner app shell with stable top-level navigation and an optional left workspace rail only if it improves scanning.
2. Consistent database-style toolbar controls across Global, Management, Creative, and Linesheet.
3. Item detail side/center panels with property sections instead of very large forms.
4. A compact activity/audit panel inspired by Notion page history, backed by Supabase audit data.

Saved views / named view presets are not requested and must not be added (user decision, 2026-10-06). Retain ordinary filters, sorting and configurable Linesheet columns.

## Global Calendar

Purpose: company-wide summary view.

Requirements:

- Read-only. No direct edits and no webhook needed.
- Shows published Management Calendar items and published Creative Calendar items.
- Shows `Theme`, `Key Moments`, and `Public Holiday` context rows from Creative Calendar.
- Remove `Consumer Mindset` and `Retail Impact`.
- Rename `From BTV calendar (reference only)` to `Launch Calendar`.
- Remove status and status filters from the Global Calendar.
- Clicking a launch opens a linesheet-style detail view populated from Linesheet Input through the unique product IDs.
- Merge identical creative events across markets into one summary card. If details differ, show separate cards with their market grouping.
- Exports:
  - `.xls` and PDF must preserve calendar-summary layout with expanded, readable content.
  - `.csv` and `.json` must be round-trip formats that can be edited and imported back.

## Management Calendar Input

Purpose: management/merchandising product strategy input.

Access:

- Only management editors and admins can edit.
- Some management users may view without editing.
- All edits must be audited by user and timestamp.

Rows and behavior:

- Markdown row: title, start date, end date, participating markets/stores. Add/edit/delete.
- Global launch row: add/edit/delete/duplicate/reorder product lines.
- China launch row: same as Global but China-only launch channels.
- Restock row: product name, colour, size, markets. No title required.
- Store opening row: retain existing fields and add popup toggle plus popup closing date.

Launch structure:

- General launch info grouped at top: launch title, launch date, priority, launch channel, launch status, total SKU count, workflow status.
- Products below: category, product name, SGD RRP, colour/variant, size.
- Product rows support add, delete, duplicate, and rearrange.
- Workflow status: `draft` or `published`.
- Duplicate launches across markets/dates, including copy from Global to China.
- If launch status is delayed, capture affected markets and ETA dates.

Unique product ID:

- A unique product is defined by matching `Product Name + Product Colour/Variant + Size`.
- The same unique product can appear in many launches and many markets.
- Restocks do not create Linesheet products.
- Product name input should typeahead against existing product names to improve data cleanliness.

Locks and realtime:

- Opening an event/product for edit acquires a hard lock.
- Other users can see who is editing and cannot edit the same record.
- Locks release on close, timeout, or navigation away.
- Other open browsers must receive changes without manual refresh.

Webhook:

- Fires on Management Calendar add/edit/delete.
- Message includes only: who made the change, what changed, and date/time of change.
- Must be batched/debounced enough to avoid notification spam but never lose events.

## Creative Calendar Input

Purpose: creative, activation, event, social, EDM, and media planning.

Requirements:

- Separate this from the Management Calendar.
- Market tabs: SG, TH, ID, PH, JP, CN.
- Creative users can see launches from Management Calendar as planning reference.
- Context rows owned here: Theme, Key Moments, Public Holiday.
- Creative items support draft/publish.
- Published items flow into the Global Calendar.
- Users can duplicate an event to another market and/or another date.
- If duplicated event details stay identical, Global Calendar combines the summary. If changed, Global Calendar separates the cards.

## Linesheet Input

Purpose: product master data and departmental approvals.

Requirements:

- Unique products are generated from Management Calendar Global and China launches.
- No manual add-product flow unless admin/debug mode is explicitly needed.
- Remove the old separate Linesheet View page.
- Remove `Pick All`.
- Keep approvals from the three department heads.
- Products are grouped by product name.
- General Product Information is shared across every variant with the same product name.
- Specific Production Information belongs to the unique variant/size/colour.
- New variants automatically inherit General Product Information from the product group.
- Do not store launch date in master product data because the same product can launch on multiple dates/markets.
- Linesheet data feeds back to launch details in Global Calendar by unique product ID.
- Product group pages must use hard locks and realtime updates.
- No data loss: failed saves must queue/retry and visibly warn the user.

Suggested data shape:

- `product_groups`: product name and shared general fields.
- `product_variants`: product group ID, colour/variant, size, unique product key, specific production fields.
- `launch_product_links`: launch ID, unique product key, market/date/channel context.
- `department_approvals`: product group or variant approval records, depending on final approval scope.

## Admin Settings

Rename the admin area to `Admin Settings`.

Include:

- Stores and launch channels by market.
- Categories.
- Users, roles, edit permissions, and market/team scopes.
- Webhook destinations.
- Notify emails.
- Price directory.
- Public holidays by market/year.
- Audit log access.

## Exports And Imports

- Audit current export code before changing formats.
- CSV and JSON must be editable round-trip import formats.
- XLS should be a real workbook-style export where possible; avoid fragile hand-built HTML/XML if a library is available.
- PDF should use print styles that show expanded, readable summaries.
- Include import validation, duplicate detection, and clear error reporting.

## Keep / Remove / Redesign

Keep:

- Supabase auth.
- Realtime updates.
- Edit locks.
- Presence.
- Linesheet approvals.
- Monday reminder concept.
- Export/import workflows.
- Audit/change history concept.

Remove:

- Separate iframe apps.
- Year-only navigation as the main structure.
- Global Calendar status filter.
- Consumer Mindset and Retail Impact rows.
- Separate Linesheet View.
- Pick All.
- Client-stored webhook URLs.
- Browser-only passcodes.
- Whole-blob localStorage as source of truth.

Redesign:

- Admin button/navigation.
- Product calendar and creative calendar relationship.
- Linesheet master data grouping.
- Export formats.
- Webhooks.
- Audit log and undo/version behavior.

## Verification Checklist

Before finalizing a site change:

- Confirm changed views load without console errors.
- Confirm Global Calendar starts first after login.
- Confirm Today navigation works.
- Confirm search opens or jumps to the right record.
- Confirm role restrictions in UI and, where applicable, database policy.
- Confirm realtime updates or lock state for edited records.
- Confirm CSV/JSON round-trip import shape.
- Confirm XLS/PDF output is readable.
- Run Playwright tests or add focused tests for the changed flow.
- Inspect code for duplicate logic and remove unnecessary repeated helpers.

## Skill And Tool Assessment

No additional Codex skill must be downloaded for this restructure at the start.

Use existing tools:

- Playwright skill: browser verification, screenshots, UI regression checks.
- Local code editing and tests: implementation and validation.
- Supabase migrations already in repo: database changes.

Optional later:

- If rebuilding into a modern framework, add the actual project dependencies only after choosing the stack.
- If visual benchmarking is needed, use web research for comparable calendar/planning interfaces, then apply the findings to this internal tool without copying another product.
