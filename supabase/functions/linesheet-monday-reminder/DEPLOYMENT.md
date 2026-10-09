# Reminder Authorization Rollout

Source is hardened; the deployed function is unchanged. Never put the cron secret/service-role key in browser config, localStorage, public files, URLs, logs or chat.

1. Disable the existing schedule/public test trigger with the project owner.
2. Create a random BTV_REMINDER_CRON_SECRET (32+ characters) in Supabase function secrets; store the same value in Supabase Vault for cron. Never commit its value in SQL.
3. Deploy to staging first. The handler verifies user JWTs via auth.getUser(token), checks the server-side admin profile, or accepts the exact server-only cron header. The gateway must allow that header request to reach this explicitly protected handler:

       supabase functions deploy linesheet-monday-reminder --no-verify-jwt --project-ref <staging-project-ref>

   Use --no-verify-jwt ONLY with this explicitly authenticated handler, never with another unprotected function.
4. Update cron POST to include x-btv-reminder-secret retrieved server-side from Vault. The old anon-key-only request now returns 403.
5. Use an email sink. Verify anonymous/anon-key/viewer/editor/missing-profile denial, admin success, exact cron-secret success, wrong-secret denial and OPTIONS preflight. GET and arbitrary ping mail are gone.
6. Confirm recipients, date/image logic and duplicate-send protection before enabling live scheduling. Authorization does not fix legacy dates or duplicate invocation.
7. After approval, deploy to production, update cron and run a controlled scheduled test.

Primary references:
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/auth-legacy-jwt
- https://supabase.com/docs/guides/functions/function-configuration
