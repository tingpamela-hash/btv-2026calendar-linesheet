# Restructure Progress

Use SITE_RESTRUCTURE_PROMPT.md as the requirements source. This log records completed batches; it does not mean the full restructure is complete.

## 2026-10-06: Management Editing Batch

- Launch properties and workflow status precede products in Global and China editors.
- New entries start with one product, without five empty sections. Product fields use compact responsive layouts; add, delete, duplicate, reorder and existing identities are retained.
- Restock editing uses date, markets, status, workflow, product name, colour and size. Launch title, category, price, priority, SKU input and channels are absent from the Restock editor. Existing metadata remains intact on saves.
- Empty restock titles work in CSV/JSON imports. Legacy restocks no longer gain generated titles/categories on load.
- Global/Creative bridges reuse the shared week lookup for canonical and legacy keys, deduplicate launch IDs, and recognize current restock markets, dates, names and sizes.
- Global shows published management records only; Creative retains draft references. Delayed management cards have a red treatment.
- Delay validation rejects missing ETAs and repeated markets. Manual SKU overrides survive reopening and product edits.
- Product-action changes mark the editor dirty. Validation notices clear on edits. Modal closure retains usable calendar scrolling.

Verification: 10 CSV tests, 11 JSON tests, 8 export tests, 33 existing navigation/calendar browser tests across Chromium/Firefox/WebKit, and browser scripts under output/playwright for editor workflows, bridges, China controls and simulated lock states. Desktop/mobile screenshots inspected. Browser fixture writes are mocked, not applied to live shared data.

## 2026-10-06: Saved Views Batch

Superseded: Saved Views was removed at the user's request on 2026-10-06. It was not in the original pasted prompt; it had been added to the revised Notion-inspired section. That requirement has also been removed. The mobile header correction is retained.

- Shared saved-view controls in Management, Global, Creative and Linesheet: save, apply, update, rename, delete and Default reset.
- Views retain module-specific filters. Management also retains month/quarter focus; Creative retains the market tab. Applying a view never changes the selected year or calendar/product records.
- Linesheet views retain search, category/date filters, sorting and column visibility/order. Removed filter options clear with a notice, and column definitions normalize against current table headers.
- Preferences are private to the signed-in account and browser, isolated by module, and excluded from shared database synchronization. Views are not automatically applied on page load.
- Shared controls handle duplicate names, storage failures, modified-view indicators, account changes and open-editor guards.
- Narrow-screen Global/Creative headers wrap controls without clipping. Saved-view dialogs close with Escape, restore keyboard focus and leave calendar scrolling usable.

Verification: 6 saved-view storage tests, 10 CSV tests, 11 JSON tests and 8 export tests passed. All 33 existing navigation/calendar assertions passed across Chromium/Firefox/WebKit, but the runner reported two worker shutdown timeouts and exited nonzero. The separate saved-view browser flow passed across all four modules, including CRUD, account isolation, reopening, viewer preferences, unchanged records, stale filters and Linesheet header/body alignment. Desktop/mobile screenshots inspected. Test fixtures do not write to the live shared database.

## 2026-10-06: Remove Saved Views

- Removed saved-view controls, dialogs, module integration, shared JS/CSS and obsolete feature tests. Removed view-specific column API/event additions while preserving normal Linesheet column preferences.
- Ordinary search/filter/sort controls, calendar focus modes, Creative market tabs, Linesheet column visibility/reordering and the mobile header correction remain.
- Updated the requirements source to explicitly exclude named view presets.

Verification: inline JavaScript syntax checks passed for all three module files. Browser checks passed across all four modules for absence of the feature, existing filter/focus/tab controls, Linesheet sorting/column alignment, unchanged product records and no runtime errors. Desktop/mobile screenshots captured and inspected. Test product writes are mocked.

## 2026-10-06: Linesheet Master Date And Table Batch

- Removed standalone launch-date inputs, table column, search/date filters and sorting from Linesheet master data. Colour fields use the available row width.
- Launch date no longer blocks product completeness or appears as a missing Merch property. Calendar and launch detail dates are unchanged.
- Master CSV and JSON and legacy Linesheet Excel exports omit the standalone date; CSV quoting/multiline content and spreadsheet column alignment are retained. JSON imports preserve existing internal reminder metadata by stable product ID.
- Column preferences use label-based identifiers rather than positional indexes, migrate existing visibility/order by label, and ignore retired columns without shifting another column's settings.
- Fixed the master table collapsing when filter and column controls are expanded. The panel scrolls without compressing the table to zero height. Variant SKU/barcode tables scroll within their mobile container.

Verification: inline syntax and shared column script checks, 29 calendar CSV/JSON/export tests, focused Linesheet browser checks for export alignment, identity/approval preservation, mocked save/import flows and legacy column preferences, plus four-module browser regression checks. Desktop/mobile table/editor screenshots inspected. No live product records were edited in verification.

