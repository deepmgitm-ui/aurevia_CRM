# Aurevia CRM Production Guide

This file is the working production contract for the CRM. Update it whenever a
feature, permission, data rule, migration, environment variable, or release
procedure changes. Keep the implementation and this guide in the same change.

## Product and stack

- Clinic operations CRM built with Next.js 16, React 19, TypeScript and Supabase.
- Production hosting is the Render `aurevia-crm` web service. The connected
  Supabase project is the source of truth. Optional CRM help uses Cloudflare
  Workers AI.
- The CRM UI is English. The help assistant can respond in English or Hinglish.
- Material UI alerts use the Next.js App Router cache provider alongside the
  existing Tailwind and Base UI components.
- Supabase is the source of truth for leads, assignments, activities, attendance,
  appointments, schedules and recovery snapshots.

## Core behavior contracts

### Leads and roles

- **Admin:** can review the whole team, assign or transfer leads, manage CRM
  settings, review deletions and use administrative lead operations.
- **Manager:** can review team leads, update permitted lead details and delete
  explicitly selected leads after a backup. Lead assignment, transfer,
  unassignment, assignment batches and the Closed Leads Review queue are
  admin-only in the current application and database policies.
- **Employee:** works with their own assigned leads and attendance. Data access
  must be enforced by server actions and Supabase RLS, not just hidden UI.
- Keep the employee's visible lead list scoped to their current assignments.
  After transfer, a lead must disappear from the previous employee's view and
  appear in the new owner's view without a manual browser refresh.
- Lead pages are server-paginated at 50 rows. Explicitly selected IDs persist
  across pages and same-scope component remounts in the current browser tab for
  up to 30 minutes. Changing search/filter scope or signing in as another user
  clears that selection. Page-level Select All only adds the visible page.
- If a lead list or summary cannot load, show a retry message instead of
  presenting the failure as an empty list or zero counts.
- Phone duplicates are rejected. Do not silently create a second lead with the
  same normalized phone number.
- Assignment history records assignment, transfer and unassignment events,
  including the prior owner and acting user when available.
- Bulk admin assignment (selected IDs, Assign by Filters, unassigned-lead
  distribution, and adding to an existing batch) changes lead owners and the
  batch record/count in one database transaction. If a selected lead no longer
  matches its guard, the batch roster changed, or any update fails, no partial
  assignment is saved. Keep Current Status preserves dispositions; Send as
  Fresh resets selected leads to New and clears their prior follow-up/touch
  state.
- Import assignment-batch counts and rosters are reconciled against rows that
  were actually inserted, including when duplicate rows are skipped or a
  later import chunk fails.
- Assignment-batch transfer is one database transaction: lead ownership,
  optional Fresh reset, assignment history and the batch roster either all save
  or all roll back. Keep Current Status preserves each lead's disposition.
- Single-lead and detail-form admin reassignment create the assignment batch
  and save the lead edit in the same database transaction. A stale edit or a
  rejected row update leaves both the lead and assignment history unchanged.

### Status and follow-up

- Lead edit forms must send a status only when the user changed it, so an old
  open form cannot overwrite a newer disposition while saving other details.
- Every lead-detail save must carry the `updated_at` value read when editing
  began. The server rejects a missing or stale version, and the database update
  compares that same version so an older form cannot overwrite newer fields or
  disposition.
- Status changes compare the previously displayed status before writing.
- The supported status vocabulary is maintained in lib/lead-status.ts.
- Status changes must save through updateLeadStatus, update the visible row,
  preserve the existing role rules, and report a useful error if saving fails.
  The server action uses crm_change_lead_status so the status and its actor/time
  timeline entry commit atomically under RLS. It compares the displayed status
  before writing, returns the committed row, and does not create duplicate
  timeline entries for a no-op. On any rejected/ambiguous response the table
  reloads the RLS-scoped row before presenting the final state.
- Lead detail forms use crm_update_lead_details for non-assignment edits and
  crm_update_lead_details_admin when ownership changes. The lead update and its
  actor-attributed timeline receipt commit together; unchanged saves do not
  bump updated_at. Admin-only assignment remains a separate guarded flow.
