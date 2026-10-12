# Apply the database files

There are two paths. Use one of them. Do not apply either path to the live project from this repository change. Pam applies the chosen path on staging after QA. Rollback of either path against BTV's real schema is unverified until it is run on a snapshot of that schema.

## A. Fresh project setup

Use this path on an empty database. Step 1 does not schedule the Monday reminder. Repeating these numbered steps does not schedule that job and does not call the live function. Steps 4 to 8 are not safe to repeat after step 12. The last numbered file has to stay last. Do not run an older numbered file on its own after a later numbered file.

1. `supabase-setup.sql`
2. `supabase-user-profiles-rename-migration.sql`
3. `supabase-linesheet-products-migration.sql`
4. `supabase-global-cal-migration.sql`
5. `supabase-calendar-entries-migration.sql`
6. `supabase-calendar-entries-year-column-migration.sql`
7. `supabase-calendar-entries-lock-migration.sql`
8. `supabase-linesheet-products-lock-migration.sql`
9. `supabase/migrations/20261007000000_role_aware_rls.sql`
10. `supabase/migrations/20261007150000_scope_reads_and_private_bucket.sql`
11. `supabase/migrations/20261007180000_scope_catalog_reads.sql`
12. `supabase/migrations/20261009120000_scope_calendar_entries_and_locks.sql`
13. `supabase/migrations/20261009140000_lock_requires_edit_grant.sql`
14. `supabase/migrations/20261009130000_private_creative_marketing_bucket.sql`

Do not apply step 14 until `global calendar.html` signs creative image URLs. Steps 10 to 12 install `btv.can_access` and the later policies without marking `creative-marketing` private. Step 14 is the only numbered file that does that. Its rollback is `supabase/rollbacks/20261009130000_private_creative_marketing_bucket.sql`.

## B. Upgrade an existing BTV database

Use this path on the live database and on staging when the tables already exist. Do not run `supabase-setup.sql` on this path. Do not run `supabase-monday-reminder-cron.sql` on this path. Do not run steps 2 to 8 from the fresh path. Those files recreate open policies. This path does not update `user_profiles` and it does not change an existing access flag, edit flag, or admin flag. New sign-ups are view-only: `can_access_*` defaults to true, and `can_edit_*` and `is_admin` default to false.

1. `supabase/migrations/20261009160000_upgrade_existing_objects.sql`
2. `supabase/migrations/20261007000000_role_aware_rls.sql`
3. `supabase/migrations/20261007150000_scope_reads_and_private_bucket.sql`
4. `supabase/migrations/20261007180000_scope_catalog_reads.sql`
5. `supabase/migrations/20261009120000_scope_calendar_entries_and_locks.sql`
6. `supabase/migrations/20261009140000_lock_requires_edit_grant.sql`
7. `supabase/migrations/20261009130000_private_creative_marketing_bucket.sql`

Do not apply the private bucket file until `global calendar.html` signs creative image URLs. The files before it install `btv.can_access` and the later policies without marking `creative-marketing` private. The private bucket file is the only file on this path that does that. Its rollback is `supabase/rollbacks/20261009130000_private_creative_marketing_bucket.sql`. The object file's rollback is `supabase/rollbacks/20261009160000_upgrade_existing_objects.sql`. That rollback drops a table only when this object file created it and the table has no rows.

`scripts/rls-inventory.sql` is a read-only inventory of `pg_class`, `pg_policies`, and `storage.buckets`. Pam can run it on BTV's real schema and send the result back. Do not run it against live or staging from this repository change. Compare that result with the policies this path installs.

## Monday reminder cron

`supabase-monday-reminder-cron.sql` is not a numbered step. Do not run it on staging. Do not run it from a non-live project against the live function URL.

Replace `<MONDAY_REMINDER_FUNCTION_URL>` with the function URL of the project you are logged into. If that URL names the live project, the file raises unless the session flag `btv.schedule_live_monday_cron` is `on`. Leave that flag unset except on the live project. This repository does not set the flag.

Steps 4 to 8 create her tables and leave them open to every signed-in user. Step 12 closes `calendar_entries` and `linesheet_product_locks`, and it drops the open policy names on `global_cal_entries` and `marketing_entries` that step 9 does not drop. Do not run steps 4 to 8 again after step 12. Do not run `supabase-rls-lockdown-migration.sql` after step 9. That file drops the policies this list installs.