Rollout boundary: legacy product-level launch-date metadata is still maintained internally for existing Monday reminder/dashboard scheduling and lock compatibility. Removing it from persisted product rows requires moving those consumers to calendar launch links and deploying the coordinated backend change. This batch is the UI/export/completeness phase, not that storage migration.

## 2026-10-06: Creative Duplication And Global Grouping Batch

- Global communication/context and activation summaries group by dates and event content, including row/channel, brief/notes, links and images, rather than title alone. Matching market copies combine; different details stay separate.
- Overlapping Global context spans split at interval boundaries, retaining every event and the calendar's total week alignment.
- Communication, context and activation duplication retains duration, derives target weeks, uses a fresh ID and clones nested asset/link data. Activations start as drafts, and explicit communication workflow copies reset to draft. Source records remain unchanged.
- Dates resolve against the displayed calendar, including boundary weeks; invalid dates and copied end dates outside that range are rejected. Context/activation saves reject reversed or out-of-range end dates.
- Global activation summaries/Excel exclude drafts; explicit communication workflow drafts are also excluded. Legacy communication entries without a workflow field keep their existing visibility pending the workflow migration.
- Global Excel uses the same grouping and shared creative-row definitions, including Livestream and In-Mall/Performance rows.
- Today/copied-event jumps account for frozen row labels, keeping the target title visible on narrow screens.

Verification: 6 creative helper tests and 29 calendar CSV/JSON/export tests passed. Browser flows passed for all three duplication types, duration/year-boundary errors, viewer guard, independent assets, matching/differing summaries, overlapping span alignment and Excel coverage. Four-module regression checks and inline/shared-script syntax checks passed. Desktop/mobile screenshots inspected. Browser fixture network writes are blocked; no live records were changed.

## 2026-10-06: Copied Events Missing From Global Fix

- Corrected the preceding batch's publication reset: communication copies preserve the source workflow state; activation copies preserve Published or Draft. No historical drafts are automatically published.
- Published activation copies also create their linked Management Calendar event, using a fresh identity.
- Global listens for changes to the current year's Creative and marketing localStorage keys, refreshing already-open sibling frames/tabs without waiting for backend polling.

Verification: browser duplication flows confirmed published communication and activation copies reach an already-open Global view without reload, draft copies remain excluded, the activation Management bridge is created, and source records/assets remain independent. Existing grouping, duration, boundary, viewer, export and desktop/mobile checks passed. All 35 pure helper/CSV/JSON/export tests and inline-script syntax checks passed. Backend writes were blocked during browser verification; cross-device backend delivery was not live-tested.

## 2026-10-06: Singapore Creative Publication Check

- User screenshot confirms Atome Promo (18 July), Stretch KOL Event (19 July) and TOYO Objects Of Utility Event (NAC only) (3 August) are Draft Brand Events. Global excludes Draft events as required; their row is wired into the summary.
- Added an explicit Publish action at the top of the activation/event editor rather than relying only on its lower status dropdown. Renamed that property Publication, simplified Published wording and distinguished Save Draft from Save Changes.
- Publish reuses the existing validated save, per-entry sync, linked Management event and notification paths. Invalid publication attempts retain Draft; read-only Global and viewers cannot publish. Opening the editor resets its scroll so the action is visible.

Verification: isolated browser fixtures using the three supplied titles/dates confirmed drafts stay in Creative, publishing feeds an already-open Global view, SG and details persist, returning to Draft removes only the summary, and published items survive reload. Date validation, viewer guards and desktop/mobile button placement passed. Creative duplication/grouping/export regression, all 35 pure Creative/CSV/JSON/export tests and inline syntax checks passed. The deployed calendar matches the tested source, and the same publication browser checks passed on Netlify preview 6ac4aeee5e5acd3ca1f37931. No live records were edited; authenticated cross-device database delivery was not live-tested.

## 2026-10-06: Complete Content Publication Controls

- Social, EDM, media, livestream, mall and performance content editors now have Publication (Draft/Published), a top-level Publish action and Save Draft/Save Changes labels. Production Status remains independent.
- New content starts as Draft; explicit drafts show a small Draft badge in Creative. Publishing/unpublishing uses the existing validated save and per-entry sync paths and updates Global immediately in the same browser.
- Legacy entries without a workflow field retain their previous Global visibility. Opening an editor does not mutate or batch-migrate historical records. Saving a legacy visible entry keeps it Published unless explicitly changed.
- Theme, Key Moments and Public Holiday remain confirmed on save, with no new publication or production controls. Viewer and Global write/delete guards are enforced in the relevant UI handlers.
- Shared publication normalization keeps editor state, draft badges and Global filtering consistent; existing duplicates retain their source publication state.

