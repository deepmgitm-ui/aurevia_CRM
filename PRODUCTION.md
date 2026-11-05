# Aurevia CRM Production Guide

This file is the working production contract for the CRM. Update it whenever a
feature, permission, data rule, migration, environment variable, or release
procedure changes. Keep the implementation and this guide in the same change.

## Product and stack

- Clinic operations CRM built with Next.js 16, React 19, TypeScript and Supabase.
- Production hosting is Vercel. Optional CRM help uses Cloudflare Workers AI.
- The CRM UI is English. The help assistant can respond in English or Hinglish.
- Material UI alerts use the Next.js App Router cache provider alongside the
  existing Tailwind and Base UI components.
- Supabase is the source of truth for leads, assignments, activities, attendance,
  appointments, schedules and recovery snapshots.

## Core behavior contracts

### Leads and roles

- **Admin:** can review the whole team, assign or transfer leads, manage CRM
  settings, review deletions and use administrative lead operations.
- **Manager:** can review team leads and use the manager-enabled assignment and
  review tools. Admin-only operations stay admin-only.
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
- Detail forms reject saves when the lead has changed since the form opened;
  status changes compare the previously displayed status before writing.
- The supported status vocabulary is maintained in lib/lead-status.ts.
- Status changes must save through updateLeadStatus, update the visible row,
  preserve the existing role rules, and report a useful error if saving fails.
- Status changes made by appointment completion or calendar editing also write
  the old and new lead disposition to the lead timeline in the same database
  transaction, attributed to the signed-in user. Repeating an already-saved
  disposition does not create a duplicate transition entry.
- Language Issue is an active disposition with its own status card and filter;
  legacy Language values remain visible under the same status.
- Keep the distinction between **New Leads** (untouched assignments made today,
  plus untouched unassigned leads created today) and **Fresh Leads** (untouched
  leads after their intake/assignment day). New imported rows start untouched
  regardless of their source status or whether they have an assignee. Preserve
  the uploaded disposition as provenance until a CRM user changes that status.
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
