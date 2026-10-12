# VERIFY: checks before any merge into the base

Run these checks before merging into `planner-tested-updates-2026-10-09`. Paste the results into the PR. A check that wasn't run, couldn't reach its target, or gave an unclear answer counts as **not verified**. That is never a pass. A green CI run is not a staging pass, and a staging pass is not a live pass.

## QUESTION FOR CHARMAINE: what is your pre-merge check?
> Charmaine, please write here what you check before you merge, in your own words, and we'll add it as a numbered step below.

## Ground rules
- Live is not touched during verification. That means no writes, SQL, function calls, deploys or webhook posts against the live Supabase project or the live site.
- Write only to staging. Before anything that writes (SQL, inserts, uploads, deploys, creating users), confirm the target is the staging project and not live. If it names the live project, stop.
- Never print or commit keys, tokens, passwords, connection strings or webhook URLs. Logs show counts and `file:line`, never the secret value itself.
- Staging is shared. Before changing staging data, make sure nobody else is testing at the same moment.
- Browser tests run only against `127.0.0.1` or the staging site, always with the e2e config, never a config that points at the live site.

## 1. Know what you are testing
- Record the branch, commit sha, and the PRs it contains.
- If PRs are stacked, check that the top commit really contains every PR head: `git merge-base --is-ancestor <head> <top>`. GitHub's base field alone doesn't prove it.
- Run tests against the files the site actually serves (`index.html` and the three pages in `btv_calendar_linesheet_files/`). A green run on files the site doesn't serve proves nothing.

## 2. Static checks
On the changed tree, and on the added lines of every new commit:
- No Power Automate, Logic Apps or Teams webhook URLs, and no `sig=` tokens, in pages or scripts.
- The live project ref appears only in the browser config file and in documented SQL.
- The only JWT allowed in the browser config is the public anon key. A service-role key anywhere means stop and rotate it.
- No `sb_secret_`, Resend keys or private keys anywhere.
- Pages never post to a webhook directly. Notifications go through the server relay with the user's session.
- Every `href`/`src` built from stored data goes through the URL allowlist, and stored text is never written as raw HTML.
- If a new table name appears in `.from('...')`, add it to the access matrix in section 6 before passing.

## 3. Node tests (no network)
```bash
npm ci
npm run scan:secrets
npm run test:issues
for tz in UTC Asia/Singapore America/New_York; do TZ=$tz node --test tests/*.test.js || break; done
for f in js/*.js; do node --check "$f"; done
```
Pass means `fail 0` in all three time zones, with a test count no lower than last time. Database tests need a local Postgres. Without it they are not verified, not skipped.

## 4. Browser tests (local, live calls blocked)
`npx playwright test --config tests/e2e/playwright.config.js`, in three time zones (UTC, Asia/Singapore, America/New_York). Every spec must block requests to non-local hosts and realtime sockets. Check once per run that no non-local request was made. Report each area as passed, failed or not driven:
- notifications go only to the relay
- the home page, each tab and its frame load without console errors
- unsafe URLs never reach a link or image
- view-only users have no write path, even when an edit window is called by script
- multi-colour linesheet groups keep their row count and ids across open, reload and reconnect
- read-only views and exports load marketing images through signed links

## 5. Staging check
- Build the staging copy with the staging config and confirm it points at the staging project, not live.
- Check that the published copy contains no SQL, markdown, package files, CI files, env files or other repo metadata, and that those paths return 404 on the staging site.
- Scan the served site the same way as section 2.
- Deploy to staging only with the owner's go, and record the previous deployment so you can roll back.

## 6. Database changes (staging first)
- Apply migrations in the order written in `docs/DEPLOY_ORDER.md`, not in filename order.
- Never re-run `supabase-setup.sql` or the older lockdown file after the access-rule migrations. They reopen or drop policies.
- Take a snapshot and list the policies before and after. Every migration needs a rollback, and rollbacks run in reverse order.
- Make sure no cron job on staging calls the live project.
- Access matrix: for each role (no access, viewer, calendar editor, global editor, linesheet editor, admin) and each table, check reads and writes behave as intended. Run each probe in a transaction and roll it back.
- A new sign-up is view-only: `can_access_*` is true, `can_edit_*` is false, and `is_admin` is false. Existing rows are not changed by that default.
- Lock functions: a lock needs the module's edit grant, another user's lock can't be stolen, and an owner can always release their own lock, even after their grant is revoked.

## 7. Human click-through on staging
Each tester signs in with their own staging login. Record each line as pass, fail or not tried, with role and time:
- sign-in, the staging badge, sign out and back in
- Global Calendar is read-only, the Today button works, and images load
- Management: add, edit, duplicate, delete, lock, and a viewer can't save
- Creative: draft, publish, duplicate, and images
- Linesheet: open, edit, save, approvals, two editors on one group, and the count is unchanged after reload
- Admin Settings: grant and revoke a flag on a test user
- Notifications go through the relay only
- Run a two-computer test for anything about locks or saves

## 8. Pre-merge gate
Merge only when all of these hold:
1. Sections 2 to 5 pass on this exact sha (and section 6 if the PR changes SQL).
2. The section 7 click-through results are in writing.
3. Charmaine's pre-merge check (above) passes.
4. Any live SQL or deploy has written agreement from Silas and Charmaine, one named person to run it, a backup taken first, and a staging run already done.
5. A rollback anchor is recorded in the PR: the current base sha, the live deploy id, and the backup reference.

## 9. After merge
- Tag the merge (`v1.x`, or `v2.0` for a big change) and add a line to `CHANGELOG.md`.
- Re-run CI on the base.
- If something breaks, revert and fix it in a new PR. Never hand-patch live.