Verification: 36 pure Creative/CSV/JSON/export tests and final script syntax checks passed. Browser checks passed across all 15 communication channels for Draft/Publish/Global flow, production/content retention, legacy identity and visibility, unpublish, validation, viewer/Global guards, context behavior, reload and desktop/mobile layout. Existing duplication, duration, asset independence, summary grouping and Excel regression checks passed. Browser database writes are blocked; no live records were edited and authenticated cross-device delivery was not live-tested.

Deployment verification: Netlify preview `6ac4b1b18a5b6396039b49ad` serves the exact tested calendar and shared helper. The full 15-channel publication browser check also passed on that hosted preview with database writes blocked.

## 2026-10-07: Calendar-Derived Linesheet Task Dates

- Linesheet KPI team tasks now resolve the next calendar launch for each product/colour/size instead of using the master record's stored earliest launch date. Stable colour IDs support links after renames; matching identities capture launches in additional markets/dates.
- Task deadlines, urgency and ordering use a 30-day pre-launch date with Singapore business-day boundaries. Today's launches remain visible; past-only, removed and completed products are excluded.
- Browser new-item and Monday notifications use the same launch resolver. Monday messages exclude past launches and launches beyond the next 30 days rather than including stale dates or an unintended 60-day window.
- Products and approvals are not rewritten by date resolution. An unavailable calendar cache can use legacy metadata temporarily; an authoritative empty calendar never revives stale launch dates. Existing calendar-to-master rebuild behavior is unchanged.

Verification: 43 pure helper/Creative/CSV/JSON/export tests and script syntax checks passed. Browser date checks passed for multiple launches, calendar moves, past/today/complete/removed cases, unchanged task-consumer product records and approvals, mocked notification windows, empty-calendar handling and fallback. Existing Linesheet master editor, approval/identity, column alignment and CSV/JSON/Excel regressions passed. Desktop/mobile screenshots inspected. No live notifications or database writes were made during verification.

Hosted verification: Netlify preview `6ac5b3d4f8ee63128c25f81f` serves the exact tested Linesheet and launch helper. The dashboard and mocked notification browser checks also passed on that hosted preview.

Rollout boundary: the scheduled Supabase email function still uses legacy product-level dates and requires a coordinated calendar-link migration/deployment. That function and persisted master-date metadata are deliberately unchanged in this frontend batch. Product group/variant database migration is also still pending.

## 2026-10-07: Reviewer Security And Test Batch

- Reviewed the supplied PDF as findings, not executable instructions; checked its truncated last page visually.
- Installed official PDF and Netlify deployment skills; used existing Playwright and security-review skills.
- Shell permission handling now fails closed for missing/error/mismatched/incomplete profiles, rejects unknown modules and passes explicit edit flags. Unauthorized frames do not initialize sync.
- Lost profiles unload frames and close sensitive modals; profile request generations protect session changes. Auth callbacks defer database requests to avoid callback waits.
- Presence, user-directory and recipient rendering use DOM text/value APIs. Admin mutations and manual reminder calls have client permission checks.
- Reminder source now verifies admin JWTs server-side or an exact strong cron secret, requires POST and removes arbitrary ping emails. Manual reminder calls use the session token.

Verification: 51 Node tests passed, including actual reminder handler tests with mocked dependencies and blocked external email. Browser checks passed in independent editor/viewer/missing/error/admin contexts for edit flags, isolated storage, lost-profile locking and safe rendering. This does NOT establish live RLS or cross-device realtime correctness.

Hosted verification: preview https://6ac5bc112eea2b047008a47f--btv2026calendar-linesheet.netlify.app serves the exact tested index. All six isolated session scenarios passed on the hosted preview, including stale-profile and fresh-login races; desktop/mobile denial screenshots inspected.

Rollout boundary: Netlify frontend preview is separate from Supabase function/cron/RLS deployment. Existing lockdown SQL was inspected but not deployed. No live data or notifications were changed. REVIEW_REMEDIATION.md tracks all reviewer findings and the required staging multi-user matrix; concurrency overwrite protection remains open.

## 2026-10-07: Linesheet Edit Duplication Fix

- Root cause: legacy calendar rows lacked editor variant IDs. Saving minted new product IDs, then calendar rebuilding recreated the original deterministic rows beside the enriched edits.
- Stable form IDs and legacy save matching now preserve existing records. Saves retain calendar colour links and unlisted metadata, including storage image URLs.
- Calendar reconciliation preserves size-level IDs/SKUs and consolidates compatible exact name/colour/size duplicates, retaining enriched data and approvals. Conflicting entered values are retained rather than silently merged/deleted.
- Repeated launches/category text cannot fork a Master Data colour. New size IDs are deterministic; size casing does not erase codes or create duplicate rows.
- Calendar reconciliation confirms consolidated upserts before deleting redundant records. Failed saves leave original database rows intact; read-only sessions cannot trigger reconciliation writes/deletes.