- Status changes made by appointment completion or calendar editing also write
  the old and new lead disposition to the lead timeline in the same database
  transaction, attributed to the signed-in user. Repeating an already-saved
  disposition does not create a duplicate transition entry.
- Follow-up completion/rescheduling must update the lead and append its actor
  timeline entry in one RLS-scoped database transaction. Rescheduling clears an
  old callback time so the selected date controls task ordering.
- Language Issue is an active disposition with its own status card and filter;
  legacy Language values remain visible under the same status.
- Keep the distinction between **New Leads** (untouched assignments made today,
  plus untouched unassigned leads created today) and **Fresh Leads** (untouched
  leads after their intake/assignment day). New imported rows start untouched
  regardless of their source status or whether they have an assignee. Preserve
  the uploaded disposition as provenance until a CRM user changes that status.
- Reconcile legacy workflow markers from recorded user activity: timeline
  activity ends Fresh; otherwise old assigned records use their last assignment
  date, and unassigned records use their intake date. Untouched imported closed
  labels have no deletion-review clock until a person works the lead.
- Older unassigned untouched leads use their intake date for the Fresh card and
  its drill-down; assigned untouched leads use their latest assignment date.
- Assignment by itself does not count as a touch. An employee's note, call,
  field/status edit, or an admin/manager action on a lead ends its New/Fresh
  state; route it to the bucket for its actual CRM status. Keep this pending
  first-touch marker separate from the assignment timestamp so employee daily
  counts still mean leads assigned to that employee that day.
- Transfer history is recorded without counting the transfer as agent work or
  recursively updating the lead during its assignment change.
- A source-file Lost/closed label is not a real closed workflow until a CRM user
  first works the lead. Start its existing 7-day lost review only after it enters
  the actual Closed bucket.
- Dashboard and Leads status cards must link to the exact matching leads.
- OPD/IPD dates and appointment state must stay consistent with lib/appointments.ts
  and the calendar workflows.
- Appointment-date edits are limited to the three supported date fields and
  must save the date plus actor/time timeline receipt in one RLS-scoped
  transaction. Reject impossible calendar dates and stale edits; a timeline
  failure must roll back the appointment change.
- Follow-up date edits use the atomic lead-detail update so the saved date and
  timeline receipt cannot diverge, and the edit must preserve disposition.
- Employees can open the appointments calendar for their assigned leads only.
  The Follow-up Calendar shows dates for the signed-in user's assigned leads.
- Capacity reporting is admin-only and shows measured database relation sizes
  and aggregate project object sizes. The six-person, 100-lead-per-day estimate
  is illustrative, assumes 1–3× current average growth per lead, and does not
  guarantee Supabase quota, bandwidth, uptime or future storage usage.

### Remarks, notes and timeline

- leads.remarks contains user-entered remarks and notes only. Imported system
  identifiers or generated metadata must not be inserted into it.
- Quick notes append to Remarks and create an activity row atomically through
  crm_add_lead_note.
- Editing Remarks creates a timeline entry when the value actually changes.
- The Leads table Remarks cell must update immediately after a note or edit saves;
  the detail drawer must show the same saved value.
- Each activity displays its action, timestamp and actor name. The actor is
  lead_activities.user_id resolved to the public team-directory name.
- If an action fails, roll back optimistic UI changes, re-enable the control and
  show an actionable error. A failed request must never leave a control stuck in
  its saving state.

### Data safety and recovery

- Before bulk lead deletion, download the Excel backup. Keep the server recovery
  snapshot and Recent Deletions restore workflow.
- A page checkbox means the visible page only. It must never invoke a
  delete-all-matching operation.
- Import-batch deletion and assignment-batch deletion also require an Excel copy
  before destructive work.
- Closed/lost cleanup and its recovery behavior must follow the deployed
  Supabase migration and automation rules. Never add a cleanup rule in UI code
  alone, and never remove patient data to stay within a storage quota.
- A database migration must preserve existing lead records and assignments
  unless an explicitly approved data migration says otherwise.

## Feature and code map

