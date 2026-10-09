# Apply the database files

Apply these files on the staging project, in this order. Run the whole list again when you need to repeat it. Each file is safe to run again, and the last file has to stay last. Do not run an older file on its own after a later file.

Do not apply these files to the live project from this repository change. Pam applies them on staging after QA.

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

Steps 4 to 8 create her tables and leave them open to every signed-in user. Step 12 closes `calendar_entries` and `linesheet_product_locks`, and it drops the open policy names on `global_cal_entries` and `marketing_entries` that step 9 does not drop. Do not run steps 4 to 8 again after step 12. Do not run `supabase-rls-lockdown-migration.sql` after step 9. That file drops the policies this list installs.

`global_cal_entries.id` and `marketing_entries.id` are text primary keys. That is the index the creative calendar uses when it loads a page of rows. The default replica identity is enough for a realtime delete.

## Ship the creative calendar page with step 10

Deploy the site that signs creative image URLs before you apply step 10, or in the same change window. Step 10 marks the `creative-marketing` bucket private. A stored public image link stops loading until the page signs it.

Saved marketing rows keep the URL they already have. The creative calendar reads that URL, takes the object path, and asks Storage for a signed URL. A newly uploaded image stores the object path, `marketing/<file>`, and the page signs that path the same way.

A signed URL lasts 12 hours. Open the image again and the page signs a new one.

## What this step changes for staff

A signed-in person can read their own profile. An admin can read every profile and can still grant access from User Management. The Monday reminder and the Teams relay read profiles with the service role, so those jobs do not use this policy.

`app_state` reads and writes follow the key. Product calendar keys need product calendar access to read and product calendar edit to write. The global calendar can read the product calendar key it copies from. Linesheet keys need linesheet or product calendar access. Notify emails stay on the admin flag. A key the app does not use is denied.

Global calendar rows and marketing rows are visible to someone with global calendar access. Realtime delivers a change only when that person can read the row.

The creative-marketing bucket is private. Someone with global calendar access can read an object and can request a signed URL. The anon role cannot.

## What step 11 changes for staff

Linesheet product rows are visible to someone with linesheet access, and to an admin. Product calendar access alone, or global calendar access alone, returns no product rows.

A change log row follows the same key as `app_state`. Someone who cannot read that key cannot read the log row. A key the app does not use stays hidden.

Step 11 does not change grants on `storage.objects`. Hosted projects keep the anon select grant recorded by `supabase_storage_admin`. That grant is a platform default. Row level security on `storage.objects` is what denies anon. No select policy on that table lets anon read the `creative-marketing` bucket.

After step 11, run `scripts/verify-anon-storage-select.sql`. Empty output means no `storage.objects` policy lets anon select that bucket. A printed policy name means anon can select it. The script does not change grants.

## What step 12 changes for staff

A signed-in person with product calendar, global calendar, or linesheet access can read `calendar_entries` and `linesheet_product_locks`. A profile with none of those flags sees no rows. A product calendar editor can write any calendar section. A global calendar editor can write only `section = 'events'`. A linesheet editor can read calendar rows and cannot write them. Lock rows have no insert, update, or delete policy. The lock functions are security definer and still write those rows.

## Roll the files back

Roll back in reverse order. Run the step 12 rollback before the step 11 rollback. Run the step 11 rollback before the step 10 rollback. The `change_log` select policy from step 11 calls `btv.app_state_read`. The step 10 rollback drops that function. Dropping the function while the policy still names it fails.

1. Step 12, `supabase/rollbacks/20261009120000_scope_calendar_entries_and_locks.sql`
2. Step 11, `supabase/rollbacks/20261007180000_scope_catalog_reads.sql`
3. Step 10, `supabase/rollbacks/20261007150000_scope_reads_and_private_bucket.sql`
4. Step 9, `supabase/rollbacks/20261007000000_role_aware_rls.sql`

## Runbook

Run the noLaunchMarkets repair on the staging project named by `STAGING_SUPABASE_REF`. The URL host has to be that ref on `supabase.co`. A custom domain is refused.

Run this straight after a fresh export, when nobody is editing, and after you take a snapshot. The write is not all-or-nothing. A re-export and a re-run recover a partial run.

Dry-run the export first. Pass `--apply` only after that plan looks right. The script inserts one `change_log` row after the data writes. The row records the calendar entry count, the feed write count, the product count, and the script version.