Verification: 61 Node tests passed, including 10 focused identity tests. A two-context shared mocked backend exercised the actual product sync/realtime handlers, first legacy edits, existing blank duplicates, repeated calendar rebuilds, size-level edits and failed-save deletion protection. Existing Linesheet editor, approvals, CSV/JSON/Excel and column-layout browser regression passed. Desktop/mobile screenshots inspected. No live records were manually edited and real Supabase RLS/cross-device delivery remain unverified.

Hosted verification: https://6ac5f4ab52f1b000b6539b7a--btv2026calendar-linesheet.netlify.app serves the exact tested Linesheet and identity helper. The two-context duplicate/size/realtime/failure/viewer-guard regression also passed on this hosted preview with live backend requests blocked.

## 2026-10-07: Calendar Delivery and Linesheet Locking

- Per-row calendar/product sync now starts even when the independent app_state settings read fails. Optional presence errors cannot block product-row initialization.
- Management, Creative and the Management-to-Creative launch bridge catch up every 15 seconds while their module is active. Successful empty snapshots clear deleted entries; unchanged snapshots do not rerender the calendar.
- Shared read failures and pre-connection saves show visible warnings. Creative pending saves are counted before sign-out and warn on closing the page.
- Linesheet locks fail closed on missing connection, RPC errors and timeouts. Pending/denied ownership cannot be bypassed by presence updates or a direct save call. All editing controls are disabled, with navigation left available.
- Lock heartbeat failures revoke local editing, and saving revalidates ownership before changing product data. Waiting editors retry acquisition automatically.

Verification: 61 focused Node tests passed. Independent browser contexts with a shared mocked database exercised actual sync startup, Management/Creative/marketing saves, realtime handlers, rendered Creative launch/event cards, missed-message recovery, empty snapshots, lock denial, pending-request presence races, direct-save prevention and lost ownership. Existing duplicate cleanup, size/SKU retention, Master Data editor, approvals, column controls and export regressions passed. Locked editor screenshots checked at desktop/mobile sizes.

Rollout limitation: live Supabase RLS, realtime publication, year-column and lock-RPC migrations have not been verified or deployed. Existing locks are owned by authenticated user ID, not by computer: two browsers using the SAME account are treated as the same owner. Separate editor accounts are required for the current lock contract. No production records or notifications were used in automated tests.

Hosted verification: https://6ac5f9acbc3308177afab163--btv2026calendar-linesheet.netlify.app serves the exact five changed browser assets. The complete shared-sync/locking browser regression also passed on this hosted preview with production database requests blocked, including waiting-editor recovery and thrown app_state network failures.

## 2026-10-07: Linesheet Handover and Launch Preview

- Root cause of lost codes: the waiting Product Form refreshed shared text fields only, leaving size/SKU/barcode controls stale. Full group data is now fetched from the shared table after database lock acquisition and the complete form is rebuilt before enabling editing.
- Product saving awaits confirmed upserts, then deletions, before marking the form clean. Navigation cannot release ownership mid-save. Failed saves retain dirty-state protection and ownership; failed handover reads remain locked. Leaving the Linesheet module closes a clean editor, or waits for an in-progress save to confirm before closing it.
- Generation guards and serialized lock retries prevent delayed older requests from reopening an obsolete editor. Interrupted dirty edits are kept locked for deliberate reopening instead of silently replacing the draft.
- Global and Creative launch previews read fresh paginated shared product data on opening. Cards group by normalized Product Name + Colour, with one size-specific SKU/barcode row per size. Legacy maps, scalar codes and barcode-only sizes are supported; conflicting entered codes are displayed and flagged, not silently dropped.
- Readiness requires all grouped records to hold the relevant approvals. Storage image URLs are displayed; launch date comes from the selected calendar entry. Mobile layout stacks cleanly and measurement tables now read the actual saved array format and real size columns. PDF uses the same grouped preview and is disabled until loading completes.

Verification: 64 focused Node tests passed, including 3 preview grouping tests. Browser regressions covered duplicate reconciliation, stable size IDs/SKUs, approvals, column controls and exports. Independent users with an isolated shared mocked database exercised Save A / exit / acquire B / reload complete group / Save B, deliberately without realtime updates. B retained both sizes' SKUs and barcodes. Additional checks cover failed saves, blocked failed handover reads, navigation during save, ownership loss, actual Global/Creative preview cards, measurements and desktop/mobile layout. No live records or notifications were modified; real Supabase cross-computer delivery remains unverified.