`global_cal_entries.id` and `marketing_entries.id` are text primary keys. That is the index the creative calendar uses when it loads a page of rows. The default replica identity is enough for a realtime delete.

## Ship the creative calendar page with step 14

Deploy the site that signs creative image URLs before you apply step 14, or in the same change window. Step 14 marks the `creative-marketing` bucket private. A stored public image link stops loading until the page signs it. Steps 10 to 12 do not do this.

Saved marketing rows keep the URL they already have. The creative calendar reads that URL, takes the object path, and asks Storage for a signed URL. A newly uploaded image stores the object path, `marketing/<file>`, and the page signs that path the same way.

A signed URL lasts 12 hours. Open the image again and the page signs a new one.

## What this step changes for staff

A signed-in person can read their own profile. An admin can read every profile and can still grant access from User Management. The Monday reminder and the Teams relay read profiles with the service role, so those jobs do not use this policy.

`app_state` reads and writes follow the key. Product calendar keys need product calendar access to read and product calendar edit to write. The global calendar can read the product calendar key it copies from. Linesheet keys need linesheet or product calendar access. Notify emails stay on the admin flag. A key the app does not use is denied.

Global calendar rows and marketing rows are visible to someone with global calendar access. Realtime delivers a change only when that person can read the row.

Step 14 makes the creative-marketing bucket private. Someone with global calendar access can read an object and can request a signed URL. The anon role cannot. Until step 14, the bucket stays as step 1 left it.

## What step 11 changes for staff

Linesheet product rows are visible to someone with linesheet access, and to an admin. Product calendar access alone, or global calendar access alone, returns no product rows.

A change log row follows the same key as `app_state`. Someone who cannot read that key cannot read the log row. A key the app does not use stays hidden.

Step 11 does not change grants on `storage.objects`. Hosted projects keep the anon select grant recorded by `supabase_storage_admin`. That grant is a platform default. Row level security on `storage.objects` is what denies anon. No select policy on that table lets anon read the `creative-marketing` bucket.

After step 11, run `scripts/verify-anon-storage-select.sql`. Empty output means no `storage.objects` policy lets anon select that bucket. A printed policy name means anon can select it. The script does not change grants.

## What step 12 changes for staff

A signed-in person with product calendar, global calendar, or linesheet access can read `calendar_entries` and `linesheet_product_locks`. A profile with none of those flags sees no rows. A product calendar editor can write any calendar section. A global calendar editor can write only `section = 'events'`. A linesheet editor can read calendar rows and cannot write them. Lock rows have no insert, update, or delete policy. The lock functions are security definer and still write those rows.

## What step 13 changes for staff

Taking or refreshing a lock requires the matching edit grant. A linesheet lock needs linesheet edit. A calendar lock needs product calendar edit, or global calendar edit when the row section is `events`. An admin can still lock. Unlock clears a lock only when the caller holds it, including after that edit grant is revoked. Someone who does not hold the lock cannot clear it. The rollback is `supabase/rollbacks/20261009140000_lock_requires_edit_grant.sql`.

## Roll the files back

Roll back in reverse order. Run the step 14 rollback before the step 13 rollback. Run the step 13 rollback before the step 12 rollback. Run the step 12 rollback before the step 11 rollback. Run the step 11 rollback before the step 10 rollback. The `change_log` select policy from step 11 calls `btv.app_state_read`. The step 10 rollback drops that function. Dropping the function while the policy still names it fails.

1. Step 14, `supabase/rollbacks/20261009130000_private_creative_marketing_bucket.sql`
2. Step 13, `supabase/rollbacks/20261009140000_lock_requires_edit_grant.sql`
3. Step 12, `supabase/rollbacks/20261009120000_scope_calendar_entries_and_locks.sql`
4. Step 11, `supabase/rollbacks/20261007180000_scope_catalog_reads.sql`
5. Step 10, `supabase/rollbacks/20261007150000_scope_reads_and_private_bucket.sql`
6. Step 9, `supabase/rollbacks/20261007000000_role_aware_rls.sql`

## Runbook

Run the noLaunchMarkets repair on the staging project named by `STAGING_SUPABASE_REF`. The URL host has to be that ref on `supabase.co`. A custom domain is refused.

Run this straight after a fresh export, when nobody is editing, and after you take a snapshot. The write is not all-or-nothing. A re-export and a re-run recover a partial run.

Dry-run the export first. Pass `--apply` only after that plan looks right. The script inserts one `change_log` row after the data writes. The row records the calendar entry count, the feed write count, the product count, and the script version.