| Area | Main implementation |
|---|---|
| Leads, imports, assignment, activities and deletion recovery | app/dashboard/leads-table.tsx, app/actions/leads.ts |
| Admin assignment/transfer history | app/dashboard/assignment-history/page.tsx, crm_assignment_events |
| Status vocabulary and workflow normalization | lib/lead-status.ts, lib/daily-work.ts, leads.fresh_pending_since |
| Dashboard and agent summaries | app/dashboard/page.tsx, app/dashboard/overview/, app/actions/leads.ts |
| Appointments and personal follow-up calendar | app/dashboard/calendar/, app/dashboard/follow-up-calendar/, app/actions/leads.ts, lib/appointments.ts |
| Follow-up tasks and calling | app/dashboard/tasks/task-center.tsx, app/actions/crm-workflows.ts, app/actions/leads.ts, crm_update_task_follow_up |
| Attendance, weekly offs and leave | app/dashboard/attendance/, app/actions/attendance.ts |
| Team activity and session signals | app/dashboard/team-activity-panel.tsx, app/dashboard/activity-tracker.tsx, Supabase migrations |
| Settings, capacity usage and automation | app/dashboard/settings/, app/actions/automation.ts, lib/capacity-estimate.ts |
| Meta Lead Ads webhook | app/api/meta-webhook/, lib/meta-lead.ts, docs/META-LEADS.md |
| Detailed database rollout, capacity and operations | docs/CRM-OPERATIONS.md |

The table is a navigation aid, not permission to bypass the server action or RLS
that protects the feature.

## Production configuration

Set environment variables in the hosting dashboard. Do not commit .env.local,
tokens, patient exports, database credentials or service-role keys.

| Variable | Purpose |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Browser-safe Supabase key |
| SUPABASE_SERVICE_ROLE_KEY | Server-only privileged operations; never expose to the browser |
| META_VERIFY_TOKEN | Private webhook verification value |
| META_APP_SECRET | Server-only Meta signature verification |
| META_ACCESS_TOKEN | Server-only Page token for Lead Ads retrieval |
| META_GRAPH_API_VERSION | Meta Graph API version |
| CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN | Optional help assistant |

Meta delivery also requires Meta Page permissions, a reachable production
webhook URL and a successful test lead. See docs/META-LEADS.md.

## Security and hosting notes