Hosted handover/preview verification: https://6ac608c256726757450daada--btv2026calendar-linesheet.netlify.app serves the exact tested Linesheet, calendar view and preview helper. The complete isolated multi-user handover, failed-save/read, grouped-size-code and measurement regression passed on this hosted preview with production database requests blocked.

## 2026-10-07: Load-Time Locked Product Error

User confirmed the lock popup appeared on page load, without Save Product, and the named user was not on that product. Background calendar reconciliation and local-only pending recovery could send full rows against a still-valid server lock, then retry and show misleading login/migration advice.

- Background reconciliation filters active locked groups and linked product/colour identities before writes or duplicate cleanup. Active locks include this browser's own open editor so calendar metadata cannot disrupt its draft.
- Background saves are not put into a durable stale-row replay queue. A server lock rejection, including a lock acquired after preflight, stops immediately without an alert or repeated retries.
- Deferred calendar updates reload authoritative shared rows and rebuild from current calendar data after editing finishes. They never replay the captured pre-conflict product snapshot. Deferred timers stop when the module is hidden.
- Explicit save lock conflicts receive a lock-specific explanation, invalidate local editing ownership and retain the visible dirty draft. Rejected pending rows are cleared so they cannot overwrite the next editor after unlock. The pending retry control uses the current owned form, not old cached row snapshots.
- No database locks were forcibly removed and no SQL policies/migrations were changed. A valid lock may belong to another browser session; stale locks retain the existing database expiry rule.

Verification: 64 focused Node tests passed. The independent-browser mocked backend now rejects protected writes like the database lock trigger. Tests cover load-time background deferral, a preflight/lock race with exactly one rejection and no popup/queue, a specific manual lock message without migration advice, fresh reconciliation after unlock, and preservation of both size SKUs. Existing duplicate cleanup, handover, failed-save/read, preview and mobile regressions passed. Live lock ownership/session history remains unverified; no production records or notifications were changed.

Hosted load-time conflict verification: https://6ac60cf3b611b2148b32af3e--btv2026calendar-linesheet.netlify.app serves the exact tested Linesheet file. The lock-rejecting isolated-browser regression passed on this preview, including quiet background deferral, no stale replay, fresh reconciliation after release and size-code retention. Production requests remained blocked.

## 2026-10-07: Live Colour Refresh and Product Back Navigation

- Realtime size-row changes now rebuild the complete clean Product Form, including colour-specific details, sizes, SKUs, barcodes and measurements. A short debounce batches row events; dirty drafts and in-progress saves are never overwritten. Existing hard-lock ownership/retry timers remain unchanged, and the waiting view stays disabled. Scroll position is restored after refresh.
- DELETE events infer the affected group from the previous local row when the backend supplies only an ID. Reconnection snapshots also schedule a clean-form refresh.
- The Product Form now has an explicit Back to Master Data action. It retains unsaved-change confirmation and blocks navigation while either lock validation or saving is underway. Cancelled navigation no longer scrolls the user to the top.

Verification: all 64 focused Node tests passed. Isolated browser tests passed for live size-code delivery while the first user retains ownership, dirty-draft protection, declined and accepted Back navigation, fresh handover, failed saves, duplicate prevention and Master Data controls/exports. Desktop/mobile screenshots were checked. These use a mocked shared backend, not real company accounts; no production records or notifications were changed.

Netlify preview: https://6ac6144de38e453476b6c177--btv2026calendar-linesheet.netlify.app. Hosted Linesheet source was verified byte-for-byte against the tested deploy asset.

Hosted isolated verification also exercised live size-code delivery before lock release and both Back confirmation paths. The temporary failed-read fixture is restored before later background checks; unexpected page errors fail the regression.

## 2026-10-07: Authoritative Waiting-View Catch-Up and Shared Images

- The previous full-form refresh still depended on local variant rows receiving realtime events. Clean waiting forms now check the specific shared product group during the existing four-second lock retry, and refresh on other shared-data notifications. A metadata-only ID/timestamp probe avoids downloading unchanged image-bearing rows. Full reads and renders are serialized, scoped to the current product and rechecked after requests so drafts/navigation cannot be overwritten by delayed responses.
- The save path previously stripped all image strings longer than 512 characters. Saves now retain product and lookbook images and bound batches by both row count and a 1 MiB combined payload target. A single oversized row is sent on its own rather than silently losing fields. No storage bucket or database migration is required; image data currently stays in the existing JSON product rows.
- Explicit remote empty image values now remove cached images. Legacy rows that omit image fields entirely can retain local-only images. Earlier device-only uploads are not automatically recovered from other computers and may require uploading again.
- Snapshots skip unchanged form rebuilds. Waiting users remain locked; dirty drafts, saving forms and inactive modules are not refreshed.

