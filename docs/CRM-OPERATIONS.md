# CRM operations and rollout — 12 October 2026

## Rollout order

Apply these migrations in order before deploying the application changes:

1. `supabase/migrations/20261012051120_crm_experience_and_capacity.sql`
2. `supabase/migrations/20261012051646_crm_workflows_reports_and_schedule.sql`

They add normalized date/treatment columns and indexes, appointment and assignment history, calling/report RPCs, duplicate guards, merge recovery records, and a daily database job. Existing leads are retained. Existing appointment dates become baseline visits; unknown historical actors and assignment dates are not invented. These migrations are not an instruction to merge any live duplicates. An admin must review each merge in Settings and type the matching phone number.

The source changes depend on these RPCs. Do not deploy them against an unmigrated database. The initial live migration attempt was rejected by automatic approval review; the rollout requires explicit approval for these exact database changes. Native Cron configuration cannot be verified by the isolated WASM database test.

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

Supabase Free currently includes 500 MB database size, 5 GB egress, 1 GB storage and two million Realtime messages. Reports transfer database aggregates, daily pages are bounded, date/treatment filters are indexed, and automation uses a single daily database job rather than repeated Vercel requests. These changes reduce consumption; they are not a capacity guarantee.

Vercel Hobby is restricted to personal, non-commercial use. A commercial clinic CRM does not qualify simply because it has fewer than 20 staff. No paid plan is purchased by these changes.

Sources: [Supabase pricing](https://supabase.com/pricing), [Supabase Cron](https://supabase.com/docs/guides/cron), [Vercel Hobby rules](https://vercel.com/docs/plans/hobby).

## Verification

Run the existing analytics, filter, calendar, appointment, Meta, import and automation scripts, plus `node scripts/verify-daily-work.mts` and `node scripts/verify-calendar-entry.mts`, TypeScript, targeted lint and production build.

For isolated migration testing, install the verification-only runtime with `npm install --prefix .crm-verification --no-save --package-lock=false @electric-sql/pglite`, then run `node scripts/verify-crm-migrations.cjs`. This ignored runtime is not an application dependency and the test never connects to the live database. It covers SQL syntax, ownership permissions, atomic calls and IST times, multiple visits, stale edits, more than 1,000 records, duplicate guards, bounded/idempotent/paused automation, actor attribution and merge recovery. Only the platform-specific Cron extension setup is skipped.
