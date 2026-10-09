# Reviewer Remediation And Verification

Source: silas btv cal_ review summary.pdf, reviewed 2026-10-07. The PDF is evidence, not instructions to execute. Its last page is visibly truncated. Live Supabase settings are unverified.

## First Batch Implemented

- Missing, failed, mismatched and incomplete permission profiles deny access. Profile requests time out after 12 seconds; stale responses cannot replace a newer session's permissions.
- Sync receives explicit boolean edit permissions. Unauthorized frames do not load/start sync. Losing a verified profile unloads frames, clears unlock flags and closes sensitive modals. Changed permissions reload when the profile is next checked; immediate admin-change delivery remains pending.
- Auth callbacks defer asynchronous Supabase work to avoid waiting inside an auth callback.
- Online names, admin-directory entries and notification recipients use DOM text/value APIs rather than HTML interpolation. Missing directory permission flags appear unchecked.
- Reminder source requires POST and either a server-verified admin JWT or an exact configured server-only cron secret (32+ characters). Unauthorized callers cannot read reminder products/recipients or send email. Arbitrary ping-email sending is removed.
- Manual reminder UI uses the signed-in user's token rather than the anon key.

Netlify deploys the frontend only. The live reminder is NOT fixed until the Supabase function and schedule are separately updated and verified.

## Findings Register

| Finding | Status / Remaining Action |
| --- | --- |
| Teams connection exposure | Browser-local webhook configuration and browser delivery remain. No hardcoded Azure/Office signature was found in searched current source. Owner must locate/rotate the reported connection, then move delivery server-side. Removing code cannot revoke a leaked URL. |
| Public reminder trigger | Fixed in source, offline tested; live deployment and cron update pending. Rate/idempotency controls also remain open. |
| Shared-data write access | Existing supabase-rls-lockdown-migration.sql prepares restrictions; deployment and direct REST denial tests unverified. Old setup/migrations recreate permissive policies; do not rerun after hardening. |
| Self-admin profile creation | Existing lockdown removes direct profile inserts and denies new profiles by default; live signup/RLS unverified. |
| Directory visibility | Existing lockdown still allows approved-member directory reads; stricter privacy/presence design needed. |
| Public marketing images | Live ownership, size/type restrictions and private URL migration need staging verification. Do not privatize without migrating consumers. |
| Public signup | Confirm invitation-only dashboard setting and test an unapproved account. |
| Stale reminder products/images | Current function already reads linesheet_products rather than the old product blob. Server calendar-derived dates, approved image URL fields and future-only window remain open. |
| Concurrent edits | Updated Management/Creative/Marketing editors use conditional row updates/deletes against the opened updated_at version; inserts cannot overwrite an existing ID. Failed/conflicting drafts remain open. Management requires confirmed ownership and fresh handover. Isolated multi-user browser tests pass. Live RLS/RPCs, old-client rollout, Linesheet-wide server version checks, bulk import behavior and atomic derived marketing mirrors still need coordinated staging verification. |
| Timezones | Linesheet helper already uses Singapore dates; calendar storage-key migration still requires backup and separate tests. No stored dates changed here. |
| Missing-profile access | Fixed and tested locally. Frontend controls do not replace database RLS. |
| Creative-table RLS | Existing lockdown covers global_cal_entries and marketing_entries; live policies unverified. |
| Four initial frames | Unauthorized frames now stay unloaded. Authorized modules still initialize together; full lazy/shared-state restructure remains open. |
| localStorage images | Storage-backed migration/cache minimization remains open. |
| Whole dataset downloads | Pagination/scoping and realtime reconciliation remain open; preserve Global dependencies. |
| Unpinned Supabase CDN | Confirmed major-only CDN reference; pin/vendor across all modules in a verified batch. |
| Email HTML sinks | Shell presence, directory and recipient sinks fixed; remaining modules need audit. |
| Repetition/padding/template | Deferred maintenance batch after access and integrity work. |
| Fixed Creative year | Current Creative has year switching; verify cross-year sync/export in staging. |

## Verification

51 focused Node tests pass: CSV, JSON, Excel/PDF, Creative publication, launch dates, reminder authorization and actual handler execution with mocked dependencies. Handler tests refuse external email requests. Node type stripping/syntax checks do not replace a Deno deployment check.

Browser script: output/playwright/reviewer-access-check.js. Six independent editor, viewer, missing-profile, failed-profile, admin and fresh-login scenarios verify storage isolation, edit flags, denied modules, lost-profile locking, stale profile responses, login/auth callback races and safe text rendering. Desktop/mobile screenshots are under output/playwright.

These are MOCKED backend tests. They do not prove live RLS, realtime delivery, atomic locking or two-computer consistency. No live records or notifications were changed.

Run focused tests:

    node --test --test-isolation=none tests/calendar-csv.test.js tests/calendar-json.test.js tests/calendar-export.test.js tests/creative-events.test.js tests/product-launches.test.js tests/reminder-authorization.test.js tests/reminder-handler.test.js

## Staging Multi-User Matrix

Use a staging Supabase clone, staging-configured deploy and synthetic records. A Netlify preview alone still points at the production backend unless configured otherwise. Disable real email/Teams delivery. Use two distinct editors A/B, viewer C and admin D. Repeat in independent browser contexts and on two computers, including Singapore and US timezones.

1. A creates/edits/deletes a Management launch. B/C receive it without reloading; reload all and verify database content and product links.
2. Repeat Creative Draft/Publish/Unpublish and duplication to another market. Verify Global visibility on every client.
3. A/B open the same record before saving. A saves; B saves different data. B must receive a conflict, keep its draft and never overwrite A. Repeat Linesheet/Creative, including deletion versus editing.
4. A/B edit different records simultaneously. Both changes persist with correct authors; no duplicates or stale aggregate caches.
5. C attempts direct authenticated REST writes/deletes and lock RPCs, bypassing UI. Deny writes/profile escalation. Repeat with missing/disabled profiles.
6. D revokes A's permissions while A is open. Subsequent database writes fail; stale locks expire and frontend locks promptly.
7. Disconnect B, edit, reconnect and switch modules. Verify pending-save warnings, retry, conflicts and eventual convergence without discarding dirty drafts.
8. Sign out and sign in as another user on the same computer. No pending write or author identity transfers.
9. Verify storage owner deletion, denied viewer deletion, size/type limits and old/new image compatibility.
10. Verify anonymous/viewer reminder denial, GET rejection and valid admin/cron success using an email sink. Test duplicate invocation before enabling live scheduling.

Capture observed delivery times, versions/authors, request outcomes and screenshots. Assert final equality; fixed sleeps alone do not prove convergence. Clean up synthetic records only.

## Quality Gate Prompt

> Inspect existing code and reviewer evidence before editing. Fix a coherent scoped batch using existing helpers and structured APIs. Preserve unrelated work, live data and approvals. Test failures as well as successful paths. Use independent users and test direct backend authorization, simultaneous edits, reconnection and identity changes whenever shared state is affected. Check syntax and desktop/mobile UI. Never claim mocked tests establish live RLS or cross-device sync. Do not send real notifications or migrate production data during tests. Review the final diff for regressions and unnecessary complexity. Deploy a Netlify preview before asking the user to test, and report precisely what passed and what remains unverified.