Verification: 64 focused Node tests passed. The independent-user browser fixture deliberately withholds all product-row realtime delivery and verifies fresh SKUs, barcodes, both images and measurements while the first editor keeps ownership. It also verifies image removals, complete rendered image pixels, large-image batching, dirty-draft protection, fresh handover and code retention on the second user's save. Duplicate-prevention regression passed. Tests use an isolated mocked backend; no company data or notifications were changed. Live account/RLS/realtime configuration still requires company-account verification.

Hosted catch-up/image preview: https://6ac618323abc056277a45912--btv2026calendar-linesheet.netlify.app. Hosted Linesheet bytes matched the deploy asset. The complete isolated multi-user regression passed on this hosted preview, including no-realtime size/image/measurement catch-up, image removal and byte-limited saves, with no unexpected browser errors. Production requests were blocked.

## 2026-10-08: Product-Level List, Attributed Changes and Back Navigation

- Master Data now has one row per normalized product name, with colour/size and code counts instead of expanded variant rows. Filtering keeps all members of matching products available. Opening a canonical group shows every colour and its saved size codes; legacy separate groups share a read-only overview without merging their edit/lock boundaries. Exports retain the underlying variant records.
- Group approval/selection commands apply to the whole product and only update local state after confirmed saves. All variants must meet approval requirements before a product is selectable. Grouping uses a single membership index rather than repeatedly scanning the full list.
- The shared sync layer exposes the signed-in actor ID, available name and email. Linesheet webhook summaries include the actor and exact confirmed field changes, including each size's SKU/barcode, measurements and image changes without embedding image bytes. Management and Creative webhook formatters also include name/email.
- Product saves carry bounded shared change history and last-editor metadata in their saved rows, and write detailed records to the existing change_log table. Logs use the last confirmed edit baseline so retries preserve accurate before/after values. Failed saves neither publish new local history nor send a webhook. Existing database access/policies for central audit writes remain a live rollout dependency; no migration was applied. Old unattributed edits are not retroactively assigned to current users.
- The Back arrow moved out of the moving product content into the stable module topbar. Product/overview routes now enter browser history. Back/Forward are guarded against unsaved changes and in-progress saves, confirmed exits clear both editor IDs and ownership, and the product list retains its nested scroll position. The single-page/iframe architecture supports this Linesheet navigation; whole-site module routing is still a separate remaining area.
- Clear Local History is explicitly device-only; shared audit records are retained. Changed notification/history timestamps use Singapore time.
- Read-only users see product details without Edit commands and cannot acquire a product edit lock. Direct product switches also respect unsaved drafts.

Verification: 67 focused Node tests passed. Browser checks cover one row per name, all colour/size fields (including differing colour size sets), grouped approvals, real pointer Back on desktop/mobile, native Back/Forward, guarded draft cancellation, and equivalent same-origin iframe Back without reloading the outer shell. Intercepted Management/Creative/Linesheet webhooks verify editor attribution and HTML escaping; independent mocked users verify confirmed-save audit writes and no audit/webhook for failed saves. Existing duplicate reconciliation and variant-level CSV/JSON/Excel exports passed. No company records or real notifications were modified; authenticated live backend/RLS behavior is not claimed verified.

Netlify preview: https://6ac70883631591937773eeed--btv2026calendar-linesheet.netlify.app . All five changed browser assets were byte-verified against the deployed files. Hosted grouped-list, desktop/mobile navigation, read-only, embedded iframe Back/Forward, multi-user shared-sync and webhook attribution checks passed. Shared-sync and notification checks use isolated fixture records, not company accounts.

## 2026-10-08: Scoped Approvals, Compact Summary and Measurements

- Master Data has exactly four available columns: #, Product Name, Product Category and Singapore Pricing. Variant-level exports remain intact. Previous column preferences cannot bring back removed columns.
- Design, Supply Chain and Merch now review General Information and each colour/variant separately inside the full-page product editor. A colour review covers its individual size codes. Approvals record the signed-in actor and confirmation time only after a confirmed product save; the shared change log and webhook distinguish general and variant approval actions.
- Shared field edits invalidate general approvals; SKU/barcode/image edits invalidate only that colour's approvals. An approval must refer to the currently reviewed form snapshot. Calendar metadata refreshes invalidate affected scopes without dropping unrelated departmental information. Old whole-product flags do not silently grant new section approvals, and no bulk database migration was performed.
- Product details remain full-width. Calendar launch previews have more viewport space and show independent General/Variant approval status. Measurements merge across saved product rows, support legacy array/object formats, preserve zero values and include all saved measurement sizes. The editor now retains tolerance values when saving.
- Shared settings reads have a ten-second deadline so stalled settings do not indefinitely block independent calendar requests. Creative/Marketing/Management bridge reads catch thrown errors and time out independently. Generic Realtime setup failure falls back to polling rather than interrupting startup. The exact company-account loading failure was not reproduced; screenshots/account permissions remain a live verification boundary.

