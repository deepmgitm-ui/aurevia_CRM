# CRM operations and rollout — October 2026

## Rollout order

Apply these migrations in order before deploying the application changes:

1. `supabase/migrations/20261012051120_crm_experience_and_capacity.sql`
2. `supabase/migrations/20261012051646_crm_workflows_reports_and_schedule.sql`
3. `supabase/migrations/20261012110114_team_activity_presence.sql`
4. `supabase/migrations/20261012112004_team_activity_tab_signal.sql`
5. `supabase/migrations/20261014062939_employee_assigned_lead_details.sql`
6. `supabase/migrations/20261014064741_employee_generated_lead_keys.sql`
7. `supabase/migrations/20261014082713_harden_meta_and_helper_functions.sql`
8. `supabase/migrations/20261014083014_pin_security_definer_search_paths.sql`
9. `supabase/migrations/20261014084911_index_foreign_key_columns.sql`
10. `supabase/migrations/20261014084919_cache_rls_identity_checks.sql`

They add normalized date/treatment columns and indexes, appointment and assignment history, calling/report RPCs, duplicate guards, merge recovery records, and a daily database job. Existing leads are retained. Existing appointment dates become baseline visits; unknown historical actors and assignment dates are not invented. These migrations are not an instruction to merge any live duplicates. An admin must review each merge in Settings and type the matching phone number.

The source changes depend on these RPCs. Do not deploy them against an unmigrated database. Native Cron configuration cannot be verified by the isolated WASM database test. The hardening migration revokes API execution from the profile-creation trigger and automatic-RLS event-trigger helpers; PostgreSQL still invokes them through their triggers. It also pins the profile trigger's search path and adds a unique Meta lead ID for retry-safe delivery.

## Daily use

- Agents see assignments received on the selected IST date, scheduled OPD/IPD, and separate completed OPD/IPD counts. Every card opens the corresponding patients.
- Follow-ups load 50 records per page with exact counts for the entire authorized list. Callback times use IST. Start Calling works through the current Leads page; Save & Next records one atomic call and optional callback before advancing.
- Calendar visits have their own booked, confirmed, arrived, completed, cancelled and no-show status. Admins can add another visit without replacing earlier visits. Staff can update the status of their accessible appointments. Future visits cannot be marked completed.
- Daily Team Report credits calls and completions to the person who performed the action. Pending is the current queue due by the selected day, not a reconstruction of the historic queue. Old unknown actors are not credited to the current assignee.
- External lead changes refresh the visible dashboard in a short batch. Draft dialogs defer refresh. Returning to the tab refreshes stale data without continuous polling.
- Duplicate entry is blocked at the database across imports, manual entry, calendar and Meta. Existing duplicates can be reviewed in Settings. Merge keeps the selected lead's status and assignment, transfers patient history, and stores both original lead snapshots. Recovery JSON is a reference backup, not an automatic undo button.
- Exports refuse a result exceeding 5,000 matches instead of silently returning a partial file. Narrow date, agent or status filters first.

## Scheduled rules

The Supabase Cron job `aurevia-daily-workflows` runs at 03:30 UTC / 09:00 IST. It processes only enabled rules, once per rule per day, up to 500 matching leads per rule. Settings can pause the entire daily schedule and displays the last recorded run. The existing manual rule controls remain available.

Rules operate inside the database. They do not send SMS, WhatsApp, email or patient records to AI. Balance assigns only to employees. Patient activities and recovery snapshots are retained. Operational automation receipts expire after 90 days; logs of this specific Cron job expire after 14 days. No patient history is automatically deleted.

## Free-tier capacity

At 100–500 new leads per day, one year adds approximately 36,500–182,500 leads. Staff count alone cannot guarantee a year on the free tier: remarks, appointments, activities, indexes, recovery copies and monthly data transfer all count. Settings shows actual database size and record counts; monthly egress must be checked in Supabase Usage. Review growth at 250 MB database size or 18 staff rather than waiting for a quota failure. Never automatically delete patient records to fit a quota.