- Current Supabase organization plan: Free. The live security advisor reports
  leaked-password protection disabled. Supabase only offers that Auth feature
  on Pro and above; enable it in Supabase Auth password settings after an
  approved plan upgrade. It cannot be enabled with a SQL migration. See
  [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- The live advisor also flags eight `SECURITY DEFINER` RPCs because signed-in
  users can invoke them. Their definitions were reviewed: each has an
  authentication check, and the administrative functions check the required
  role. The duplicate-review capture RPC intentionally accepts CRM roles.
  Keep these grants aligned with their server-side workflows; do not revoke
  them solely to silence the advisor.
- Managers can edit team lead details and dispositions, but only admins can
  assign or transfer leads. The database rejects manager changes to
  `leads.assigned_to` even when a request bypasses the application actions.
- The performance advisor currently reports four foreign keys without
  covering indexes, 22 indexes with no recorded use, and multiple-permissive
  policy notices. No index or policy was changed in this audit: unused-index
  counters are not proof that an index is dead, and each overlapping policy
  group needs a role-by-role review before consolidation.
- Render Free may spin down after inactivity and take time to wake. This is a
  hosting-plan behavior, not a CRM data reset; Supabase remains the database.

## Release and maintenance checklist

1. Check the working tree and preserve unrelated work. Review the exact files
   and migrations changed.
2. For a database change, add a migration under supabase/migrations/, review
   its RLS, grants, indexes, triggers, rollback impact and existing-row impact.
3. Apply required migrations before deploying code that depends on them. Follow
   docs/CRM-OPERATIONS.md and the migration verification scripts.
4. Run the relevant feature checks, targeted lint, TypeScript check and
   production build. Exercise role behavior and the actual UI path affected.
5. Confirm there are no unexpected lead, assignment, status, remarks or
   appointment data changes.
6. Deploy only after checks pass. Confirm the production deployment is Ready,
   then smoke-test sign-in, lead edit, note/remarks, status, assignment and the
   feature changed.
7. Record the date, behavior change, files/migration and verification result in
   the change log below.

Do not label a feature production-ready based only on a successful local render.
When a production issue cannot be reproduced, record the observed error and
check application, database and hosting logs before changing permissions.

## Change log

| Date | Change | Verification |
|---|---|---|
| 2026-11-07 | Appointment date changes now save through a single RLS-scoped database function that commits the date and actor-attributed timeline entry together; stale forms and invalid calendar dates are rejected. Follow-up date saves use the existing atomic detail-edit transaction, so a timeline failure cannot leave an unlogged change. Removed the obsolete best-effort timeline helper. No CRM rows were changed. | Appointment and isolated migration checks cover real dates/leap years, employee ownership, allowed columns, stale writes, no-op saves, actor/time receipts, follow-up status preservation, and rollback when timeline insertion fails. All workflow verifiers, full ESLint, strict TypeScript, production build and `npm audit --omit=dev` pass. Live migration `20261106233402` is applied. The live RPC is invoker-only, denies `anon`, allows `authenticated` through RLS, and uses an empty search path; lead/activity counts remain 1,245 / 1,470. Deployment verification is pending. Authenticated browser click-through remains unavailable. |
| 2026-11-07 | Smart Assignment now reports thrown server/network errors and always clears its pending state, so the admin can retry instead of being left on “Assigning…”. Added project instructions to apply Ponytail to coding work and review changed UI with the frontend-design and current Web Interface Guidelines. No CRM records changed. | Smart Assignment ESLint, strict TypeScript and production build pass. The server action remains admin-only and uses the existing atomic bulk-assignment path. Signed-in browser click-through was unavailable because browser control timed out. |
| 2026-11-07 | Made lead detail saves transactional with their timeline entry from the drawer and table edit forms. Admin reassignment now records its edit receipt in the same transaction as ownership and batch updates. Stale edits fail, no-op saves do not bump `updated_at`, and assignment permissions remain enforced in SQL. No lead rows were modified by the migration. | Isolated PostgreSQL migration checks cover employee, manager and admin edits, status plus remarks, exact actor/timeline receipt, stale version rejection, no-op behavior, cross-owner denial, assignment bypass denial, and rollback when a timeline insert fails. Full workflow verifiers, lint, strict TypeScript and production build passed. |
| 2026-11-07 | Standardized search/note placeholders and async pending labels with concise English copy and typographic ellipses across leads, global search, appointments, attendance, assignment, settings, calling and signup. Confirmed the dashboard already has a keyboard-visible skip link and focusable main-content target. No data or workflow behavior changed. | Full ESLint, strict TypeScript, production build, all 12 workflow verifiers, isolated migration/RLS checks and live DB data audit pass. Commit `bf527ba` deployed live; `/login` returns HTTP 200 and post-deploy error/fatal/5xx logs were empty. Authenticated browser click-through remains unverified because browser control timed out. |
| 2026-11-07 | Clarified the agent dashboard’s daily status breakdown: today it covers only untouched assignments; historical dates show the full assignment cohort. Updated the link label to match its filter. No query, status, or lead data behavior changed. | Daily-work filter assertions, targeted ESLint, strict TypeScript and production build pass. |
| 2026-11-07 | Made lead disposition updates and actor timeline entries one RLS-scoped database transaction. Stale editors are rejected, status values stay inside the supported vocabulary, and the table waits for its authoritative reload on failure. Live migration `20261106185210` adds only the RPC; no lead rows were changed. | Isolated PostgreSQL checks cover employee, manager and admin status access, cross-owner denial, stale status rejection, exact actor/transition recording, no-op timeline behavior, status vocabulary validation, rollback after timeline failure, weekly-off admin/employee/manager access, leave privacy and approvals, overlap/half-day validation, and Absent guards. Full lint, migration/workflow verifiers, strict TypeScript and production build pass. Live function is invoker-only, denies `anon`, and permits authenticated calls through RLS; counts remained 1,245 leads / 1,470 activities. Render deployment is live and `/login` returns HTTP 200; Render error-level application logs were empty for the deploy window. Authenticated browser click-through remains unverified. |
| 2026-11-07 | Require the lead row's `updated_at` version for every detail save, and compare it again in the database update. Missing or stale versions cannot overwrite a newer disposition or patient fields. Pipeline cards now show the actual treatment instead of a generic label and wrap long values. Corrected `verify:db` so catalog checks it cannot inspect are reported as unverified, not falsely green. No migration or lead-data change. | All current detail-save callers supply the version; CRM migration checks, all 12 workflow verifiers, strict TypeScript, ESLint and production build pass. Read-only Supabase SQL confirms the six named lead indexes and employee activity policy exist. Commit `f61d526` is live on Render; `/login` returns HTTP 200 and no error-level app logs followed deploy. Authenticated UI click-through remains unverified. |
| 2026-11-06 | Made follow-up completion/rescheduling atomic with its actor timeline entry; reschedule clears stale callback time. Task actions recover from rejected requests and reload RLS-scoped state; task page inputs are validated. Migration `20261106182458` adds only the invoker RPC; lead rows are unchanged. | Isolated PostgreSQL/RLS checks cover reschedule/complete, status preservation, old-time clearing, unauthorized access, invalid actions and rollback after timeline failure. Daily-work assertions, targeted lint, strict TypeScript and production build pass. Live RPC is invoker-only, denies `anon`, allows authenticated users through RLS; lead/activity counts stayed 1,245 / 1,470. Authenticated browser role testing remains unavailable. |
| 2026-11-06 | Fixed the sign-in card’s minimum-width behavior on narrow screens, kept the signup link on Next.js navigation, and standardized its pending label. No authentication or CRM data flow changed. | Inspected a real 390px mobile screenshot and measured 320px, 390px and 1,440px viewports; the page has no horizontal overflow and the card stays in bounds. Login form ESLint, strict TypeScript and production build pass. |
| 2026-11-06 | Corrected the production role guide: lead assignment, transfer, unassignment, assignment-batch operations and the Closed Leads Review queue are admin-only; managers can delete only explicit selections after backup. No application code, schema or CRM data changed. | Compared the guide with the current leads table, server actions and review page; isolated CRM migration assertions, lead-filter/import verifiers, full ESLint and `git diff --check` pass. Render logs for 2026-11-06 showed no error-level entries. Live browser click-through remains unverified. |
| 2026-11-06 | Pipeline Board and dashboard insights now return a visible failure when authentication/profile data cannot load instead of showing fabricated zero counts. Replaced the dashboard's capped 20,000-row client-side scan with one RLS-respecting Postgres aggregate for exact counts and status/source totals. Migration `20261106120414` adds only the function; no lead rows are changed. | Isolated migration assertions verify unauthenticated execution is denied, anon grant is absent, the function runs as invoker, employees see only their own aggregates, and admins see the complete aggregate. Live role-context checks matched total/status/source aggregates to RLS-visible rows (admin 1,245; employee 220), and anon call was rejected. Strict TypeScript, lint, feature verifiers, and production build pass before release. |
| 2026-11-06 | Reconciled legacy lead workflow markers: recorded human activity restores first-touch state; older records without a recorded touch get a Fresh assignment/intake clock. Lead status, owner, notes, and assignment history remain unchanged; unworked imported closed leads leave the pending cleanup queue. | Isolated CRM migration assertions cover untouched imported Follow-Up, historically touched Follow-Up, and unassigned imported Dropped records, including preserved status and removal of stale review entries. Live migration `20261106112834` applied. Production remained at 1,245 leads and 1,470 activities; zero untouched leads have a missing Fresh clock; Fresh is 137, Follow-up is 1,044, and Closed is 32. |
| 2026-11-06 | Kept manager deletion permissions usable without opening general exports: managers can download only an explicit, validated selection (up to 5,000 rows) as the required pre-delete Excel backup. Bulk delete now always clears its pending state and distinguishes backup failure, unconfirmed delete requests, and confirmed deletion with a refresh failure. No lead data or schema changed. | Selected-delete export authorization, backup-first UI flow, stale-response handling, ESLint, strict TypeScript, isolated CRM migration and daily-work checks, and production build pass. Live records were not deleted. |
| 2026-11-06 | Aligned the manager-reassignment guard migration filename with the already-applied Supabase ledger version `20261106073400`; SQL is unchanged and no migration was rerun. | Compared all 58 local migration versions/names with the live ledger; exact match. Live trigger/function definition matches the repository SQL. No lead data changed. |
| 2026-11-06 | Added a keyboard-accessible “Skip to main content” link to the dashboard shell and a focusable main landmark. No workflow, data or database changes. | Dashboard shell ESLint, TypeScript and full production build pass. Visual browser verification was unavailable in this session. |
| 2026-11-06 | Removed obsolete fallbacks that queried retired HR columns from `profiles` after the employee-profile privacy migration moved them to `employee_private_profiles`. Private-profile read errors now surface instead of triggering repeated undefined-column queries; a missing profile photo still leaves the dashboard usable. No database rows or schema changed. | Confirmed the live migration is applied and Supabase logs showed the retired-column query shape; employee profile actions, directory, and dashboard now use only the protected table. Lint, TypeScript, profile/migration checks, and production build pass. |
| 2026-11-06 | Extended isolated CRM migration coverage for admin, manager and employee disposition changes through authenticated RLS. Employee status remains saved after its timeline insert and Remarks edit; manager status remains saved after a later edit; stale status writes are rejected. No application code, live schema or lead rows changed. | `npm run verify:crm-migrations` passes role-specific status updates, timeline/remarks persistence, stale status rejection, and assignment/transfer rollback cases. |
| 2026-11-06 | Removed the obsolete lead-date fallback for appointment cards; OPD/IPD lists use the same appointment RPC as their counts, while historical assignment lists use `assigned_at`. Added booking/completion drill-down and employee RLS regression assertions. No lead rows or database settings changed. | Daily-work filter check, live Supabase card-count/ID comparison and isolated migration checks pass; lint, TypeScript and production build pass. |
| 2026-11-06 | Corrected the production, Meta setup and operations guides to identify Render as the live app host; documented the current Supabase security-advisor findings and Free-plan limits. No app code, database settings, schema or CRM data changed. | Confirmed Supabase organization plan and live advisor output. Reviewed all eight flagged function definitions for authentication and role checks. Leaked-password protection remains unavailable on the current Free plan; no permissions were revoked and no indexes or policies were removed. |
| 2026-11-06 | Added intrinsic dimensions to all dashboard profile photos so browsers can reserve their rendered 40/44/64px space before the image loads. No workflow or CRM data changed. | Dashboard ESLint, TypeScript and full production build pass; `git diff --check` passes. |
| 2026-11-06 | Scoped Turbopack to the app root so an unrelated parent `package-lock.json` cannot widen file watching or trigger a root-detection warning. Lead status remains compare-and-set in table/board actions, and stale detail edits are rejected and reloaded. No lead rows were changed. | Lint, TypeScript, production build (root warning gone), 12 focused workflow verifiers and read-only Supabase migration/data checks pass. Timeline round-trip used a temporary activity and removed it; activity count returned to 1,870. Vercel reported no runtime errors in the last hour. Live role-based UI could not be exercised because no CRM session was available. |
| 2026-11-06 | Removed an unused `status` field from the automation patch type. Automation currently changes assignments, follow-up dates and timeline notes only; status changes remain in explicit lead/appointment/transfer flows. No runtime behavior or CRM data changed. | Automation verifier, ESLint, TypeScript and `git diff --check` pass. |
| 2026-11-06 | Removed two unreferenced UI wrappers and unused direct `clsx`/`tailwind-merge` dependencies. Updated Next.js and `eslint-config-next` to patched 16.4.5, moved `shadcn` to dev dependencies, pinned `source-map-js` 1.2.2, and replaced the stale npm `xlsx` package with SheetJS's official 0.20.3 tarball. No CRM data, workflow or migration changed. | Reviewed unused-code candidates before removal. Lint, TypeScript, production build, lead-import, in-memory XLSX read/write, timeline and isolated CRM migration checks pass; `npm audit --omit=dev` reports 0 vulnerabilities. Full audit still reports 22 development-tool advisories; `--force` upgrades were not applied. Authenticated role-based browser workflows were not available to exercise. |
| 2026-11-06 | Added an accessible name to each lead's assignment selector and corrected the live status-save label punctuation; no workflow or layout change. | Full ESLint, TypeScript and production build pass. |
| 2026-11-06 | Reconciled local Supabase migration filenames and ordering with the applied project history; restored the recorded daily-work and assignment-creator index migration sources so a future CLI push does not mistake applied work for pending migrations. No live migration was run and no CRM data changed. | Exact local/live migration version and name comparison; isolated PostgreSQL migration and role/workflow checks pass. |
| 2026-11-06 | Aligned the local appointment-transition migration filename with its already-applied Supabase version after matching both live function definitions and grants; no database migration was rerun. | Live migration history records `20261105163805`; both RPCs match the repository SQL and deny `anon` execution. |
| 2026-11-06 | Harden lead creation, callback, assignment, duplicate-review and call-log Server Actions against malformed or null client inputs so invalid payloads return a clear error instead of crashing on array methods or `.trim()`. | Targeted lead workflow checks, strict TypeScript, ESLint, production build and the isolated transaction/RLS migration checks pass; production deployment is verified Ready. |
| 2026-11-05 | Validate lead search, create, status, detail-edit and activity Server Action inputs before trimming or saving, so malformed or stale clients return a readable error instead of a Server Components render exception. | Full lint, strict TypeScript, focused lead checks and production build pass; production runtime errors are checked after deployment. |
| 2026-11-05 | On ambiguous lead-edit or appointment-save responses, reload the RLS-scoped current row before showing the previous value; preserve the current status in the drawer while unrelated edits save. | Strict TypeScript, targeted and full lint, lead/appointment checks, isolated CRM migration and production build pass. Authenticated browser verification remains unavailable. |
| 2026-11-05 | Validated appointment Server Action inputs at runtime, restricted writes to the three appointment date columns, and required an authenticated user before updating a date. | Appointment assertions, strict TypeScript, targeted ESLint and production build pass. |
| 2026-11-05 | Harden Pipeline Board status moves: serialize concurrent moves, restore/re-read after rejected or interrupted saves, and disable move controls while saving. Added a visible keyboard focus state and removed unused board props. | Targeted ESLint, strict TypeScript, lead-filter and isolated CRM migration checks pass; production build passes. Live `verify:db` and trigger review confirm current migrations and no lead-data changes. |
| 2026-11-05 | Made the live database audit paginate beyond the API's 1,000-row limit, normalize phone duplicates, align treatment grouping with dashboard analytics, and emit privacy-safe aggregate output. | Full 1,679-lead audit completed with exact row-count cross-check; no missing phone/date values, unmatched owners, or normalized duplicate groups. Targeted ESLint and `git diff --check` pass; no database rows changed. |
| 2026-11-05 | Appointment completion and calendar edits now write old/new lead status and actor to the timeline atomically. | Isolated CRM migration verifier checks transition text and acting employee; live function grants/security checked and lead/activity counts unchanged. |
| 2026-11-05 | Made single-lead and detail-form admin reassignment atomic with assignment-batch creation; stale edits and rejected updates cannot leave orphan batches or partial lead edits. | Isolated PostgreSQL checks cover status/follow-up retention, Send as Fresh, stale-write rejection, rollback on lead-trigger failure, employee denial, invoker mode and grants. The live migration is applied; live function grants/security verified, lead/activity counts unchanged, `verify:db`, targeted lint, strict TypeScript and production build pass. |
| 2026-11-05 | Reconcile imported assignment-batch counts and rosters from rows actually inserted, including duplicate and partial-import paths. | Import mapping verifier and the new assignment-batch transaction checks pass; full lint, TypeScript and production build are re-run with this change. |
| 2026-11-05 | Made adding leads to an existing assignment batch atomic with its distribution and count update; stale leads or a failed target group leave the batch unchanged. | Isolated migration verification covers team-roster checks, status retention, duplicate-in-batch rejection, employee denial and rollback after a later group fails. Existing assignment dialog explains all-or-nothing behavior and blocks an empty team. |
| 2026-11-05 | Made selected, filtered and unassigned-lead bulk assignment atomic with batch creation, stale-filter guards, per-target distribution and optional Fresh reset. | Isolated migration verification covers success, status preservation/reset, stale unassigned selection rollback, failure on a later employee group, employee denial and grants. Strict TypeScript, lint and production build pass; live function definition, grants and migration version verified. |
| 2026-11-05 | Made assignment-batch transfer atomic across all leads and its roster; a failed update leaves ownership and history unchanged. | Isolated migration check covers Keep Current Status, Send as Fresh, employee denial, all-or-nothing rollback and function grants. Strict TypeScript, lint and production build pass; live RPC definition and grants verified. |
| 2026-11-05 | Record lead unassignments in the admin assignment history and distinguish assignment actions with compact, readable badges. | Isolated migration verification covers assign → transfer → unassign → assign and actor/previous-owner fields; targeted lint, strict TypeScript and production build pass. |
| 2026-11-05 | Tightened dashboard, shared button/tab/badge, search and switch transitions to animate only intended visual properties. Re-audited lead status compare-and-save and stale edit guards; no workflow or schema changes. | Analytics, lead filters, daily work, automation, calendar, appointments, attendance, team activity, Meta, lead import and isolated CRM migration checks pass. Strict TypeScript, lint and production build pass. Live migration and timeline round-trip checks pass; no runtime errors in the selected 24-hour Vercel window. |
| 2026-10-30 | Lead selection accumulates across pages; header select applies only to the current page. Note/Remarks and status edits refresh the row and timeline. Timeline entries include actor and time. | Webpack production build and lead-filter assertions pass. Live Supabase activity round-trip was verified and its temporary row removed. Targeted ESLint did not finish in the local environment. |
| 2026-10-30 | Hardened multi-page lead selection: IDs restore after same-scope remounts for 30 minutes in the current tab, scoped to the signed-in viewer and filters, and cleared when scope changes. Added an explicit “selected across pages” count. | Webpack production build, TypeScript check, lead-filter assertions and `git diff --check` pass. Targeted ESLint did not finish in the local environment; no lead rows or database schema changed. |
| 2026-10-30 | Removed repeated lead-drawer updates, kept transferred leads from reopening in the old assignee view, consolidated timeline refresh handling, and restored appointment/transfer controls after request failures. | Webpack production build, TypeScript, lead-filter, appointment and daily-work checks pass. Live browser verification is pending for this local change. |
| 2026-10-30 | Added Language disposition, clarified untouched assignment versus subsequent edits, and added an admin-only assignment history showing actor, destination and previous owner for newly recorded events. Historical events lack fields that were never recorded; lead deletion retains existing cleanup behaviour. | Isolated migration, filter, daily-work and release TypeScript checks pass; migration applied and Vercel GitHub check succeeded for commit 32b56e1. Live browser role-based smoke test remains pending. |
| 2026-10-30 | Renamed Language to Language Issue with legacy support, added employee appointment calendar and personal follow-up calendar, exposed appointment dates in lead details, and added admin capacity breakdown and planning estimate. | Filter, capacity, appointment, TypeScript, isolated migration/RLS checks and webpack production build pass. Migration `20261030124221` is applied without updating lead rows. Commit `2ea454b` is pushed; Vercel check succeeded. Live browser smoke test was unavailable in this session. |
| 2026-11-01 | Reduced Vercel work: activity heartbeat writes go directly through the authenticated, RLS-protected Supabase RPC every 60 seconds (kept below its 90-second duration-credit cap); roster reads, employee assignment-count fallback and duplicate-review polling run every two minutes; hidden Leads tabs skip duplicate polling. Proxy session refresh runs only on protected `/dashboard` routes. Employees can use Follow-ups for their RLS-scoped assigned leads, ordered by due date, with opt-in browser/sound reminders while the page is open. | Activity and daily-work checks, TypeScript, targeted ESLint and `git diff --check` pass. Full production build tracing has not been re-run for this change; the previous trace stalled after successful compile/static generation. Live Vercel CPU baseline is pending team authorization (403 for `aurevia2`). |
| 2026-11-02 | New records from imports, Meta, manual entry or other intake remain New/Fresh until a person works them, including while unassigned. Daily New also includes today's untouched unassigned intake; agent counts remain assignment-based. Admin/manager notes and edits now count as first touch. Imported closed labels wait for real CRM touch before the 7-day cleanup clock starts. | Migration `20261102073908` applied. Production build and TypeScript pass; rollback-only live SQL smoke check passed for unassigned intake, assignment without touch, admin first touch, and imported Lost cleanup timing. Existing lead count remained 1,438. |

When adding a feature later, append a row here and update the relevant behavior
contract and code-map entry in the same change.