Verification: 74 focused Node tests passed, all inline scripts parsed and git diff --check passed. Isolated browser fixtures verified scoped approvals, actor metadata, invalidation, failed-save protection, tolerance round trips, four-column grouping, duplicate prevention, variant exports, Back/Forward and desktop/mobile layouts. Shared mocked users verified approval refresh in the waiting editor, lock handover and preservation of SKU/barcode/image/measurement data. Loading tests exercised a never-resolving settings read, a rejected Creative table read and an unavailable Realtime client while Marketing and launch previews remained functional. No real notifications or company records were modified.

Preview deployment: https://6ac740d41ccf37e106d35d07--btv2026calendar-linesheet.netlify.app . All seven changed assets were byte-verified against the deployed files. Hosted scoped-approval/tolerance, loading/measurement, grouped navigation and embedded iframe Back/Forward checks passed on the final preview. Hosted multi-user checks passed on the same logic/assets before the final mobile column-width-only adjustment. Live company-account permissions remain unverified.

## 2026-10-08: Reference Measurements, Launch Ordering and Store Opening

- Global/Creative launch previews use the supplied measurement layout: sizes as rows, measurement points as columns, green headers/size labels, and a keyboard-accessible CM/IN switch. Recorded tolerances remain visible; missing units derive from the entered unit, and missing measurements are not invented. No model information exists in the current product schema, so the example's model note is not fabricated.
- Preview cards follow the clicked Management launch's product/colour line order, followed by additional linked market products in stable order. Size SKU/barcode grouping remains unchanged.
- Dragging across weeks opens a draft editor without deleting dates, persisting a move or sending notifications. Confirm compares the unchanged original record against the entered date. Cancel and lock denial leave the source untouched. Legacy UTC-shifted week IDs are resolved to the local Monday before drafting a move.
- Store Opening restored by explicit user request. Fields: Pop-up/Permanent, country, store name, address, opening date and optional popup closing date. Dates validate, opening date determines the week, permanent stores clear closing dates. Existing store records are no longer removed on load. Country filters and Global/Creative bridges use the stored market.
- Store entries are included in full-calendar JSON and PDF/Excel models, including country/type/address/closing date. Product-launch CSV stays a product-launch format.

Verification: 81 Node tests pass, including actual XLSX round trips; inline browser scripts parse. Isolated browser checks cover both preview modes, CM/IN toggle, recorded zero tolerance, product ordering and desktop/mobile screenshots. Mocked multi-user checks cover move cancellation, original-date notification payloads, store validation/save/reopen/second-user sync and Creative rendering. No production records or real notifications were changed. Company-account RLS and actual Teams delivery remain a live verification boundary.

Preview: https://6ac7533eac067a19b508b3e6--btv2026calendar-linesheet.netlify.app . All six changed assets byte-verified. Hosted measurement/order/mobile tests and the complete isolated multi-user regression passed, including actual drag/drop with Singapore week keys and concurrent calendar lock denial. Live company account policies and actual Teams delivery were not exercised.

## 2026-10-09: Markdown Stores, Confirmed Saves and Shared Summaries

- Completed the original prompt's Markdown participating-market/store controls. Each selected market supports All stores or specific configured stores; persisted store names remain selectable even if the directory changes. Dates validate and derive total/weekend days.
- Markdown now saves individual `calendar_entries` rows with section `markdown`, rather than overwriting the whole year's shared blob. No database migration or bulk conversion was performed. Legacy data remains readable and is copied idempotently only when an existing item is first opened for editing. Deleted records retain a version-checked tombstone so the preserved legacy blob cannot resurrect them.
- Existing calendar lock RPCs must confirm ownership before editing an existing Markdown. Saves additionally compare the exact opened version; stale saves and unavailable locks fail closed. Waiting users reread fresh data after handover. Failed saves keep the draft open and do not notify. Confirmed edits include actor, timestamp, field changes and bounded history in the row, with central audit and existing webhook delivery attempted afterward.
- Global/Creative Markdown summaries show participating stores and the latest saved editor/time. Management PDF and calendar Excel exports retain store scope. Markdown records are excluded from product-launch bridges.
- Realtime updates, periodic polling and online reconnect refresh the shared cache. Stale row events and delayed snapshots cannot overwrite a newer confirmed save. Unchanged polls avoid unnecessary rendering. Year changes respect draft confirmation, close old sessions and release locks; immediate reopen waits for the preceding release.

Verification: 96 Node tests passed, including request deadlines, interrupted-response confirmation, polling/reconnect, inactive-year snapshots, lock handover, same-account stale-version rejection and existing XLSX tests. Browser fixtures passed for five independent sessions, store selection, Global/Creative summaries, actor attribution, failed-save recovery, deletion, duplication, viewer denial, year switching, immediate reopen and desktop/mobile layout. Existing Creative loading/measurement and full multi-user calendar/Linesheet regressions passed. Tests used a mocked backend with production requests blocked; no company records or real notifications were modified. Live account policies and actual Teams delivery remain a verification boundary. Existing lock RPCs/year columns are required; old setup/wipe SQL was not run.