Supabase Free currently includes 500 MB database size, 5 GB uncached egress plus 5 GB cached egress, 1 GB file storage and two million Realtime messages. A database over the 500 MB quota enters read-only mode, so monitor the database-size figure rather than counting on the included 1 GB disk. Reports transfer database aggregates, daily pages are bounded, date/treatment filters are indexed, and automation uses a single daily database job rather than repeated Vercel requests. These changes reduce consumption; they are not a capacity guarantee. Check current [Supabase quotas](https://supabase.com/docs/guides/platform/billing-on-supabase) and [database-size behavior](https://supabase.com/docs/guides/platform/database-size) before planning growth.

Vercel Hobby is restricted to personal, non-commercial use. A clinic CRM used for commercial operations may require Vercel Pro or a hosting platform whose terms cover this use; having fewer than 20 staff does not create an exception. No paid plan is purchased by these changes. Review [Vercel's Hobby terms](https://vercel.com/docs/plans/hobby) before continuing production use on Hobby.

Sources: [Supabase pricing](https://supabase.com/pricing), [Supabase Cron](https://supabase.com/docs/guides/cron), [Vercel Hobby rules](https://vercel.com/docs/plans/hobby).

## Verification

Run the existing analytics, filter, calendar, appointment, Meta, import and automation scripts, plus `node scripts/verify-daily-work.mts` and `node scripts/verify-calendar-entry.mts`, TypeScript, targeted lint and production build.

For isolated migration testing, install the verification-only runtime with `npm install --prefix .crm-verification --no-save --package-lock=false @electric-sql/pglite`, then run `node scripts/verify-crm-migrations.cjs`. This ignored runtime is not an application dependency and the test never connects to the live database. It covers SQL syntax, ownership permissions, atomic calls and IST times, multiple visits, stale edits, more than 1,000 records, duplicate guards, bounded/idempotent/paused automation, actor attribution and merge recovery. Only the platform-specific Cron extension setup is skipped.

## Team activity

Admin/manager dashboards show Active, Idle and Offline staff, estimated active/open duration today, current session and last seen. Agents see only themselves. Daily Team Report supports a selected date. Activity is sampled about once per minute only while the CRM tab is visible. Active means an interaction was seen within approximately five minutes; no heartbeat for more than 150 seconds means offline, reflected on the next refresh. Hidden/closed tabs and long network gaps receive no credited duration. Current session is elapsed session time; daily totals credit successful short heartbeat intervals. Multiple tabs share one locked record, so they do not double duration. This is approximate CRM usage, not attendance, payroll or proof of calls. No key contents, patient data or click details are collected. Tracking starts when this feature is deployed.

One record per user per IST date keeps storage small (about 7,300 records/year for 20 staff). Only an activity boolean is writable; timestamps, date and totals are set by the database. Dashboard reads are limited to authorized staff and paused in hidden tabs. No extra Realtime channel or per-event history is created.

Deploy this feature after applying `supabase/migrations/20261012110114_team_activity_presence.sql`. Verify with `npm run verify:team-activity`, targeted lint and a production build. Status clocks come from the database rather than the staff member's computer clock.

Apply `supabase/migrations/20261012112004_team_activity_tab_signal.sql` immediately after the activity migration; it preserves a fresh interaction signal from another tab without double-crediting duration.

## Meta Lead Ads

Configure the server-only values and Meta Developer settings in [Meta lead setup](META-LEADS.md). Production webhook posts are rejected with 503 until `META_APP_SECRET` is configured, and invalid request signatures are rejected before Graph API lookup or database writes. `META_ACCESS_TOKEN` must be a Page token authorized to retrieve that Page's lead forms. Meta retries are idempotent by `leadgen_id`; phone-based duplicate checks remain an additional safeguard.

## Security and recovery

- Keep Supabase service-role credentials, Meta tokens and Meta app secrets in Vercel server-side environment variables. Do not put them in client bundles or Git.
- In Supabase Auth settings, enable leaked-password protection. This is an Auth dashboard setting and is not changed by SQL migrations.
- Take a regular database export and practice restoring it to a separate test project before depending on it as a recovery plan. Settings' lead-recovery snapshots are not a full database backup.
- Re-run Supabase security and performance advisors after database migrations. Review each `SECURITY DEFINER` grant individually; do not revoke application RPC permissions broadly without checking role behavior.
