# AGENT.md: how we work in this repo

These rules are for everyone who changes this repo, people and AI agents alike. They are written in plain English.

## Source of truth
- The source of truth is this repo, `tingpamela-hash/btv-2026calendar-linesheet`, branch **`planner-tested-updates-2026-10-09`** (called "the base" below). Forks and staging copies are only places to try things out.
- The live Supabase project is **`dftavnyoopghzgsxkhbw`**. Supabase shows it as "btvsupplychaintracker", but that name is only a label: this is the live BTV planner database.

## Who owns what (to confirm with Charmaine)
| Area | Files | Owner |
|---|---|---|
| Home and sign-in page | `index.html` | Charmaine (to confirm) |
| Global calendar | `btv_calendar_linesheet_files/global calendar.html` | Charmaine (to confirm) |
| Input calendar 2026 | `btv_calendar_linesheet_files/input calendar-2026.html` | Charmaine (to confirm) |
| Linesheet | `btv_calendar_linesheet_files/linesheet.html` | Charmaine (to confirm) |
| Shared logic | `js/*` | Silas proposes, Charmaine approves (to confirm) |
| Database and server functions | `supabase/*`, `supabase-*.sql` | Silas proposes, Silas and Charmaine both agree (to confirm) |
| Tests, CI and docs | `tests/*`, `.github/workflows/*`, `scripts/*`, `docs/*` | Silas (to confirm) |

## Branches and pull requests
- Use branches named `charmaine/<topic>` or `silas/<topic>`. An agent uses its owner's prefix, for example `silas/<topic>-agent`.
- **Never push straight to `main` or to the base.** Every change goes in through a pull request into the base. Don't open PRs into `main`.
- One topic per PR. Keep each PR small enough to review in one sitting.
- Before you open a PR, update your branch with the latest base: `git fetch origin && git rebase origin/planner-tested-updates-2026-10-09`.
- **Flag sensitive files at the top of the PR.** If the PR touches `js/supabase-sync.js` or any of the four main pages (`index.html`, `global calendar.html`, `input calendar-2026.html`, `linesheet.html`), say so in the first line of the description.

## Merging: nothing may break
- Silas or Charmaine may merge. The rule above everything else is that **a merge must not break anything.**
- Hard gates. All of these must pass before a merge:
  1. All tests pass (see below and `docs/VERIFY.md`).
  2. The checks in `docs/VERIFY.md` are done, and their results are pasted in the PR.
  3. A staging check: the change has been tried on the staging copy, and the person merging says what they clicked through.
- If any gate fails or wasn't run, don't merge.

## Versions and CHANGELOG
- Tag every merge into the base: `v1.0`, `v1.1`, `v1.2` and so on. Use `v2.0` for a big change.
- Add one plain-words line per version to `CHANGELOG.md`, saying what changed for the people using the planner.

## Tests to run before opening a PR
- `npm ci`, then `npm test`.
- When they exist in the repo: `npm run scan:secrets`, `npm run test:issues`, and `npx playwright test --config tests/e2e/playwright.config.js` (local only, live calls blocked).
- Paste the results into the PR. If a test fails, say so. Don't hide it.

## Live database rules
- Silas has read access to live.
- **No SQL, migrations, cron jobs or Edge Function deploys on live** unless all of these hold:
  1. Silas and Charmaine both agree, in writing in the PR.
  2. One named person runs it, and their name goes in the PR.
  3. A backup is taken first.
  4. It has already run on staging.
- Never re-run `supabase-setup.sql` on live.
- No secrets in the repo: no passwords, API keys, service-role keys, webhook URLs or tokens in code, commits, PRs or chat.

## If something breaks
- Revert the merge, then fix it in a new PR. Never hand-patch live.

## Code style
- **Don't add comments to code** (Silas's rule). That includes YAML and SQL we add. Use clear names instead. Markdown docs are fine.
- Leave existing comments alone.

## Handing off
Use the template in `pr-body.md` (what, why, how tested, what's left).