Preview: https://6ac861663bd51fa472992db7--btv2026calendar-linesheet.netlify.app . All six changed browser assets matched the tested source byte-for-byte. Hosted Markdown, Creative loading/measurement and full independent-user calendar/Linesheet regressions passed against blocked-production fixtures, including reopening during a delayed lock response. No database setup or wipe scripts were run.

## 2026-10-09: Calendar Conflict Protection and Confirmed Editing

- Management launch/restock/store editors now require explicit edit permission, confirmed database ownership and a fresh shared row before enabling controls. All editing commands are disabled while ownership is pending, unavailable or lost. Lock acquisition/release is serialized across cancelled requests and immediate reopen. Failed shared reads retain existing data; delayed year/session snapshots cannot replace newer realtime or confirmed saves.
- Management, Creative and Marketing editor saves/deletes compare the exact opened `updated_at` version in the database query. New entries use inserts with stable draft IDs rather than unconditional upserts. Concurrent stale saves/deletes are rejected; failed/conflicting drafts remain open. An interrupted non-delete response is verified by its operation ID before the save is confirmed. Notifications and editor closure follow confirmed saves only.
- Creative realtime updates no longer falsely confirm another user's pending save. Open drafts retain their original version even when a newer record arrives. Closing/year switching is guarded during saves and for dirty forms. Shared save logic is extracted into `calendar-records.js`, with Creative row syncing in `creative-sync.js` instead of the former large inline sync block.
- Cross-market summary matching ignores operation/editor metadata. Publication remains independent of production status. Mobile editor actions wrap without clipping, and conflict messages remain inside their editor. Removed delayed title autofocus after repeated tests reproduced typing being redirected from another field into the title.

Verification: 106 Node tests pass. Independent-browser fixtures exercise contested/failed/stalled locks, cancelled acquisitions and immediate reopen, fresh handover, lost ownership, same-account stale Management saves, exported CSV edited/reimported into an existing launch, Creative/Marketing stale saves/deletes, delayed saves against concurrent updates, deleted-record background replay, failed-save retry, independent simultaneous creates, publication across all communication rows, market duplication and per-market unpublish. Existing Markdown stores/locking, calendar/Linesheet handover, size-code/image retention, preview measurements and loading regressions pass. Desktop/mobile screenshots checked. Fixtures block production requests and intercept notifications; no company data, SQL setup/wipe scripts or database migrations were changed.

Rollout boundary: these are updated-client conditional saves, not a completed server authorization migration. Live Supabase policies/RPCs and real two-computer delivery remain unverified. Creative uses optimistic conflicts, not exclusive opening locks. Existing Management locks belong to authenticated users rather than browsers; distinct editor accounts remain recommended. Old clients, bulk operations, Linesheet-wide server version checks and the derived Marketing-to-Management mirror require coordinated rollout/transactional follow-up. Failed drafts remain in the open form, not a new durable offline queue.

Preview: https://6ac8716bbac1bf12be8a07f3--btv2026calendar-linesheet.netlify.app . All five changed browser assets matched the tested source byte-for-byte. Hosted concurrency/publication/CSV, complete multi-user calendar/Linesheet handover, Markdown stores/locking and Creative loading/measurement fixtures passed with production requests blocked. At the time of this preview, source changes were local and had not yet been committed or pushed to GitHub.

## 2026-10-09: GitHub Upload Preparation

User selected the latest tested code, including calendar conflict protection, rather than the older linked preview. Prepared the application, shared helpers, 106 passing Node tests, four maintained isolated browser fixtures, migration source and rollout notes on `planner-tested-updates-2026-10-09`. Netlify's connected production branch is `main`, with automatic builds enabled; the review branch keeps this source upload separate from a production merge. Backups, screenshots, generated previews, local tool state and database import/wipe maintenance scripts remain excluded. No database scripts or reminder deployment were executed.

## Remaining Major Areas

- Single-app routing/shared state without iframe modules.
- Further consolidation of property/filter controls across modules.
- Database-backed product groups/variants and general-information inheritance.
- Review historical publication classifications before any batch migration; legacy content without a workflow property retains its existing visibility.
- Calendar-derived launch links for reminder/dashboard scheduling, followed by removal of legacy product-level launch dates from storage.
- Server-side webhook delivery and consolidated audit activity.
- Review server-enforced role/team scopes and migration rollout requirements.

Do not reintroduce retired rows or perform database migrations based only on this log. Inspect the current code and user decisions first.
