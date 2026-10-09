# BTV Planner

Static calendar and Linesheet application backed by Supabase. Current browser modules:

- `index.html`: login, navigation and permission-aware app shell.
- `btv_calendar_linesheet_files/global calendar.html`: read-only Global Calendar and editable Creative Calendar modes.
- `btv_calendar_linesheet_files/input calendar-2026.html`: year-switchable Management Calendar and admin settings.
- `btv_calendar_linesheet_files/linesheet.html`: grouped products, scoped approvals and variant details.

Shared helpers live in `js/`. The app still uses iframe modules; the remaining restructure work and verification limitations are tracked in `RESTRUCTURE_PROGRESS.md` and `REVIEW_REMEDIATION.md`.

## Verification

With Node 24 or newer:

```powershell
npm ci
node --test --test-isolation=none tests/*.test.js
```

Maintained browser fixture source is under `output/playwright/`. These four fixtures create independent browser contexts, mock shared records, intercept notifications and block production backend requests:

- `calendar-concurrency-check.js`
- `shared-sync-lock-check.js`
- `markdown-workflow-check.js`
- `creative-loading-measurements-check.js`

Start a static server in one terminal, then run the Playwright CLI in another:

```powershell
python -m http.server 4185 --bind 127.0.0.1
```

```powershell
New-Item -ItemType Directory -Force output/playwright
npx --package @playwright/cli playwright-cli open http://127.0.0.1:4185/
npx --package @playwright/cli playwright-cli run-code --filename output/playwright/calendar-concurrency-check.js
npx --package @playwright/cli playwright-cli close
```

Mocked tests do not establish live Supabase policies, real two-computer delivery or deployed reminder behavior. See the staging matrix in `REVIEW_REMEDIATION.md`. The older Playwright runner specs are not a substitute for these isolated fixtures and must not be run against live company accounts/data.

## Deployment

Latest tested preview: https://6ac8716bbac1bf12be8a07f3--btv2026calendar-linesheet.netlify.app

Netlify is linked to this repository's `main` branch with builds enabled. Pushing to `main` can publish production. Use a review branch for source backup/review and a deliberate Netlify preview for user testing. A preview still uses the configured Supabase backend unless explicitly isolated; do not create test company records or send real notifications during automated checks.

Supabase SQL files and the reminder function are source only. Git pushes and Netlify frontend deployments do not apply these database changes. Do not run all SQL files or rerun old setup/policy migrations: they can restore permissive policies. Never run wipe/import maintenance scripts as part of deployment. Reminder rollout requires its separate staging verification and owner-controlled secrets; see `supabase/functions/linesheet-monday-reminder/DEPLOYMENT.md`.

`js/supabase-config.js` contains the browser's public anon key, not a service-role secret. Database authorization must be enforced by Supabase. Private keys, tokens, webhook URLs, local backups, screenshots and generated previews must not be committed.
