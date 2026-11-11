/* eslint-disable @typescript-eslint/no-require-imports -- Isolated verification runtime uses CommonJS. */
// Isolated PostgreSQL/WASM verification. Never connects to the live project.
const {
  PGlite,
} = require("../.crm-verification/node_modules/@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
let db;
(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create schema cron;create table cron.job(jobid bigint,jobname text);
create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
create function cron.unschedule(bigint) returns boolean language sql as $$select true$$;
create table auth.users(id uuid primary key);
insert into auth.users values
('00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000003');
create schema storage;create table storage.objects(metadata jsonb);
insert into storage.objects(metadata) values ('{"size":100}'::jsonb), ('{"size":250}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.profiles(id uuid primary key,name text,role text,phone text,email text,gender text,blood_group text,emergency_contact text,manager_name text,photo_url text);
insert into profiles values('00000000-0000-4000-8000-000000000001','Admin','admin'),('00000000-0000-4000-8000-000000000002','Agent A','employee'),('00000000-0000-4000-8000-000000000003','Agent B','employee');
create table public.attendance(id uuid primary key default gen_random_uuid(),employee_id uuid references public.profiles(id),attendance_date date not null,status text not null,marked_by uuid references public.profiles(id));
grant select,insert on public.attendance to authenticated;
-- calendar_events is created by the documented manual setup SQL, outside the
-- versioned migration chain. Seed its pre-hardening PUBLIC policies so later
-- policy migrations are replayed against the same shape as production.
create table public.calendar_events(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),event_date date not null,title text not null,kind text not null default 'note',notes text,created_at timestamptz not null default now());
alter table public.calendar_events enable row level security;
create policy calendar_events_select_own on public.calendar_events for select using(auth.uid()=owner_id);
create policy calendar_events_insert_own on public.calendar_events for insert with check(auth.uid()=owner_id);
create policy calendar_events_update_own on public.calendar_events for update using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
create policy calendar_events_delete_own on public.calendar_events for delete using(auth.uid()=owner_id);
grant select,insert,update,delete on public.calendar_events to anon,authenticated;
update profiles set phone='9999999999',email='admin@example.test',gender='Other',blood_group='O+',emergency_contact='8888888888',manager_name='Owner',photo_url='https://example.test/admin.png' where id='00000000-0000-4000-8000-000000000001';
create function public.handle_new_user() returns trigger language plpgsql security definer as $$begin return new;end$$;
create function public.rls_auto_enable() returns void language plpgsql security definer as $$begin return;end$$;
create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end$$;
create function public.current_user_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid()$$;
create type public.lead_temp as enum ('Hot','Warm','Cold');
create table public.leads(id uuid primary key default gen_random_uuid(),name text not null,phone text,email text,source text not null default 'Manual',status text not null default 'New',temperature public.lead_temp not null default 'Warm',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),gender text,city text,disease text,insurance_status text,remarks text,lead_date text,assigned_to text,follow_up_date text,opd_booked_date text,opd_done_date text,ipd_done_date text,assigned_at timestamptz,source_batch_id uuid,source_batch_label text,source_batch_created_at timestamptz);
create table public.lead_activities(id uuid primary key default gen_random_uuid(),lead_id uuid references public.leads on delete cascade,user_id uuid references public.profiles,action_type text,description text,created_at timestamptz default now());
create table public.lead_deletion_backups(id uuid primary key default gen_random_uuid(),deleted_by uuid,deleted_by_name text,scope text,search text,row_count integer not null default 0,activity_count integer not null default 0,lead_rows jsonb not null default '[]',activity_rows jsonb not null default '[]',restored_at timestamptz,created_at timestamptz default now());
create table public.crm_automation_rules(id uuid primary key default gen_random_uuid(),key text unique,label text,stage text,enabled boolean default true,last_run_at timestamptz,last_run_summary text);
create table public.crm_automation_runs(id uuid primary key default gen_random_uuid(),rule_key text,run_by uuid,run_by_name text,affected integer,detail jsonb default '[]',created_at timestamptz default now());
create function public.test_updated() returns trigger language plpgsql as $$begin new.updated_at:=clock_timestamp();return new;end$$;
create trigger leads_set_updated_at before update on leads for each row execute function public.test_updated();
alter table public.leads enable row level security;create policy fixture_lead_scope on public.leads for all to authenticated using(public.current_user_role() in('admin','manager') or assigned_to=(select name from public.profiles where id=auth.uid())) with check(public.current_user_role() in('admin','manager') or assigned_to=(select name from public.profiles where id=auth.uid()));
alter table public.lead_activities enable row level security;create policy fixture_activity_scope on public.lead_activities for all to authenticated using(public.current_user_role() in('admin','manager') or user_id=auth.uid()) with check(public.current_user_role() in('admin','manager') or user_id=auth.uid());
grant usage on schema public,auth to authenticated;grant select on profiles to authenticated;grant select,insert,update,delete on leads,lead_activities to authenticated;
insert into leads(name,phone,assigned_to,lead_date,opd_booked_date) values('Legacy fixture','9876543210','Agent A','10/10/2026','2026-10-12');
insert into leads(id,name,phone,source,status,assigned_to,assigned_at,created_at,updated_at)
values('00000000-0000-4000-8000-000000000101','Legacy untouched imported follow-up','9191000101','Excel/CSV','Follow-Up','Agent A','2026-10-12T05:00:00Z','2026-10-11T05:00:00Z','2026-10-12T05:00:00Z'),
      ('00000000-0000-4000-8000-000000000102','Legacy touched imported follow-up','9191000102','Excel/CSV','Follow-Up','Agent A','2026-10-12T05:00:00Z','2026-10-11T05:00:00Z','2026-10-12T05:00:00Z'),
      ('00000000-0000-4000-8000-000000000103','Legacy untouched imported closed','9191000103','Excel/CSV','Dropped','-','2026-10-11T05:00:00Z','2026-10-11T05:00:00Z','2026-10-11T05:00:00Z');
insert into lead_activities(lead_id,user_id,action_type,description,created_at)
values('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','note','Legacy user note','2026-10-13T05:00:00Z');
`);
  for (const file of fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(
      fs
        .readFileSync("supabase/migrations/" + file, "utf8")
        .replace(/-- CRON_SETUP_BEGIN[\s\S]*?-- CRON_SETUP_END/g, ""),
    );
    console.log("Migration syntax passed:", file);
    if (file === "20261022095339_agent_lead_buckets_and_deletion_reviews.sql") {
      await db.query(`insert into crm_lead_deletion_reviews
        (lead_id, closed_status, closed_since, delete_after)
        values('00000000-0000-4000-8000-000000000103','Dropped','2026-10-11T05:00:00Z','2026-10-18T05:00:00Z')`);
    }
  }
  const legacyUntouched = (await db.query(`select status, intake_status, assigned_to, workflow_bucket,
    assigned_fresh_since, first_agent_touch_at from leads
    where id='00000000-0000-4000-8000-000000000101'`)).rows[0];
  assert.equal(legacyUntouched.workflow_bucket, "fresh", "legacy imported disposition remains Fresh until CRM touch");
  assert.equal(legacyUntouched.status, "Follow-Up", "untouched legacy leads retain their source status");
  assert.equal(legacyUntouched.intake_status, "Follow-Up", "legacy intake status remains recorded");
  assert.equal(legacyUntouched.assigned_to, "Agent A", "legacy owner remains unchanged");
  assert.equal(legacyUntouched.assigned_fresh_since.toISOString(), "2026-10-12T05:00:00.000Z", "Fresh day uses the last known assignment date");
  assert.equal(legacyUntouched.first_agent_touch_at, null);
  const legacyTouched = (await db.query(`select status, workflow_bucket, first_agent_touch_at
    from leads where id='00000000-0000-4000-8000-000000000102'`)).rows[0];
  assert.equal(legacyTouched.workflow_bucket, "followup", "a recorded historical CRM interaction ends Fresh");
  assert.equal(legacyTouched.status, "Follow-Up", "historical touch reconstruction preserves disposition");
  assert.equal(legacyTouched.first_agent_touch_at.toISOString(), "2026-10-13T05:00:00.000Z");
  const legacyClosed = (await db.query(`select status, intake_status, workflow_bucket, closed_status_since,
    fresh_pending_since from leads where id='00000000-0000-4000-8000-000000000103'`)).rows[0];
  assert.equal(legacyClosed.workflow_bucket, "fresh", "untouched imported closed status does not enter cleanup");
  assert.equal(legacyClosed.status, "Dropped", "untouched imported closed leads retain their source status");
  assert.equal(legacyClosed.intake_status, "Dropped", "legacy closed status remains recorded at intake");
  assert.equal(legacyClosed.closed_status_since, null, "unworked imported closed status has no cleanup clock");
  assert.equal(legacyClosed.fresh_pending_since.toISOString(), "2026-10-11T05:00:00.000Z", "unassigned Fresh date uses intake date");
  assert.equal((await db.query("select count(*)::int as n from crm_lead_deletion_reviews where lead_id='00000000-0000-4000-8000-000000000103' and decision='pending'")).rows[0].n, 0,
    "an unworked imported closed status is removed from the pending cleanup queue");
  const sourceStatusLead = (await db.query(
    "insert into leads(name,phone,status,assigned_to) values('Source disposition fixture','9190000099','Not Interested','Agent A') returning id,status,intake_status,workflow_bucket,fresh_pending_since",
  )).rows[0];
  assert.equal(sourceStatusLead.status, "New", "all inserts start in the New disposition");
  assert.equal(sourceStatusLead.intake_status, "Not Interested", "the original source disposition remains visible");
  assert.equal(sourceStatusLead.workflow_bucket, "fresh", "the untouched lead enters the New workflow bucket");
  assert.ok(sourceStatusLead.fresh_pending_since, "the 24-hour clock starts when the lead is inserted");
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  await db.query("update leads set remarks='First callback attempt' where id=$1", [sourceStatusLead.id]);
  const remarkOnly = (await db.query("select status,intake_status,workflow_bucket,first_agent_touch_at,remarks_updated_at from leads where id=$1", [sourceStatusLead.id])).rows[0];
  assert.equal(remarkOnly.status, "New", "a remark does not replace the current disposition");
  assert.equal(remarkOnly.workflow_bucket, "fresh", "a remark alone leaves the lead untouched in its bucket");
  assert.equal(remarkOnly.first_agent_touch_at, null, "remarks do not count as first contact");
  assert.ok(remarkOnly.remarks_updated_at, "remark-only edits record a visible update timestamp");
  await db.exec("reset role;");
  await db.query("delete from leads where id=any($1::uuid[])", [[
    "00000000-0000-4000-8000-000000000101",
    "00000000-0000-4000-8000-000000000102",
    "00000000-0000-4000-8000-000000000103",
  ]]);
  const newIntake = (await db.query(`insert into leads(name, phone, status, source)
    values('New intake fixture', '9876500001', 'DNP', 'Excel/CSV')
    returning id, status, intake_status`)).rows[0];
  assert.equal(newIntake.status, "New", "database insertion rule starts every lead in the New disposition");
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [newIntake.id])).rows[0].workflow_bucket, "fresh",
    "a source disposition does not prevent a new lead from entering Fresh");
  assert.equal(newIntake.intake_status, "DNP", "database insertion rule retains the supplied intake status");
  const immutableIntake = (await db.query(`update leads set status='Follow-Up', intake_status='RNR'
    where id=$1 returning status, intake_status`, [newIntake.id])).rows[0];
  assert.equal(immutableIntake.status, "Follow-Up", "later CRM status changes remain editable");
  assert.equal(immutableIntake.intake_status, "DNP", "later edits cannot replace the intake status");
  assert.equal((await db.query("select workflow_bucket,first_agent_touch_at from leads where id=$1", [newIntake.id])).rows[0].workflow_bucket, "fresh",
    "a status-only change keeps an untouched lead Fresh");
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000001','Touch','Lead opened')", [newIntake.id]);
  const openedLead = (await db.query("select workflow_bucket,first_agent_touch_at from leads where id=$1", [newIntake.id])).rows[0];
  assert.equal(openedLead.workflow_bucket, "fresh", "a timeline note does not change the lead's Fresh workflow bucket");
  assert.equal(openedLead.first_agent_touch_at, null, "a timeline note without a disposition change does not mark a lead worked");
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1 and action_type='Touch'", [newIntake.id])).rows[0].n, 1,
    "opening a lead remains visible in its activity timeline");
  await db.query("delete from leads where id=$1", [newIntake.id]);

  const monthlyLeads = (await db.query(`insert into leads(name,phone,assigned_to,status)
    values ('Monthly OPD booked','9190000101','Agent A','New'),
           ('Monthly OPD completed','9190000102','Agent A','New'),
           ('Monthly IPD booked','9190000103','Agent A','New'),
           ('Monthly IPD completed','9190000104','Agent A','New'),
           ('Next month OPD booked','9190000105','Agent A','New')
    returning id`)).rows.map((row) => row.id);
  const monthlyAppointmentBaseline = (await db.query(
    "select crm_monthly_appointment_summary('Agent A') as summary",
  )).rows[0].summary;
  await db.query(`insert into crm_appointments(lead_id,kind,status,starts_on)
    values ($1,'opdBooked','booked',(now() at time zone 'Asia/Kolkata')::date),
           ($2,'opdBooked','completed',(now() at time zone 'Asia/Kolkata')::date),
           ($3,'ipdDone','booked',(now() at time zone 'Asia/Kolkata')::date),
           ($4,'ipdDone','completed',(now() at time zone 'Asia/Kolkata')::date),
           ($1,'opdBooked','booked',(date_trunc('month',now() at time zone 'Asia/Kolkata') - interval '1 month')::date),
           ($2,'opdBooked','completed',(date_trunc('month',now() at time zone 'Asia/Kolkata') - interval '1 month')::date),
           ($3,'ipdDone','booked',(date_trunc('month',now() at time zone 'Asia/Kolkata') - interval '1 month')::date),
           ($4,'ipdDone','completed',(date_trunc('month',now() at time zone 'Asia/Kolkata') - interval '1 month')::date),
           ($5,'opdBooked','booked',(date_trunc('month',now() at time zone 'Asia/Kolkata') + interval '1 month')::date)`,
    monthlyLeads,
  );
  await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const monthlyAppointmentResult = (await db.query(
    "select crm_monthly_appointment_summary('Agent A') as summary",
  )).rows[0].summary;
  assert.deepEqual({
    opdBooked: monthlyAppointmentResult.counts.opdBooked - monthlyAppointmentBaseline.counts.opdBooked,
    opdDone: monthlyAppointmentResult.counts.opdDone - monthlyAppointmentBaseline.counts.opdDone,
    ipdBooked: monthlyAppointmentResult.counts.ipdBooked - monthlyAppointmentBaseline.counts.ipdBooked,
    ipdDone: monthlyAppointmentResult.counts.ipdDone - monthlyAppointmentBaseline.counts.ipdDone,
  }, { opdBooked: 2, opdDone: 1, ipdBooked: 1, ipdDone: 1 },
  "appointment counts use the clinic calendar month and exclude the next month");
  assert.deepEqual({
    opdBooked: monthlyAppointmentResult.previousMonthCounts.opdBooked - monthlyAppointmentBaseline.previousMonthCounts.opdBooked,
    opdDone: monthlyAppointmentResult.previousMonthCounts.opdDone - monthlyAppointmentBaseline.previousMonthCounts.opdDone,
    ipdBooked: monthlyAppointmentResult.previousMonthCounts.ipdBooked - monthlyAppointmentBaseline.previousMonthCounts.ipdBooked,
    ipdDone: monthlyAppointmentResult.previousMonthCounts.ipdDone - monthlyAppointmentBaseline.previousMonthCounts.ipdDone,
  }, {
    opdBooked: 2, opdDone: 1, ipdBooked: 1, ipdDone: 1,
  }, "previous clinic month appointment counts remain available for the summary bar");
  const monthlyAgent = monthlyAppointmentResult.byAgent.find((row) => row.assignedTo === "Agent A");
  const baselineAgent = monthlyAppointmentBaseline.byAgent.find((row) => row.assignedTo === "Agent A") ?? {
    opdBooked: 0, opdDone: 0, ipdBooked: 0, ipdDone: 0,
  };
  assert.deepEqual({
    opdBooked: monthlyAgent.opdBooked - baselineAgent.opdBooked,
    opdDone: monthlyAgent.opdDone - baselineAgent.opdDone,
    ipdBooked: monthlyAgent.ipdBooked - baselineAgent.ipdBooked,
    ipdDone: monthlyAgent.ipdDone - baselineAgent.ipdDone,
  }, { opdBooked: 2, opdDone: 1, ipdBooked: 1, ipdDone: 1 },
  "each agent receives the same scoped monthly appointment counts");
  const expectedMonth = (await db.query(`select
    date_trunc('month',now() at time zone 'Asia/Kolkata')::date as month_start,
    (date_trunc('month',now() at time zone 'Asia/Kolkata') - interval '1 month')::date as previous_month_start,
    date_trunc('month',now() at time zone 'Asia/Kolkata')::date - 1 as previous_month_end,
    (date_trunc('month',now() at time zone 'Asia/Kolkata') + interval '1 month')::date - 1 as month_end`)).rows[0];
  assert.equal(monthlyAppointmentResult.period.from, expectedMonth.month_start.toISOString().slice(0, 10));
  assert.equal(monthlyAppointmentResult.period.to, expectedMonth.month_end.toISOString().slice(0, 10));
  assert.equal(monthlyAppointmentResult.previousPeriod.from, expectedMonth.previous_month_start.toISOString().slice(0, 10));
  assert.equal(monthlyAppointmentResult.previousPeriod.to, expectedMonth.previous_month_end.toISOString().slice(0, 10));
  await db.exec("reset role;");
  await db.query("delete from leads where id=any($1::uuid[])", [monthlyLeads]);

  const hardened = (await db.query(`select
    has_function_privilege('anon','public.handle_new_user()','execute') as anon_handle,
    has_function_privilege('anon','public.crm_existing_phone_identities(text[])','execute') as anon_phone_lookup,
    has_function_privilege('authenticated','public.crm_existing_phone_identities(text[])','execute') as auth_phone_lookup,
    has_function_privilege('authenticated','public.handle_new_user()','execute') as auth_handle,
    has_function_privilege('anon','public.rls_auto_enable()','execute') as anon_rls,
    has_function_privilege('authenticated','public.rls_auto_enable()','execute') as auth_rls,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.handle_new_user()'::regprocedure) as empty_handle_path,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.current_user_role()'::regprocedure) as empty_role_path,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.crm_scheduler_status()'::regprocedure) as empty_scheduler_path,
    (select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='public.set_updated_at()'::regprocedure) as pinned_updated_path,
    has_function_privilege('anon','public.crm_transfer_assignment_batch(uuid,text,boolean)','execute') as anon_batch_transfer,
    has_function_privilege('authenticated','public.crm_transfer_assignment_batch(uuid,text,boolean)','execute') as auth_batch_transfer,
    has_function_privilege('anon','public.crm_assign_leads_bulk(jsonb,text,boolean,boolean,uuid)','execute') as anon_bulk_assign,
    has_function_privilege('authenticated','public.crm_assign_leads_bulk(jsonb,text,boolean,boolean,uuid)','execute') as auth_bulk_assign,
    has_function_privilege('anon','public.crm_add_leads_to_assignment_batch(uuid,jsonb)','execute') as anon_batch_append,
    has_function_privilege('authenticated','public.crm_add_leads_to_assignment_batch(uuid,jsonb)','execute') as auth_batch_append,
    has_function_privilege('anon','public.crm_update_lead_details_admin(uuid,jsonb,timestamptz,boolean)','execute') as anon_admin_lead_edit,
    has_function_privilege('authenticated','public.crm_update_lead_details_admin(uuid,jsonb,timestamptz,boolean)','execute') as auth_admin_lead_edit,
    has_function_privilege('anon','public.crm_update_lead_details(uuid,jsonb,timestamptz)','execute') as anon_lead_detail_edit,
    has_function_privilege('authenticated','public.crm_update_lead_details(uuid,jsonb,timestamptz)','execute') as auth_lead_detail_edit,
    has_function_privilege('anon','public.crm_update_lead_appointment(uuid,text,text,timestamptz)','execute') as anon_lead_appointment_edit,
    has_function_privilege('authenticated','public.crm_update_lead_appointment(uuid,text,text,timestamptz)','execute') as auth_lead_appointment_edit,
    has_function_privilege('anon','public.crm_pipeline_insights(date)','execute') as anon_pipeline_insights,
    has_function_privilege('authenticated','public.crm_pipeline_insights(date)','execute') as auth_pipeline_insights,
    (select prosecdef=false from pg_proc where oid='public.crm_pipeline_insights(date)'::regprocedure) as invoker_pipeline_insights,
    has_function_privilege('anon','public.crm_change_lead_status(uuid,text,text)','execute') as anon_status_change,
    has_function_privilege('authenticated','public.crm_change_lead_status(uuid,text,text)','execute') as auth_status_change,
    (select prosecdef=false from pg_proc where oid='public.crm_change_lead_status(uuid,text,text)'::regprocedure) as invoker_status_change,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.crm_change_lead_status(uuid,text,text)'::regprocedure) as empty_status_change_path,
    (select prosecdef=false from pg_proc where oid='public.crm_update_lead_details_admin(uuid,jsonb,timestamptz,boolean)'::regprocedure) as invoker_admin_lead_edit,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.crm_update_lead_details_admin(uuid,jsonb,timestamptz,boolean)'::regprocedure) as empty_admin_lead_edit_path,
    (select prosecdef=false from pg_proc where oid='public.crm_update_lead_details(uuid,jsonb,timestamptz)'::regprocedure) as invoker_lead_detail_edit,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.crm_update_lead_details(uuid,jsonb,timestamptz)'::regprocedure) as empty_lead_detail_edit_path,
    (select prosecdef=false from pg_proc where oid='public.crm_update_lead_appointment(uuid,text,text,timestamptz)'::regprocedure) as invoker_lead_appointment_edit,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.crm_update_lead_appointment(uuid,text,text,timestamptz)'::regprocedure) as empty_lead_appointment_edit_path,
    exists(select 1 from pg_attribute where attrelid='public.leads'::regclass and attname='meta_leadgen_id' and not attisdropped) as has_meta_id
  `)).rows[0];
  assert.deepEqual(hardened, {
    anon_handle: false,
    anon_phone_lookup: false,
    auth_phone_lookup: true,
    auth_handle: false,
    anon_rls: false,
    auth_rls: false,
    empty_handle_path: true,
    empty_role_path: true,
    empty_scheduler_path: true,
    pinned_updated_path: true,
    anon_batch_transfer: false,
    auth_batch_transfer: true,
    anon_bulk_assign: false,
    auth_bulk_assign: true,
    anon_batch_append: false,
    auth_batch_append: true,
    anon_admin_lead_edit: false,
    auth_admin_lead_edit: true,
    anon_lead_detail_edit: false,
    auth_lead_detail_edit: true,
    anon_lead_appointment_edit: false,
    auth_lead_appointment_edit: true,
    anon_pipeline_insights: false,
    auth_pipeline_insights: true,
    invoker_pipeline_insights: true,
    anon_status_change: false,
    auth_status_change: true,
    invoker_status_change: true,
    empty_status_change_path: true,
    invoker_admin_lead_edit: true,
    empty_admin_lead_edit_path: true,
    invoker_lead_detail_edit: true,
    empty_lead_detail_edit_path: true,
    invoker_lead_appointment_edit: true,
    empty_lead_appointment_edit_path: true,
    has_meta_id: true,
  });
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const capacity = (await db.query("select public.crm_capacity_breakdown() as data")).rows[0].data;
  assert.equal(Number(capacity.storageBytes), 350, "all project object sizes are aggregated");
  assert.equal(Number(capacity.staff), 3);
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  await assert.rejects(db.query("select public.crm_capacity_breakdown()"), "employees cannot read admin capacity data");
  const privateProfileSchema = (await db.query(`select
    has_table_privilege('authenticated','public.employee_private_profiles','select') as can_select,
    has_table_privilege('authenticated','public.employee_private_profiles','insert') as can_insert,
    has_table_privilege('authenticated','public.employee_private_profiles','update') as can_update,
    has_table_privilege('authenticated','public.employee_private_profiles','delete') as can_delete,
    exists(select 1 from pg_attribute where attrelid='public.profiles'::regclass and attname='emergency_contact' and not attisdropped) as legacy_hr_exposed
  `)).rows[0];
  assert.deepEqual(privateProfileSchema, {
    can_select: true,
    can_insert: false,
    can_update: false,
    can_delete: false,
    legacy_hr_exposed: false,
  });
  await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`);
  assert.equal((await db.query("select count(*)::int n from employee_private_profiles")).rows[0].n, 1,
    "employee can read only their own private profile");
  await assert.rejects(db.query(`insert into employee_private_profiles(id) values('00000000-0000-4000-8000-000000000003')`));
  await db.query(`select update_my_employee_profile('Agent A','1111111111','agent-a@example.test',null,null,null,null)`);
  assert.equal((await db.query("select phone from employee_private_profiles where id=auth.uid()")).rows[0].phone, "1111111111",
    "employee can update their own private fields through the guarded RPC");
  await assert.rejects(db.query(`select admin_update_employee_profile('00000000-0000-4000-8000-000000000003','Agent B',null,null,null,null,null,null,null)`),
    "employees cannot use the administrative profile update RPC");
  await db.exec(`set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`);
  assert.deepEqual(
    (await db.query("select * from public.crm_existing_phone_identities(array['9876543210']::text[])" )).rows,
    [{ phone_identity: "9876543210" }],
    "admin can find an existing phone using the import-normalized identity",
  );
  await db.exec(`set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`);
  await assert.rejects(
    db.query("select * from public.crm_existing_phone_identities(array['9876543210']::text[])"),
    "employees cannot use the administrative import duplicate lookup",
  );
  await db.exec(`set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`);
  assert.equal((await db.query("select count(*)::int n from employee_private_profiles")).rows[0].n, 3,
    "admin can read the authorized staff directory");
  assert.equal((await db.query("select phone from employee_private_profiles where id='00000000-0000-4000-8000-000000000001'")).rows[0].phone, "9999999999",
    "migration copies existing private profile values before removing legacy columns");
  await db.query(`select admin_update_employee_profile('00000000-0000-4000-8000-000000000003','Agent B','2222222222','agent-b@example.test',null,null,null,'Manager',null)`);
  assert.equal((await db.query("select phone from employee_private_profiles where id='00000000-0000-4000-8000-000000000003'")).rows[0].phone, "2222222222",
    "admin can update another user's private profile through the guarded RPC");
  await db.exec("reset role");
  await db.query(`insert into public.leads(name,phone,meta_leadgen_id) values('Meta retry fixture','1111111111','meta-test-id')`);
  await assert.rejects(
    db.query(`insert into public.leads(name,phone,meta_leadgen_id) values('Meta duplicate fixture','2222222222','meta-test-id')`),
  );
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`,
  );
  let rows = (await db.query(`select * from public.crm_task_page('all','',1)`))
    .rows;
  assert.ok(rows.length);
  const id = (await db.query("select id from leads")).rows[0].id;
  await db.query(
    `select public.crm_log_call($1,'Connected','test','2026-10-13','09:30')`,
    [id],
  );
  assert.equal(
    (await db.query("select count(*)::int n from lead_activities")).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query("select follow_up_at from leads where id=$1", [id])
    ).rows[0].follow_up_at.toISOString(),
    "2026-10-13T04:00:00.000Z",
  );
  let denied = false;
  try {
    await db.query(`select public.crm_save_calendar_entry('{}')`);
  } catch {
    denied = true;
  }
  assert.equal(denied, true, "employees cannot create calendar entries");
  const ownDailyReport = (
    await db.query(`select public.crm_agent_daily_report('2026-10-12') x`)
  ).rows[0].x;
  assert.equal(ownDailyReport.length, 1, "employees only see their own daily report");
  assert.equal(ownDailyReport[0].id, "00000000-0000-4000-8000-000000000002");
  await db.exec(
    `reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;`,
  );
  const current = (
    await db.query("select updated_at::text from leads where id=$1", [id])
  ).rows[0].updated_at;
  const p = {
    mode: "existing",
    leadId: id,
    expectedUpdatedAt: current,
    kind: "opdBooked",
    date: "2026-10-15",
    name: "Legacy fixture",
    phone: "9876543210",
    city: "Test",
    remarks: "",
    appointmentStatus: "booked",
    time: "10:00",
    appointmentNotes: "Visit two",
    updateStatus: false,
  };
  const saved = (
    await db.query("select public.crm_save_calendar_entry($1::jsonb) x", [
      JSON.stringify(p),
    ])
  ).rows[0].x;
  assert.ok(saved.appointmentId);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from crm_appointments where lead_id=$1",
        [id],
      )
    ).rows[0].n,
    2,
  );
  denied = false;
  try {
    await db.query("select public.crm_save_calendar_entry($1::jsonb)", [
      JSON.stringify(p),
    ]);
  } catch {
    denied = true;
  }
  assert.equal(denied, true, "stale patient versions must be rejected");
  await db.query(`select public.crm_agent_daily_report('2026-10-12')`);

  // Managers retain normal lead-edit access, but assignment stays admin-only
  // at the database boundary even when a caller skips the server action.
  await db.exec("reset role;update profiles set role='manager' where id='00000000-0000-4000-8000-000000000003';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';set role authenticated;");
  await assert.rejects(
    db.query("update public.leads set assigned_to='Agent B' where id=$1", [id]),
    "managers cannot reassign leads through direct database updates",
  );
  assert.equal((await db.query("select assigned_to from public.leads where id=$1", [id])).rows[0].assigned_to, "Agent A");
  await db.query("update public.leads set status='DNP' where id=$1", [id]);
  assert.equal((await db.query("select status from public.leads where id=$1", [id])).rows[0].status, "DNP",
    "manager lead status edits remain available");
  await db.query("update public.leads set status='New' where id=$1", [id]);
  await db.exec("reset role;update profiles set role='employee' where id='00000000-0000-4000-8000-000000000003';");

  // Large data sets must remain exact beyond both the 500 and 1,000 row API caps.
  await db.exec("reset role");
  await db.exec(
    `insert into leads(name,phone,assigned_to,lead_date,follow_up_date,status,disease) select 'Scale '||n,(7000000000+n)::text,'Agent A','12/10/2026','2026-10-13','New','LASIK' from generate_series(1,1205) n;`,
  );
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`,
  );
  const task = (await db.query("select crm_task_page('all','Scale',1) x"))
    .rows[0].x;
  assert.equal(task.total, 1205);
  assert.equal(task.leads.length, 50);
  const page2 = (await db.query("select crm_task_page('all','Scale',2) x"))
    .rows[0].x;
  assert.equal(page2.leads.length, 50);
  assert.equal(
    new Set([...task.leads, ...page2.leads].map((l) => l.id)).size,
    100,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select sum(aggregate_count)::int n from crm_analytics_groups('2026-10-12','2026-10-12') where disease='LASIK'",
        )
      ).rows[0].n,
    ),
    1205,
  );
  await db.exec("reset role;set request.jwt.claim.sub='';");
  await assert.rejects(
    db.query("select crm_pipeline_insights('2026-10-13')"),
    /Authentication required/,
    "pipeline insights reject unauthenticated callers",
  );
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  const employeeInsights = (await db.query(
    "select crm_pipeline_insights('2026-10-13') x",
  )).rows[0].x;
  assert.equal(employeeInsights.total, (await db.query("select count(*)::int n from leads")).rows[0].n,
    "pipeline insights total follows the employee's RLS-visible lead scope");
  assert.equal(employeeInsights.byStatus.reduce((sum, row) => sum + Number(row.count), 0), employeeInsights.total,
    "pipeline status aggregates include every visible employee lead");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  const otherEmployeeInsights = (await db.query(
    "select crm_pipeline_insights('2026-10-13') x",
  )).rows[0].x;
  assert.equal(otherEmployeeInsights.total, 0,
    "pipeline insights do not expose another employee's leads");
  await db.exec("reset role;set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const adminInsights = (await db.query(
    "select crm_pipeline_insights('2026-10-13') x",
  )).rows[0].x;
  assert.equal(adminInsights.total, (await db.query("select count(*)::int n from leads")).rows[0].n,
    "admin pipeline insights include the full admin-visible lead scope");
  assert.equal(adminInsights.bySource.reduce((sum, row) => sum + Number(row.count), 0), adminInsights.total,
    "pipeline source aggregates include every visible admin lead");
  await db.exec("reset role;set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  let duplicateBlocked = false;
  try {
    await db.query(
      `insert into leads(name,phone,assigned_to) values('Duplicate','+91 98765 43210','Agent A')`,
    );
  } catch {
    duplicateBlocked = true;
  }
  assert.ok(duplicateBlocked, "normalized phones prevent duplicates");
  await db.exec(
    `set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';`,
  );
  assert.equal(
    (await db.query("select count(*)::int n from leads")).rows[0].n,
    0,
    "employee cannot read another agent leads",
  );
  await db.exec(
    `reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`,
  );
  await db.exec(
    `insert into crm_automation_rules(key,label,stage) values('welcome','Welcome','new');`,
  );
  await db.exec(
    `insert into leads(name,phone,status) select 'Unscheduled '||n,(8000000000+n)::text,'New' from generate_series(1,600) n;`,
  );
  await db.query("select crm_private.daily_automation()");
  assert.equal(
    (
      await db.query(
        "select affected from crm_automation_runs where rule_key='welcome'",
      )
    ).rows[0].affected,
    500,
    "daily batch bounded to 500",
  );
  await db.query("select crm_private.daily_automation()");
  assert.equal(
    (await db.query("select count(*)::int n from crm_automation_runs")).rows[0]
      .n,
    1,
    "daily execution idempotent",
  );
  await db.exec(
    `update crm_runtime_settings set automatic_enabled=false;update crm_automation_rules set last_run_at=null;`,
  );
  await db.query("select crm_private.daily_automation()");
  assert.equal(
    (await db.query("select count(*)::int n from crm_automation_runs")).rows[0]
      .n,
    1,
    "paused schedule does not mutate",
  );
  await db.exec(`set role authenticated;`);
  const today = (
    await db.query("select (now() at time zone 'Asia/Kolkata')::date::text d")
  ).rows[0].d;
  // Completing an owned appointment attributes the result to the actual actor.
  await db.query("update crm_appointments set starts_on=$1 where id=$2", [
    today,
    saved.appointmentId,
  ]);
  const bookedOpdIds = (await db.query("select id::text from crm_daily_lead_ids('opd',$1)", [today])).rows.map((row) => row.id);
  assert.ok(bookedOpdIds.includes(id), "OPD booking card opens the booked patient");
  const completedOpdIdsBefore = (await db.query("select id::text from crm_daily_lead_ids('opdDone',$1)", [today])).rows.map((row) => row.id);
  assert.ok(!completedOpdIdsBefore.includes(id), "booked OPD is not listed as completed");
  await db.exec(
    `set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`,
  );
  await db.query("select crm_change_appointment_status($1,'completed')", [
    saved.appointmentId,
  ]);
  const appointmentStatusActivity = (
    await db.query(
      "select user_id::text, description from lead_activities where lead_id=$1 and action_type='Status changed' order by created_at desc, id desc limit 1",
      [id],
    )
  ).rows[0];
  assert.equal(
    appointmentStatusActivity.description,
    "Patient: Legacy fixture · 9876543210 | New → OPD Done",
    "appointment completion records the exact lead status transition",
  );
  assert.equal(
    appointmentStatusActivity.user_id,
    "00000000-0000-4000-8000-000000000002",
    "appointment status transition records the acting employee",
  );
  const completedOpdIds = (await db.query("select id::text from crm_daily_lead_ids('opdDone',$1)", [today])).rows.map((row) => row.id);
  assert.ok(completedOpdIds.includes(id), "OPD completion card opens the completed patient");
  await db.exec(
    `set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`,
  );
  const report = (
    await db.query("select crm_agent_daily_report($1) x", [today])
  ).rows[0].x;
  assert.equal(
    Number(report.find((r) => r.name === "Agent A").opd_done),
    1,
    "completion credit follows event actor",
  );
  // IPD booking and completion remain distinct, including a same-day booking.
const ipdVersion=(await db.query('select updated_at::text from leads where id=$1',[id])).rows[0].updated_at;
const ipdPayload={...p,expectedUpdatedAt:ipdVersion,kind:'ipdDone',date:today,appointmentStatus:'booked',updateStatus:true};
const ipd=(await db.query('select crm_save_calendar_entry($1::jsonb) x',[JSON.stringify(ipdPayload)])).rows[0].x;
let daily=(await db.query('select crm_daily_work_counts($1) x',[today])).rows[0].x;
assert.equal(daily.ipd,1);assert.equal(daily.ipdDone,0,'booking is not IPD completion');
const bookedIpdIds=(await db.query("select id::text from crm_daily_lead_ids('ipd',$1)",[today])).rows.map((row)=>row.id);
assert.ok(bookedIpdIds.includes(id),'IPD booking card opens the booked patient');
const completedIpdIdsBefore=(await db.query("select id::text from crm_daily_lead_ids('ipdDone',$1)",[today])).rows.map((row)=>row.id);
assert.ok(!completedIpdIdsBefore.includes(id),'booked IPD is not listed as completed');
await db.query("select crm_change_appointment_status($1,'completed')",[ipd.appointmentId]);
daily=(await db.query('select crm_daily_work_counts($1) x',[today])).rows[0].x;assert.equal(daily.ipdDone,1);
const completedIpdIds=(await db.query("select id::text from crm_daily_lead_ids('ipdDone',$1)",[today])).rows.map((row)=>row.id);
assert.ok(completedIpdIds.includes(id),'IPD completion card opens the completed patient');
const ipdTransition=(await db.query("select description from lead_activities where lead_id=$1 and action_type='Status changed' order by created_at desc,id desc limit 1",[id])).rows[0].description;
assert.equal(ipdTransition,'Patient: Legacy fixture · 9876543210 | IPD Booked → IPD Done','calendar edits and completion both record status transitions');
// A recovered legacy duplicate can be merged only with fresh versions and phone confirmation.
  await db.exec(
    `reset role;alter table leads disable trigger crm_phone_guard;`,
  );
  const source = (
    await db.query(
      `insert into leads(name,phone,assigned_to) values('Legacy duplicate','9876543210','Agent A') returning id`,
    )
  ).rows[0].id;
  await db.exec(
    `alter table leads enable trigger crm_phone_guard;set role authenticated;`,
  );
  await db.query("insert into crm_appointments(lead_id,kind,status,starts_on) values($1,'opdBooked','booked',$2)",[source,today]);
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000002','note','Source history')",[source]);
  await assert.rejects(db.query("select crm_merge_leads($1,$2,null,null,null)",[id,source]),'confirmation and versions cannot be skipped');
  const versions = (
    await db.query(
      "select id,updated_at::text from leads where id=any($1::uuid[])",
      [[id, source]],
    )
  ).rows;
  const merged = (
    await db.query("select crm_merge_leads($1,$2,$3,$4,$5) x", [
      id,
      source,
      versions.find((r) => r.id === id).updated_at,
      versions.find((r) => r.id === source).updated_at,
      "9876543210",
    ])
  ).rows[0].x;
  assert.ok(merged.backupId);
  assert.equal((await db.query("select lead_id from lead_activities where description='Source history'")).rows[0].lead_id,id,'source notes move to retained patient');
  assert.ok((await db.query('select count(*)::int n from crm_appointments where lead_id=$1',[id])).rows[0].n>=4,'source visits are preserved');
  assert.equal((await db.query('select count(*)::int n from crm_appointment_events where lead_id=$1',[source])).rows[0].n,0,'event references follow retained patient');
  assert.equal(
    (await db.query("select count(*)::int n from crm_merge_history")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select count(*)::int n from leads where id=$1", [source]))
      .rows[0].n,
    0,
  );

  // Today's untouched assignments are New Today, become Follow-up on first
  // touch, and become Fresh only after the clinic-day boundary.
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const followUpA = (await db.query("insert into leads(name,phone,assigned_to,status,follow_up_date) values('Calendar A','9192222211','Agent A','Follow-Up','2026-10-25') returning id")).rows[0].id;
  const followUpB = (await db.query("insert into leads(name,phone,assigned_to,status,follow_up_date) values('Calendar B','9192222212','Agent B','Follow-Up','2026-10-25') returning id")).rows[0].id;
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  const visibleFollowUps = (await db.query("select id from leads where id=any($1::uuid[]) and follow_up_day='2026-10-25'", [[followUpA, followUpB]])).rows;
  assert.deepEqual(visibleFollowUps.map((row) => row.id), [followUpA], "employee follow-up calendar cannot read another agent's lead");
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  await db.query("delete from leads where id=any($1::uuid[])", [[followUpA, followUpB]]);
  const importedLeadId = (await db.query("insert into leads(name,phone,assigned_to,status) values('Untouched import','9192222299','-','DNP') returning id")).rows[0].id;
  await db.query("update leads set assigned_to='Agent A' where id=$1", [importedLeadId]);
  let importedLead = (await db.query("select status,intake_status,workflow_bucket,remarks_updated_at from leads where id=$1", [importedLeadId])).rows[0];
  assert.equal(importedLead.status, 'New', 'newly ingested leads always start in the New disposition');
  assert.equal(importedLead.intake_status, 'DNP', 'assignment preserves the supplied intake disposition');
  assert.equal(importedLead.workflow_bucket, 'fresh', 'assignment alone keeps the imported lead untouched');
  await db.query("update leads set remarks='First CRM update' where id=$1", [importedLeadId]);
  importedLead = (await db.query("select status,intake_status,workflow_bucket,remarks_updated_at from leads where id=$1", [importedLeadId])).rows[0];
  assert.equal(importedLead.status, 'New');
  assert.equal(importedLead.intake_status, 'DNP');
  assert.equal(importedLead.workflow_bucket, 'fresh', 'a remarks-only edit leaves the lead in its existing workflow bucket');
  assert.ok(importedLead.remarks_updated_at, 'a remarks-only edit records a dedicated timestamp for the lead card');
  const remarkUpdatedAt = importedLead.remarks_updated_at;
  await db.query("update leads set city='Mumbai' where id=$1", [importedLeadId]);
  assert.equal(new Date((await db.query("select remarks_updated_at from leads where id=$1", [importedLeadId])).rows[0].remarks_updated_at).toISOString(), new Date(remarkUpdatedAt).toISOString(),
    'editing another detail does not rewrite the remark timestamp');
  await db.query("delete from leads where id=$1", [importedLeadId]);
  const concurrentLead = (await db.query("insert into leads(name,phone,assigned_to,status) values('Concurrent edit','9192222298','Agent A','New') returning id,updated_at::text")).rows[0];
  await db.query("update leads set status='DNP' where id=$1", [concurrentLead.id]);
  const staleEdit = await db.query("update leads set remarks='Stale note',assigned_to='Agent B' where id=$1 and updated_at=$2::timestamptz returning id", [concurrentLead.id, concurrentLead.updated_at]);
  assert.equal(staleEdit.rows.length, 0, 'an old form version cannot overwrite a newer lead');
  const staleStatus = await db.query("update leads set status='Follow-Up' where id=$1 and status='New' returning id", [concurrentLead.id]);
  assert.equal(staleStatus.rows.length, 0, 'an old status cannot replace a newer disposition');
  const currentLead = (await db.query("select status,assigned_to from leads where id=$1", [concurrentLead.id])).rows[0];
  assert.equal(currentLead.status, 'DNP');
  assert.equal(currentLead.assigned_to, 'Agent A');
  await db.query("delete from leads where id=$1", [concurrentLead.id]);
  const newAssignmentId = (await db.query(
    "insert into leads(name,phone,assigned_to,status) values('New assignment check','9192222200','-','New') returning id",
  )).rows[0].id;
  await db.query("update leads set assigned_to='Agent A' where id=$1", [newAssignmentId]);
  let assignmentEvent = (await db.query("select assigned_to, previous_assigned_to, event_kind, actor_id from crm_assignment_events where lead_id=$1 order by id desc limit 1", [newAssignmentId])).rows[0];
  assert.equal(assignmentEvent.assigned_to, "Agent A");
  assert.equal(assignmentEvent.previous_assigned_to, null);
  assert.equal(assignmentEvent.event_kind, "assignment");
  assert.equal(assignmentEvent.actor_id, "00000000-0000-4000-8000-000000000001");
  let assignmentState = (await db.query("select workflow_bucket, first_agent_touch_at from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(assignmentState.workflow_bucket, "fresh", "assignment alone keeps an untouched lead New Today");
  assert.equal(assignmentState.first_agent_touch_at, null);
  const beforeAdminEdit = Number((await db.query("select crm_daily_work_counts((now() at time zone 'Asia/Kolkata')::date) x")).rows[0].x.assigned);
  await db.query("update leads set status='Language' where id=$1", [newAssignmentId]);
  assignmentState = (await db.query("select workflow_bucket, first_agent_touch_at, assigned_fresh_since, fresh_pending_since, imported_status from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(assignmentState.workflow_bucket, "followup", "a status update moves an untouched lead into its disposition bucket");
  assert.ok(assignmentState.first_agent_touch_at);
  await db.query("update leads set remarks='Admin worked this lead' where id=$1", [newAssignmentId]);
  assignmentState = (await db.query("select workflow_bucket, first_agent_touch_at from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(assignmentState.workflow_bucket, "followup", "a real admin edit moves the lead out of Fresh");
  assert.ok(assignmentState.first_agent_touch_at);
  const afterAdminEdit = Number((await db.query("select crm_daily_work_counts((now() at time zone 'Asia/Kolkata')::date) x")).rows[0].x.assigned);
  assert.equal(beforeAdminEdit - afterAdminEdit, 1, "daily New count matches the actual first work event");
  await db.query("update leads set assigned_to='Agent B',status='New',first_agent_touch_at=null where id=$1", [newAssignmentId]);
  assignmentEvent = (await db.query("select assigned_to, previous_assigned_to, event_kind, actor_id from crm_assignment_events where lead_id=$1 order by id desc limit 1", [newAssignmentId])).rows[0];
  assert.equal(assignmentEvent.previous_assigned_to, "Agent A");
  assert.equal(assignmentEvent.assigned_to, "Agent B");
  assert.equal(assignmentEvent.event_kind, "transfer");
  assert.equal(assignmentEvent.actor_id, "00000000-0000-4000-8000-000000000001");
  await db.query("update leads set assigned_to='-' where id=$1", [newAssignmentId]);
  assignmentEvent = (await db.query("select assigned_to, previous_assigned_to, event_kind, actor_id from crm_assignment_events where lead_id=$1 order by id desc limit 1", [newAssignmentId])).rows[0];
  assert.equal(assignmentEvent.assigned_to, "Unassigned");
  assert.equal(assignmentEvent.previous_assigned_to, "Agent B");
  assert.equal(assignmentEvent.event_kind, "unassignment");
  assert.equal(assignmentEvent.actor_id, "00000000-0000-4000-8000-000000000001");
  await db.query("update leads set assigned_to='Agent B' where id=$1", [newAssignmentId]);
  assignmentEvent = (await db.query("select assigned_to, previous_assigned_to, event_kind, actor_id from crm_assignment_events where lead_id=$1 order by id desc limit 1", [newAssignmentId])).rows[0];
  assert.equal(assignmentEvent.assigned_to, "Agent B");
  assert.equal(assignmentEvent.previous_assigned_to, null);
  assert.equal(assignmentEvent.event_kind, "assignment");
  assert.equal(assignmentEvent.actor_id, "00000000-0000-4000-8000-000000000001");
  assignmentState = (await db.query("select workflow_bucket, first_agent_touch_at from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(assignmentState.workflow_bucket, "fresh", "fresh transfer stays fresh for the receiving agent");
  assert.equal(assignmentState.first_agent_touch_at, null);
  await db.exec("reset role;insert into profiles(id,name,role) values ('00000000-0000-4000-8000-000000000004','Manager','manager');");
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  await db.query("update leads set status='RNR' where id=$1", [newAssignmentId]);
  let employeeStatus = (await db.query("select status,workflow_bucket,first_agent_touch_at from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(employeeStatus.status, "RNR", "assigned employee can save a disposition through lead RLS");
  assert.equal(employeeStatus.workflow_bucket, "followup", "employee disposition change moves the lead out of New/Fresh");
  assert.ok(employeeStatus.first_agent_touch_at, "a disposition change records the first agent touch");
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000003','Status changed','New → RNR')", [newAssignmentId]);
  assert.equal((await db.query("select status from leads where id=$1", [newAssignmentId])).rows[0].status, "RNR", "status timeline activity does not revert the disposition");
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [newAssignmentId])).rows[0].workflow_bucket, "followup", "status timeline activity does not revert the disposition bucket");
  await db.query("update leads set remarks='Agent B note' where id=$1", [newAssignmentId]);
  employeeStatus = (await db.query("select status,workflow_bucket from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(employeeStatus.status, "RNR", "a later employee remarks edit does not revert the saved disposition");
  assert.equal(employeeStatus.workflow_bucket, "followup", "receiving agent's edit removes the lead from New Today");
  const staleEmployeeStatus = await db.query("update leads set status='New' where id=$1 and status='New' returning id", [newAssignmentId]);
  assert.equal(staleEmployeeStatus.rows.length, 0, "a stale employee status cannot replace the saved disposition");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  await db.query("update leads set status='Language Issue' where id=$1", [newAssignmentId]);
  assert.equal((await db.query("select status from leads where id=$1", [newAssignmentId])).rows[0].status, "Language Issue", "admin can save dispositions through lead RLS");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';");
  await db.query("update leads set status='DNP' where id=$1", [newAssignmentId]);
  assert.equal((await db.query("select status from leads where id=$1", [newAssignmentId])).rows[0].status, "DNP", "manager can save dispositions through lead RLS");
  await db.query("update leads set remarks='Manager verified' where id=$1", [newAssignmentId]);
  assert.equal((await db.query("select status from leads where id=$1", [newAssignmentId])).rows[0].status, "DNP", "a later manager edit preserves the saved disposition");
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  await db.query("update leads set status='DNP' where id=$1", [newAssignmentId]);
  await db.query("update leads set assigned_to='Agent A' where id=$1", [newAssignmentId]);
  const keptStatus = (await db.query("select assigned_to,status,first_agent_touch_at from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(keptStatus.assigned_to, 'Agent A');
  assert.equal(keptStatus.status, 'DNP', 'transfer without fresh keeps the disposition');
  assert.ok(keptStatus.first_agent_touch_at, 'transfer preserves the earlier touch');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1 and action_type='Transfer'", [newAssignmentId])).rows[0].n, 3, 'transfer, unassignment, and reassignment retain history');
  await db.query("delete from leads where id=$1", [newAssignmentId]);

  const keepBatchId = (await db.query(
    "insert into crm_assignment_batches(label,created_by,created_by_name,target_names,lead_count) values('Keep status transfer',auth.uid(),'Admin',array['Agent A'],2) returning id",
  )).rows[0].id;
  const keepBatchLeads = (await db.query(
    "insert into leads(name,phone,assigned_to,status,assignment_batch_id) values('Keep status DNP','9192222281','Agent A','New',$1),('Keep status OPD','9192222282','Agent A','New',$1) returning id,status",
    [keepBatchId],
  )).rows;
  await db.query("update leads set status=case when id=$1 then 'DNP' else 'OPD Booked' end where id=any($2::uuid[])", [keepBatchLeads[0].id, keepBatchLeads.map((lead) => lead.id)]);
  await db.exec("set role authenticated;");
  const keepTransfer = (await db.query(
    "select public.crm_transfer_assignment_batch($1,'Agent B',false) as transferred",
    [keepBatchId],
  )).rows[0].transferred;
  assert.equal(Number(keepTransfer), 2, "batch transfer moves all matching leads in one operation");
  assert.deepEqual(
    (await db.query("select assigned_to,status from leads where id=any($1::uuid[]) order by name", [keepBatchLeads.map((lead) => lead.id)])).rows,
    [{ assigned_to: "Agent B", status: "DNP" }, { assigned_to: "Agent B", status: "OPD Booked" }],
    "Keep Current Status preserves each disposition during batch transfer",
  );
  assert.deepEqual((await db.query("select target_names from crm_assignment_batches where id=$1", [keepBatchId])).rows[0].target_names, ["Agent B"]);
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  await assert.rejects(
    db.query("select public.crm_transfer_assignment_batch($1,'Agent A',false)", [keepBatchId]),
    "employees cannot transfer assignment batches",
  );
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;");
  assert.equal((await db.query("select assigned_to from leads where id=$1", [keepBatchLeads[0].id])).rows[0].assigned_to, "Agent B",
    "denied employee transfer leaves the owner unchanged");

  const freshBatchId = (await db.query(
    "insert into crm_assignment_batches(label,created_by,created_by_name,target_names,lead_count) values('Fresh transfer',auth.uid(),'Admin',array['Agent A'],1) returning id",
  )).rows[0].id;
  const freshBatchLeadId = (await db.query(
    "insert into leads(name,phone,assigned_to,status,follow_up_date,assignment_batch_id,first_agent_touch_at) values('Fresh transfer lead','9192222283','Agent A','DNP','2026-11-06',$1,now()) returning id",
    [freshBatchId],
  )).rows[0].id;
  await db.query("update leads set status='DNP' where id=$1", [freshBatchLeadId]);
  await db.query("update leads set first_agent_touch_at=now() where id=$1", [freshBatchLeadId]);
  assert.equal(Number((await db.query(
    "select public.crm_transfer_assignment_batch($1,'Agent B',true) as transferred",
    [freshBatchId],
  )).rows[0].transferred), 1);
  const freshBatchLead = (await db.query("select assigned_to,status,follow_up_date,first_agent_touch_at from leads where id=$1", [freshBatchLeadId])).rows[0];
  assert.equal(freshBatchLead.assigned_to, "Agent B");
  assert.equal(freshBatchLead.status, "New", "Send as Fresh deliberately resets the disposition");
  assert.equal(freshBatchLead.follow_up_date, "-");
  assert.equal(freshBatchLead.first_agent_touch_at, null);
  assert.deepEqual((await db.query(
    "select action_type,description from lead_activities where lead_id=$1 order by created_at,id",
    [freshBatchLeadId],
  )).rows, [{
    action_type: "Transfer",
    description: "Transferred from Agent A to Agent B. Previous notes and call history are retained. Disposition: DNP → New (sent as fresh).",
  }], "fresh batch transfer records its old and new disposition in the transfer timeline receipt");
  assert.deepEqual((await db.query("select target_names from crm_assignment_batches where id=$1", [freshBatchId])).rows[0].target_names, ["Agent B"]);

  // Keep assignment and Fresh transfer in one SQL transaction. `now()` is
  // stable inside it, so the old and reset assignment markers can be equal.
  await db.exec("begin;");
  const sameTransactionBatchId = (await db.query(
    "insert into crm_assignment_batches(label,created_by,created_by_name,target_names,lead_count) values('Same transaction fresh transfer',auth.uid(),'Admin',array['Agent A'],1) returning id",
  )).rows[0].id;
  const sameTransactionLeadId = (await db.query(
    "insert into leads(name,phone,assigned_to,status,assignment_batch_id) values('Same transaction fresh transfer lead','9192222286','Agent A','DNP',$1) returning id",
    [sameTransactionBatchId],
  )).rows[0].id;
  await db.query("update leads set status='DNP' where id=$1", [sameTransactionLeadId]);
  assert.equal(Number((await db.query(
    "select public.crm_transfer_assignment_batch($1,'Agent B',true) as transferred",
    [sameTransactionBatchId],
  )).rows[0].transferred), 1);
  assert.deepEqual((await db.query(
    "select status,first_agent_touch_at from leads where id=$1",
    [sameTransactionLeadId],
  )).rows[0], { status: "New", first_agent_touch_at: null });
  assert.deepEqual((await db.query(
    "select action_type,description from lead_activities where lead_id=$1",
    [sameTransactionLeadId],
  )).rows, [{
    action_type: "Transfer",
    description: "Transferred from Agent A to Agent B. Previous notes and call history are retained. Disposition: DNP → New (sent as fresh).",
  }], "Fresh transfer receipt is recorded even when now() returns the same transaction timestamp");
  await db.exec("rollback;");

  const atomicBatchId = (await db.query(
    "insert into crm_assignment_batches(label,created_by,created_by_name,target_names,lead_count) values('Atomic transfer',auth.uid(),'Admin',array['Agent A'],2) returning id",
  )).rows[0].id;
  const atomicLeadIds = (await db.query(
    "insert into leads(name,phone,assigned_to,status,assignment_batch_id) values('Batch allowed','9192222284','Agent A','New',$1),('Batch blocked','9192222285','Agent A','DNP',$1) returning id",
    [atomicBatchId],
  )).rows.map((lead) => lead.id);
  const atomicHistoryBefore = (await db.query(
    "select count(*)::int n from crm_assignment_events where lead_id=any($1::uuid[])", [atomicLeadIds],
  )).rows[0].n;
  await db.exec(`reset role;
    create function public.fixture_block_batch_transfer() returns trigger language plpgsql as $$
    begin
      if new.name = 'Batch blocked' and new.assigned_to = 'Agent B' then raise exception 'fixture blocks the second lead'; end if;
      return new;
    end;$$;
    create trigger fixture_block_batch_transfer before update of assigned_to on public.leads
    for each row execute function public.fixture_block_batch_transfer();
    set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;`);
  await assert.rejects(
    db.query("select public.crm_transfer_assignment_batch($1,'Agent B',false)", [atomicBatchId]),
    "a failed row rolls back the complete batch transfer",
  );
  assert.deepEqual(
    (await db.query("select assigned_to from leads where id=any($1::uuid[]) order by name", [atomicLeadIds])).rows,
    [{ assigned_to: "Agent A" }, { assigned_to: "Agent A" }],
    "failed batch transfer leaves every lead with its original owner",
  );
  assert.deepEqual((await db.query("select target_names from crm_assignment_batches where id=$1", [atomicBatchId])).rows[0].target_names, ["Agent A"]);
  assert.equal((await db.query("select count(*)::int n from crm_assignment_events where lead_id=any($1::uuid[])", [atomicLeadIds])).rows[0].n, atomicHistoryBefore,
    "failed batch transfer leaves no partial assignment history");
  await db.exec("reset role;drop trigger fixture_block_batch_transfer on public.leads;drop function public.fixture_block_batch_transfer();");
  await db.query("delete from leads where id=any($1::uuid[])", [[...keepBatchLeads.map((lead) => lead.id), freshBatchLeadId, ...atomicLeadIds]]);
  await db.query("delete from crm_assignment_batches where id=any($1::uuid[])", [[keepBatchId, freshBatchId, atomicBatchId]]);

  const bulkLeads = (await db.query(
    "insert into leads(name,phone,assigned_to,status) values('Bulk DNP','9192222290','-','New'),('Bulk New','9192222291','-','New') returning id,name,status",
  )).rows;
  await db.query("update leads set status='DNP' where id=$1", [bulkLeads.find((lead) => lead.name === "Bulk DNP").id]);
  const bulkResult = (await db.query(
    "select public.crm_assign_leads_bulk($1::jsonb,'Bulk assignment',false,true,null) as result",
    [JSON.stringify(bulkLeads.map((lead) => ({ id: lead.id, name: 'Agent A' })))],
  )).rows[0].result;
  assert.equal(Number(bulkResult.assigned), 2, "bulk RPC assigns the full selected set atomically");
  assert.deepEqual(bulkResult.perEmployee, [{ name: "Agent A", count: 2 }]);
  const bulkBatchId = bulkResult.batchId;
  assert.deepEqual(
    (await db.query("select assigned_to,status from leads where id=any($1::uuid[]) order by name", [bulkLeads.map((lead) => lead.id)])).rows,
    [{ assigned_to: "Agent A", status: "DNP" }, { assigned_to: "Agent A", status: "New" }],
    "keep-status bulk assignment preserves each lead disposition",
  );
  assert.deepEqual((await db.query("select target_names,lead_count from crm_assignment_batches where id=$1", [bulkBatchId])).rows[0],
    { target_names: ["Agent A"], lead_count: 2 });

  const freshLeadId = (await db.query(
    "insert into leads(name,phone,assigned_to,status,follow_up_date,first_agent_touch_at) values('Bulk Fresh','9192222292','-','New','2026-11-06',now()) returning id",
  )).rows[0].id;
  await db.query("update leads set status='DNP' where id=$1", [freshLeadId]);
  const freshResult = (await db.query(
    "select public.crm_assign_leads_bulk($1::jsonb,'Fresh bulk',true,true,null) as result",
    [JSON.stringify([{ id: freshLeadId, name: "Agent B" }])],
  )).rows[0].result;
  assert.equal(Number(freshResult.assigned), 1);
  assert.deepEqual((await db.query("select assigned_to,status,follow_up_date,first_agent_touch_at from leads where id=$1", [freshLeadId])).rows[0],
    { assigned_to: "Agent B", status: "New", follow_up_date: "-", first_agent_touch_at: null },
    "Send as Fresh deliberately resets disposition and touch state");
  assert.deepEqual((await db.query(
    "select action_type,description from lead_activities where lead_id=$1 order by created_at,id",
    [freshLeadId],
  )).rows, [{ action_type: "Assignment", description: "Assigned to Agent B. Disposition: DNP → New (sent as fresh)." }],
    "fresh assignment from unassigned records its old and new disposition");

  const guardedLeadId = (await db.query(
    "insert into leads(name,phone,assigned_to,status) values('Bulk guard','9192222293','Agent B','New') returning id",
  )).rows[0].id;
  const batchCountBeforeStale = (await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n;
  await assert.rejects(db.query(
    "select public.crm_assign_leads_bulk($1::jsonb,'Stale bulk',false,true,null)",
    [JSON.stringify([{ id: guardedLeadId, name: "Agent A" }])],
  ), "a stale unassigned selection is rejected");
  assert.equal((await db.query("select assigned_to from leads where id=$1", [guardedLeadId])).rows[0].assigned_to, "Agent B",
    "stale bulk assignment leaves the current owner unchanged");
  assert.equal((await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n, batchCountBeforeStale,
    "stale bulk assignment does not leave an empty batch");

  const rollbackLeads = (await db.query(
    "insert into leads(name,phone,assigned_to,status) values('Bulk allowed','9192222294','-','New'),('Bulk blocked','9192222295','-','New') returning id,name",
  )).rows;
  await db.query("update leads set status='DNP' where id=$1", [rollbackLeads.find((lead) => lead.name === "Bulk blocked").id]);
  const batchCountBeforeFailure = (await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n;
  await db.exec(`reset role;
    create function public.fixture_block_bulk_assignment() returns trigger language plpgsql as $$
    begin
      if new.name = 'Bulk blocked' and new.assigned_to = 'Agent B' then raise exception 'fixture blocks second assignment group'; end if;
      return new;
    end;$$;
    create trigger fixture_block_bulk_assignment before update of assigned_to on public.leads
    for each row execute function public.fixture_block_bulk_assignment();
    set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;`);
  await assert.rejects(db.query(
    "select public.crm_assign_leads_bulk($1::jsonb,'Rollback bulk',false,false,null)",
    [JSON.stringify(rollbackLeads.map((lead) => ({ id: lead.id, name: lead.name === 'Bulk allowed' ? 'Agent A' : 'Agent B' })))],
  ), "a failed target group rolls back the entire bulk assignment");
  assert.deepEqual((await db.query("select assigned_to from leads where id=any($1::uuid[]) order by name", [rollbackLeads.map((lead) => lead.id)])).rows,
    [{ assigned_to: "-" }, { assigned_to: "-" }], "failed bulk assignment leaves all lead owners unchanged");
  assert.equal((await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n, batchCountBeforeFailure,
    "failed bulk assignment removes its batch row transactionally");
  await db.exec("reset role;drop trigger fixture_block_bulk_assignment on public.leads;drop function public.fixture_block_bulk_assignment();");
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  await assert.rejects(db.query(
    "select public.crm_assign_leads_bulk($1::jsonb,'Denied bulk',false,false,null)",
    [JSON.stringify([{ id: freshLeadId, name: "Agent A" }])],
  ), "employees cannot invoke admin bulk assignment");
  await db.exec("reset role;");
  await db.query("delete from leads where id=any($1::uuid[])", [[...bulkLeads.map((lead) => lead.id), freshLeadId, guardedLeadId, ...rollbackLeads.map((lead) => lead.id)]]);
  await db.query("delete from crm_assignment_batches where id=$1", [bulkBatchId]);
  await db.query("delete from crm_assignment_batches where label='Fresh bulk'");

  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;");
  const appendBatchId = (await db.query(
    "insert into crm_assignment_batches(label,created_by,created_by_name,target_names,lead_count) values('Append fixture',auth.uid(),'Admin',array['Agent A','Agent B'],1) returning id",
  )).rows[0].id;
  const originalBatchLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,assignment_batch_id) values('Append original','9192222300','Agent A','DNP',$1) returning id",
    [appendBatchId],
  )).rows[0].id;
  const appendLeads = (await db.query(
    "insert into leads(name,phone,assigned_to,status) values('Append A','9192222301','-','New'),('Append B','9192222302','-','New') returning id,name,status",
  )).rows;
  await db.query("update leads set status=case when id=$1 then 'Follow-Up' else 'OPD Booked' end where id=any($2::uuid[])", [appendLeads[0].id, appendLeads.map((lead) => lead.id)]);
  const appendResult = (await db.query(
    "select public.crm_add_leads_to_assignment_batch($1,$2::jsonb) as result",
    [appendBatchId, JSON.stringify(appendLeads.map((lead,index) => ({ id: lead.id, name: index === 0 ? 'Agent A' : 'Agent B' })))],
  )).rows[0].result;
  assert.equal(Number(appendResult.added), 2, "existing batch append adds every selected lead");
  assert.deepEqual(appendResult.perEmployee, [{ name: "Agent A", count: 1 }, { name: "Agent B", count: 1 }]);
  assert.deepEqual((await db.query("select assigned_to,status,assignment_batch_id from leads where id=any($1::uuid[]) order by name", [appendLeads.map((lead) => lead.id)])).rows,
    [{ assigned_to: "Agent A", status: "Follow-Up", assignment_batch_id: appendBatchId }, { assigned_to: "Agent B", status: "OPD Booked", assignment_batch_id: appendBatchId }],
    "batch append preserves lead statuses and distributes to the current roster");
  assert.equal((await db.query("select lead_count from crm_assignment_batches where id=$1", [appendBatchId])).rows[0].lead_count, 3,
    "batch count increments in the same transaction as appended leads");

  const appendCountBeforeStale = (await db.query("select lead_count from crm_assignment_batches where id=$1", [appendBatchId])).rows[0].lead_count;
  await assert.rejects(db.query(
    "select public.crm_add_leads_to_assignment_batch($1,$2::jsonb)",
    [appendBatchId, JSON.stringify([{ id: originalBatchLead, name: "Agent A" }])],
  ), "a lead already in the batch cannot be appended twice");
  assert.equal((await db.query("select lead_count from crm_assignment_batches where id=$1", [appendBatchId])).rows[0].lead_count, appendCountBeforeStale,
    "rejected batch append leaves the batch count unchanged");

  const appendRollbackLeads = (await db.query(
    "insert into leads(name,phone,assigned_to,status) values('Append allowed','9192222303','-','New'),('Append blocked','9192222304','-','DNP') returning id,name",
  )).rows;
  await db.exec(`reset role;
    create function public.fixture_block_batch_append() returns trigger language plpgsql as $$
    begin
      if new.name = 'Append blocked' and new.assigned_to = 'Agent B' then raise exception 'fixture blocks the second append target'; end if;
      return new;
    end;$$;
    create trigger fixture_block_batch_append before update of assigned_to on public.leads
    for each row execute function public.fixture_block_batch_append();
    set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;`);
  await assert.rejects(db.query(
    "select public.crm_add_leads_to_assignment_batch($1,$2::jsonb)",
    [appendBatchId, JSON.stringify(appendRollbackLeads.map((lead) => ({ id: lead.id, name: lead.name === 'Append allowed' ? 'Agent A' : 'Agent B' })))],
  ), "a later target failure rolls back the whole append");
  assert.deepEqual((await db.query("select assigned_to,assignment_batch_id from leads where id=any($1::uuid[]) order by name", [appendRollbackLeads.map((lead) => lead.id)])).rows,
    [{ assigned_to: "-", assignment_batch_id: null }, { assigned_to: "-", assignment_batch_id: null }],
    "failed batch append leaves all candidate leads unchanged");
  assert.equal((await db.query("select lead_count from crm_assignment_batches where id=$1", [appendBatchId])).rows[0].lead_count, appendCountBeforeStale,
    "failed batch append leaves the batch count unchanged");
  await db.exec("reset role;drop trigger fixture_block_batch_append on public.leads;drop function public.fixture_block_batch_append();set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';set role authenticated;");
  await assert.rejects(db.query(
    "select public.crm_add_leads_to_assignment_batch($1,$2::jsonb)",
    [appendBatchId, JSON.stringify([{ id: originalBatchLead, name: "Agent A" }])],
  ), "employees cannot append leads to an assignment batch");
  await db.exec("reset role;");
  await db.query("delete from leads where id=any($1::uuid[])", [[originalBatchLead, ...appendLeads.map((lead) => lead.id), ...appendRollbackLeads.map((lead) => lead.id)]]);
  await db.query("delete from crm_assignment_batches where id=$1", [appendBatchId]);

  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;");
  const editedLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,follow_up_date) values('Atomic edit','9192222310','Agent A','New','2026-11-07') returning id",
  )).rows[0];
  const editedLeadVersion = (await db.query("update leads set status='DNP' where id=$1 returning updated_at", [editedLead.id])).rows[0].updated_at;
  const editedResult = (await db.query(
    "select * from public.crm_update_lead_details_admin($1,$2::jsonb,$3,false)",
    [editedLead.id, JSON.stringify({ assigned_to: "Agent B", status: "RNR", remarks: "Saved with transfer" }), editedLeadVersion],
  )).rows[0];
  assert.deepEqual(
    { assigned_to: editedResult.assigned_to, status: editedResult.status, remarks: editedResult.remarks, follow_up_date: editedResult.follow_up_date },
    { assigned_to: "Agent B", status: "RNR", remarks: "Saved with transfer", follow_up_date: "2026-11-07" },
    "admin detail reassignment saves the edit and preserves status/follow-up in one transaction",
  );
  assert.deepEqual((await db.query("select target_names,lead_count from crm_assignment_batches where id=$1", [editedResult.assignment_batch_id])).rows[0],
    { target_names: ["Agent B"], lead_count: 1 }, "detail reassignment batch matches the saved owner");
  const editReceipt = (await db.query("select user_id::text,action_type,description from lead_activities where lead_id=$1 and action_type='Status changed' order by created_at desc,id desc limit 1", [editedLead.id])).rows[0];
  assert.equal(editReceipt?.user_id, "00000000-0000-4000-8000-000000000001", "admin edit receipt records its actor");
  assert.equal(editReceipt?.action_type, "Status changed", "admin disposition update is logged in lead history");
  assert.ok(editReceipt?.description?.includes("Remarks updated") && editReceipt.description.includes("Status:") && editReceipt.description.includes("Assignment updated"),
    "admin reassignment, disposition and changed fields are recorded in the same activity receipt");

  const staleLead = (await db.query("insert into leads(name,phone,assigned_to,status) values('Stale edit','9192222311','Agent A','New') returning id")).rows[0];
  const batchCountBeforeStaleEdit = (await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n;
  await assert.rejects(db.query(
    "select * from public.crm_update_lead_details_admin($1,$2::jsonb,'2000-01-01T00:00:00Z',false)",
    [staleLead.id, JSON.stringify({ assigned_to: "Agent B", remarks: "stale" })],
  ), "a stale detail edit is rejected before any assignment batch is created");
  assert.equal((await db.query("select assigned_to,remarks from leads where id=$1", [staleLead.id])).rows[0].assigned_to, "Agent A");
  assert.equal((await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n, batchCountBeforeStaleEdit,
    "stale detail edits leave no orphan batch");

  const freshEditLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,follow_up_date,first_agent_touch_at) values('Atomic fresh edit','9192222312','Agent A','New','2026-11-08',now()) returning id",
  )).rows[0];
  const freshEditVersion = (await db.query("update leads set status='DNP' where id=$1 returning updated_at", [freshEditLead.id])).rows[0].updated_at;
  const freshEdit = (await db.query(
    "select * from public.crm_update_lead_details_admin($1,$2::jsonb,$3,true)",
    [freshEditLead.id, JSON.stringify({ assigned_to: "Agent B" }), freshEditVersion],
  )).rows[0];
  assert.deepEqual({ status: freshEdit.status, follow_up_date: freshEdit.follow_up_date, first_agent_touch_at: freshEdit.first_agent_touch_at },
    { status: "New", follow_up_date: "-", first_agent_touch_at: null }, "Send as Fresh resets workflow only when ownership changes");
  assert.deepEqual((await db.query(
    "select action_type,description from lead_activities where lead_id=$1 and action_type='Transfer'",
    [freshEditLead.id],
  )).rows, [{
    action_type: "Transfer",
    description: "Transferred from Agent A to Agent B. Previous notes and call history are retained. Disposition: DNP → New (sent as fresh).",
  }], "single-lead Send as Fresh saves one disposition transition with its transfer receipt");

  const rollbackEditLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,remarks) values('Admin edit blocked','9192222313','Agent A','New','Before') returning id,updated_at",
  )).rows[0];
  const batchCountBeforeEditFailure = (await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n;
  await db.exec(`reset role;
    create function public.fixture_block_admin_edit_assignment() returns trigger language plpgsql as $$
    begin
      if new.name = 'Admin edit blocked' and new.assigned_to = 'Agent B' then raise exception 'fixture blocks admin detail assignment'; end if;
      return new;
    end;$$;
    create trigger fixture_block_admin_edit_assignment before update of assigned_to on public.leads
    for each row execute function public.fixture_block_admin_edit_assignment();
    set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;`);
  await assert.rejects(db.query(
    "select * from public.crm_update_lead_details_admin($1,$2::jsonb,$3,false)",
    [rollbackEditLead.id, JSON.stringify({ assigned_to: "Agent B", remarks: "Must roll back" }), rollbackEditLead.updated_at],
  ), "a lead-trigger failure rejects and rolls back admin edit and assignment batch together");
  assert.deepEqual((await db.query("select assigned_to,remarks from leads where id=$1", [rollbackEditLead.id])).rows[0],
    { assigned_to: "Agent A", remarks: "Before" });
  assert.equal((await db.query("select count(*)::int n from crm_assignment_batches")).rows[0].n, batchCountBeforeEditFailure,
    "failed admin detail assignment leaves no batch");
  await db.exec("reset role;drop trigger fixture_block_admin_edit_assignment on public.leads;drop function public.fixture_block_admin_edit_assignment();set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';set role authenticated;");
  await assert.rejects(db.query(
    "select * from public.crm_update_lead_details_admin($1,$2::jsonb,null,false)",
    [editedLead.id, JSON.stringify({ assigned_to: "Agent A" })],
  ), "employees cannot call the admin reassignment transaction");
  await db.exec("reset role;");
  await db.query("delete from leads where id=any($1::uuid[])", [[editedLead.id, staleLead.id, freshEditLead.id, rollbackEditLead.id]]);
  await db.query("delete from crm_assignment_batches where id=any($1::uuid[])", [[editedResult.assignment_batch_id, freshEdit.assignment_batch_id]]);

  const bucketIds = {};
  for (const [key, name, status] of [
    ["edited", "Bucket edited", "New"],
    ["activity", "Bucket activity", "New"],
    ["opdBooked", "Bucket OPD booked", "OPD Booked"],
    ["opdDone", "Bucket OPD done", "OPD Done"],
    ["ipdBooked", "Bucket IPD booked", "IPD Booked"],
    ["ipdDone", "Bucket IPD done", "IPD Done"],
    ["lost", "Bucket lost", "Dropped"],
  ]) {
    bucketIds[key] = (await db.query(
      "insert into leads(name,phone,assigned_to,status,first_agent_touch_at) values($1,$2,'Agent A',$3,case when $4 then now() else null end) returning id",
      [name, String(9100000000 + Object.keys(bucketIds).length), "New", !['edited', 'activity'].includes(key)],
    )).rows[0].id;
    if (status !== "New") await db.query("update leads set status=$2 where id=$1", [bucketIds[key], status]);
  }
  const oldUntouchedId = (await db.query(
    "insert into leads(name,phone,assigned_to,status,assigned_at,fresh_pending_since) values('Bucket old untouched','9191000000','Agent A','New',(now() - interval '2 days'),(now() - interval '2 days')) returning id",
  )).rows[0].id;
  await db.query(
    "insert into leads(name,phone,assigned_to,status,fresh_pending_since) values('Bucket midnight Fresh','9191000001','Agent A','New',((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata')) returning id",
  );
  await db.query(
    "insert into leads(name,phone,assigned_to,status,fresh_pending_since) values('Bucket midnight New','9191000002','Agent A','New',(((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata') - interval '1 microsecond')) returning id",
  );
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [oldUntouchedId])).rows[0].workflow_bucket, "fresh");
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.edited])).rows[0].workflow_bucket, "fresh");
  const initialGroups = (await db.query("select bucket,lead_count from crm_team_bucket_groups() where assigned_to='Agent A'")).rows;
  assert.ok(initialGroups.some((row) => row.bucket === "fresh" && Number(row.lead_count) >= 3), "today's untouched intake, including exact IST midnight, is grouped as Fresh");
  assert.ok(initialGroups.some((row) => row.bucket === "new" && Number(row.lead_count) >= 2), "untouched intake from before IST midnight is grouped as New");
  assert.ok(initialGroups.some((row) => row.bucket === "lost" && Number(row.lead_count) >= 1), "closed outcomes are grouped as Lost");
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  const dailyBeforeTouch = (await db.query("select crm_daily_work_counts((now() at time zone 'Asia/Kolkata')::date) x")).rows[0].x.assigned;
  await db.query("update leads set remarks='First agent edit' where id=$1", [bucketIds.edited]);
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,auth.uid(),'Note','First agent activity')", [bucketIds.activity]);
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.edited])).rows[0].workflow_bucket, "fresh", "remarks-only edits stay in their current workflow bucket");
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.activity])).rows[0].workflow_bucket, "fresh", "a note activity does not move a lead between buckets");
  const dailyAfterTouch = (await db.query("select crm_daily_work_counts((now() at time zone 'Asia/Kolkata')::date) x")).rows[0].x.assigned;
  assert.equal(Number(dailyBeforeTouch) - Number(dailyAfterTouch), 0, "remarks-only edits leave the daily Fresh count unchanged");
  for (const [key, expected] of [["opdBooked", "opdBooked"], ["opdDone", "opdDone"], ["ipdBooked", "ipdBooked"], ["ipdDone", "ipdDone"]]) {
    assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds[key]])).rows[0].workflow_bucket, expected);
  }
  const bucketSummary = (await db.query("select crm_lead_bucket_summary('Agent A') x")).rows[0].x;
  assert.ok(bucketSummary.new >= 2, "earlier untouched intake counts as New");
  assert.ok(bucketSummary.fresh >= 3, "today's untouched intake counts as Fresh");
  const resetAt = (await db.query("select (((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata')::text as value")).rows[0].value;
  assert.equal(Date.parse(bucketSummary.nextFreshAt), Date.parse(resetAt), "daily Fresh count resets at the next IST midnight");
  assert.ok(!((await db.query("select bucket from crm_team_bucket_groups() where assigned_to='Agent A' and bucket='new'")).rows.length === 0), "earlier untouched lead remains in New grouping");
  assert.equal(bucketSummary.followUp, 0, "remarks and activity-only edits do not enter Follow-up Work");
  assert.ok(bucketSummary.lost >= 1, "closed outcomes are included in role-scoped lead summaries");
  assert.ok(bucketSummary.ipdBooked >= 1 && bucketSummary.ipdDone >= 1, "IPD booked and done are separate");

  // Calling outcomes keep their own status cards and do not leak into the
  // Follow-up Work continuation queue.
  const callOutcomeIds = [];
  for (const [index, status] of ["DNP", "RNR", "CallBack", "Follow-Up"].entries()) {
    const id = (await db.query(
      "insert into leads(name,phone,assigned_to,status,first_agent_touch_at) values($1,$2,'Agent A','New',now()) returning id",
      [`Bucket ${status}`, String(9100000200 + index)],
    )).rows[0].id;
    await db.query("update leads set status=$2 where id=$1", [id, status]);
    callOutcomeIds.push(id);
  }
  const isolatedSummary = (await db.query("select crm_lead_bucket_summary('Agent A') x")).rows[0].x;
  assert.equal(isolatedSummary.followUp, 1, "remark-only edits stay in New/Fresh while explicit Follow-Up disposition enters Follow-up Work");
  assert.equal(isolatedSummary.statuses.DNP, 1);
  assert.equal(isolatedSummary.statuses.RNR, 1);
  assert.equal(isolatedSummary.statuses.CallBack, 1);
  const isolatedGroups = (await db.query("select bucket,lead_count from crm_team_bucket_groups() where assigned_to='Agent A'")).rows;
  assert.equal(Number(isolatedGroups.find((row) => row.bucket === "followup").lead_count), 1,
    "only the explicit Follow-Up disposition is grouped as Follow-up Work");

  // Appointment RLS follows the current employee assignment and changes on reassignment.
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const otherAppointmentLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status) values('Other agent appointment','9180000001','Agent B','OPD Booked') returning id",
  )).rows[0].id;
  const ownAppointment = (await db.query(
    "insert into crm_appointments(lead_id,kind,status,starts_on) values($1,'opdBooked','booked',$2) returning id",
    [bucketIds.opdBooked, today],
  )).rows[0].id;
  const otherAppointment = (await db.query(
    "insert into crm_appointments(lead_id,kind,status,starts_on) values($1,'opdBooked','booked',$2) returning id",
    [otherAppointmentLead, today],
  )).rows[0].id;
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [ownAppointment])).rows[0].n, 1, "employee can view their own appointment");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [otherAppointment])).rows[0].n, 0, "employee cannot view another agent's appointment");
  const ownDailyOpdIds = (await db.query("select id::text from crm_daily_lead_ids('opd',$1)", [today])).rows.map((row) => row.id);
  assert.ok(ownDailyOpdIds.includes(bucketIds.opdBooked), "employee dashboard drill-down includes their assigned appointment");
  assert.ok(!ownDailyOpdIds.includes(otherAppointmentLead), "employee dashboard drill-down excludes another agent's appointment");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [otherAppointment])).rows[0].n, 1, "appointment is visible to its assigned employee");
  const newOwnerDailyOpdIds = (await db.query("select id::text from crm_daily_lead_ids('opd',$1)", [today])).rows.map((row) => row.id);
  assert.ok(newOwnerDailyOpdIds.includes(otherAppointmentLead), "new owner dashboard drill-down includes their assigned appointment");
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  await db.query("update leads set assigned_to='Agent B' where id=$1", [bucketIds.opdBooked]);
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [ownAppointment])).rows[0].n, 0, "reassignment immediately removes old employee access");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [ownAppointment])).rows[0].n, 1, "reassignment grants the new employee access");
  await db.exec("reset role;");

  // Reminders appear after a full week, persist through cron runs, and clear on status change.
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const keepLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,closed_status_since) values('Review Keep','9190000001','Agent A','New',now()-interval '2 days') returning id",
  )).rows[0].id;
  await db.query("update leads set status='Not Interested' where id=$1", [keepLead]);
  await db.query("update leads set remarks='Reviewed' where id=$1", [keepLead]);
  await db.exec("alter table leads disable trigger crm_track_agent_lead_workflow");
  await db.query("update leads set closed_status_since=now()-interval '8 days' where id=$1", [keepLead]);
  await db.exec("alter table leads enable trigger crm_track_agent_lead_workflow");
  await db.query("select crm_private.daily_lost_lead_reviews()");
  const keepReview = (await db.query("select id from crm_lead_deletion_reviews where lead_id=$1", [keepLead])).rows[0].id;
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [keepLead])).rows[0].n, 1, "a due reminder never auto-deletes its lead");
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  await db.query("select crm_submit_deletion_review_note($1,'Patient requested a callback')", [keepReview]);
  assert.equal((await db.query("select agent_note from crm_lead_deletion_reviews where id=$1", [keepReview])).rows[0].agent_note, "Patient requested a callback");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from crm_lead_deletion_reviews where id=$1", [keepReview])).rows[0].n, 0, "another employee cannot see this review");
  await assert.rejects(db.query("select crm_submit_deletion_review_note($1,'Unauthorized note')", [keepReview]));
  await assert.rejects(db.query("select crm_admin_resolve_deletion_review($1,'delete',null)", [keepReview]));
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;");
  await assert.rejects(db.query("select crm_admin_resolve_deletion_review($1,'keep',null)", [keepReview]), "review cannot be cleared without status change or deletion");
  await db.exec("reset role;");
  await db.query("select crm_private.daily_lost_lead_reviews()");
  assert.equal((await db.query("select count(*)::int n from crm_lead_deletion_reviews where id=$1 and decision='pending'", [keepReview])).rows[0].n, 1, "repeated cron runs keep the reminder pending");
  await db.query("update leads set status='Wrong Number' where id=$1", [keepLead]);
  assert.equal((await db.query("select count(*)::int n from crm_lead_deletion_reviews where id=$1", [keepReview])).rows[0].n, 0, "a status change clears the old reminder");
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [keepLead])).rows[0].n, 1, "status change keeps the lead");

  // A due lead stays in the review queue until an explicit admin delete takes
  // a complete database snapshot of the lead and activity history.
  await db.exec("reset role;");
  const purgeLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,closed_status_since) values('Review Purge','9190000002','Agent A','New',now()-interval '8 days') returning id",
  )).rows[0].id;
  await db.query("update leads set status='Wrong Number' where id=$1", [purgeLead]);
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000002','Note','Private patient note')", [purgeLead]);
  await db.exec("alter table leads disable trigger crm_track_agent_lead_workflow");
  await db.query("update leads set closed_status_since=now()-interval '8 days' where id=$1", [purgeLead]);
  await db.exec("alter table leads enable trigger crm_track_agent_lead_workflow");
  const purgeAppointment = (await db.query("insert into crm_appointments(lead_id,kind,status,starts_on) values($1,'opdBooked','booked',$2) returning id", [purgeLead, today])).rows[0].id;
  await db.query("select crm_private.daily_lost_lead_reviews()");
  const purgeReview = (await db.query("select id from crm_lead_deletion_reviews where lead_id=$1 and decision='pending'", [purgeLead])).rows[0].id;
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [purgeLead])).rows[0].n, 1, "a due review leaves the lead in place");
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [purgeLead])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [purgeAppointment])).rows[0].n, 1);
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  await db.query("select crm_admin_resolve_deletion_review($1,'delete',null)", [purgeReview]);
  await db.exec("reset role;");
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [purgeLead])).rows[0].n, 0, "explicit admin delete removes the lead");
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [purgeLead])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [purgeAppointment])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from crm_assignment_events where lead_id=$1", [purgeLead])).rows[0].n, 0);
  const savedBackup = (await db.query("select scope,lead_rows from lead_deletion_backups where lead_rows @> jsonb_build_array(jsonb_build_object('id',$1::text))", [purgeLead])).rows;
  assert.equal(savedBackup.length, 1, "the newest recoverable snapshot survives lead deletion");
  assert.equal(savedBackup[0].scope, "Admin lost lead review delete");
  assert.equal(savedBackup[0].lead_rows[0].name, "Review Purge");

  // Exercise the production-style activity policy with a second actor on one lead.
  await db.exec("reset role; drop policy fixture_activity_scope on public.lead_activities; create policy fixture_admin_activity on public.lead_activities for all to authenticated using (public.current_user_role() in ('admin','manager')) with check (public.current_user_role() in ('admin','manager'));");
  const privacyLead = (await db.query("insert into leads(name,phone,assigned_to,status) values('Privacy fixture','9190000077','Agent A','New') returning id")).rows[0].id;
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000001','Note','Admin activity'),($1,'00000000-0000-4000-8000-000000000002','Note','Agent activity')", [privacyLead]);
  await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'");
  assert.deepEqual((await db.query("select description from lead_activities where lead_id=$1", [privacyLead])).rows.map(r => r.description), ['Agent activity']);
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'");
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [privacyLead])).rows[0].n, 2);
  await db.query("select crm_capture_duplicate_review_candidates($1::jsonb,'Test')", [JSON.stringify([{phone_identity:'9190000077',name:'Incoming'}])]);
  const reviewId = (await db.query("select id from crm_duplicate_review_queue where lead_id=$1", [privacyLead])).rows[0].id;
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000004'");
  assert.equal((await db.query("select count(*)::int n from crm_duplicate_review_queue where id=$1", [reviewId])).rows[0].n, 0);
  await assert.rejects(db.query("select crm_resolve_duplicate_review_items($1::uuid[],'keep',null,false)", [[reviewId]]));
  // A forged duplicate attempt must never delete an existing unassigned lead.
  await db.exec("reset role");
  const safeLead = (await db.query("insert into leads(name,phone,assigned_to,status) values('Existing patient','9190000088','-','New') returning id")).rows[0].id;
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000001','Note','Retain this history')", [safeLead]);
  await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'");
  await db.query("select crm_capture_duplicate_review_candidates($1::jsonb,'Test')", [JSON.stringify([{phone_identity:'9190000088',name:'Duplicate'}])]);
  await db.exec("reset role");
  await db.query("update crm_duplicate_review_queue set expires_at=now()-interval '1 hour' where lead_id=$1", [safeLead]);
  await db.query("select crm_private.cleanup_expired_duplicate_reviews()");
  await db.query("select crm_private.cleanup_expired_duplicate_reviews()");
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [safeLead])).rows[0].n, 1, 'existing lead survives expired duplicate review');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [safeLead])).rows[0].n, 1, 'existing lead history survives');
  assert.equal((await db.query("select resolution from crm_duplicate_review_queue where lead_id=$1", [safeLead])).rows[0].resolution, 'expired');

  // Follow-up mutation and its timeline entry commit or roll back together.
  await db.exec("reset role; create policy fixture_employee_activity_insert on public.lead_activities for insert to authenticated with check (public.current_user_role() = 'employee' and user_id = auth.uid() and exists (select 1 from public.leads l where l.id = lead_activities.lead_id)); set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'");
  const followUpIds = (await db.query(`insert into leads(name,phone,assigned_to,status,follow_up_date,follow_up_at)
    values ('Task reschedule fixture','9190000091','Agent A','New','2026-11-06','2026-11-06T05:00:00Z'),
           ('Task complete fixture','9190000092','Agent A','New','2026-11-06','2026-11-06T05:00:00Z')
    returning id`)).rows.map(row => row.id);
  const [rescheduleLead, completeLead] = followUpIds;
  await db.query("update leads set status='DNP' where id=any($1::uuid[])", [followUpIds]);
  const appointmentLead = (await db.query(`insert into leads(name,phone,assigned_to,status,opd_booked_date)
    values ('Appointment date fixture','9190000095','Agent A','OPD Booked',null) returning id`)).rows[0].id;
  await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'");
  await db.query("select crm_update_task_follow_up($1,'reschedule','2026-11-09'::date,'')", [rescheduleLead]);
  let followUp = (await db.query("select follow_up_date, follow_up_at, status from leads where id=$1", [rescheduleLead])).rows[0];
  assert.equal(followUp.follow_up_date, '2026-11-09');
  assert.equal(followUp.follow_up_at, null, 'rescheduling clears the old callback time');
  assert.equal(followUp.status, 'DNP', 'follow-up scheduling never changes disposition');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1 and action_type='Follow-up rescheduled'", [rescheduleLead])).rows[0].n, 1);
  let appointmentVersion = (await db.query("select updated_at::text from leads where id=$1", [appointmentLead])).rows[0].updated_at;
  const staleAppointmentVersion = appointmentVersion;
  const savedAppointment = (await db.query(
    "select * from crm_update_lead_appointment($1,'opd_booked_date',$2::text,$3)",
    [appointmentLead, '2026-11-12', appointmentVersion],
  )).rows[0];
  assert.equal(savedAppointment.opd_booked_date, '2026-11-12', 'employee can save their assigned appointment date');
  assert.deepEqual((await db.query("select user_id::text,action_type,description from lead_activities where lead_id=$1", [appointmentLead])).rows, [{
    user_id: '00000000-0000-4000-8000-000000000002',
    action_type: 'Appointment date updated',
    description: 'OPD booked date: — → 2026-11-12',
  }], 'appointment date and actor timeline receipt commit together');
  appointmentVersion = (await db.query("select updated_at::text from leads where id=$1", [appointmentLead])).rows[0].updated_at;
  await db.query("select crm_update_lead_appointment($1,'opd_booked_date',$2::text,$3)", [appointmentLead, '2026-11-12', appointmentVersion]);
  assert.equal((await db.query("select updated_at::text from leads where id=$1", [appointmentLead])).rows[0].updated_at, appointmentVersion, 'saving the same appointment date is a no-op');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [appointmentLead])).rows[0].n, 1, 'a no-op appointment save does not duplicate timeline entries');
  await assert.rejects(db.query(
    "select crm_update_lead_appointment($1,'opd_booked_date',$2::text,$3)",
    [appointmentLead, '2026-11-13', staleAppointmentVersion],
  ), /changed while you were editing/i, 'a stale appointment form cannot overwrite a newer save');
  await assert.rejects(db.query(
    "select crm_update_lead_appointment($1,'status',$2::text,$3)",
    [appointmentLead, '2026-11-13', appointmentVersion],
  ), /valid appointment date field/i, 'appointment updates cannot name a status or other lead field');
  await assert.rejects(db.query(
    "select crm_update_lead_appointment($1,'opd_booked_date',$2::text,$3)",
    [safeLead, '2026-11-13', appointmentVersion],
  ), /Lead not found or access denied/i, 'employees cannot edit another employee\'s appointment date');
  await db.query("select crm_update_task_follow_up($1,'complete',null,'')", [completeLead]);
  followUp = (await db.query("select follow_up_date, follow_up_at, status from leads where id=$1", [completeLead])).rows[0];
  assert.equal(followUp.follow_up_date, '-');
  assert.equal(followUp.follow_up_at, null, 'completing clears the old callback time');
  assert.equal(followUp.status, 'DNP', 'completion never changes disposition');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1 and action_type='Follow-up completed'", [completeLead])).rows[0].n, 1);
  await assert.rejects(db.query("select crm_update_task_follow_up($1,'complete',null,'')", [safeLead]), /unavailable or access denied/i);
  await assert.rejects(db.query("select crm_update_task_follow_up($1,'invalid',null,'')", [rescheduleLead]), /invalid follow-up action/i);
  await db.exec("reset role");
  await db.exec(`create function public.reject_followup_activity() returns trigger language plpgsql as $$
    begin if new.action_type = 'Follow-up rescheduled' then raise exception 'fixture activity rejection'; end if; return new; end $$;
    create trigger reject_followup_activity before insert on public.lead_activities for each row execute function public.reject_followup_activity();
    set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`);
  await assert.rejects(db.query("select crm_update_task_follow_up($1,'reschedule','2026-11-10'::date,'')", [rescheduleLead]));
  followUp = (await db.query("select follow_up_date, follow_up_at from leads where id=$1", [rescheduleLead])).rows[0];
  assert.equal(followUp.follow_up_date, '2026-11-09', 'failed timeline insert rolls back date change');
  assert.equal(followUp.follow_up_at, null, 'failed timeline insert cannot leave a partial callback update');
  await db.exec("reset role; drop trigger reject_followup_activity on public.lead_activities; drop function reject_followup_activity();");

  // Status and its actor timeline entry commit together under the caller's RLS.
  const statusLeadIds = (await db.query(`insert into leads(name,phone,assigned_to,status)
    values ('Status employee fixture','9190000093','Agent A','New'),
           ('Status other-owner fixture','9190000094','Agent B','New') returning id`)).rows.map(row => row.id);
  const [statusLead, otherOwnerStatusLead] = statusLeadIds;
  await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'");
  const changedStatus = (await db.query(
    "select (crm_change_lead_status($1,'DNP','New')).status as status", [statusLead],
  )).rows[0].status;
  assert.equal(changedStatus, 'DNP', 'employee status RPC returns the committed status');
  assert.deepEqual((await db.query(
    "select user_id,action_type,description from lead_activities where lead_id=$1 and action_type='Status changed'", [statusLead],
  )).rows, [{
    user_id: '00000000-0000-4000-8000-000000000002',
    action_type: 'Status changed',
    description: 'Patient: Status employee fixture · 9190000093 | New → DNP',
  }], 'status timeline preserves the exact transition and actor');
  await assert.rejects(
    db.query("select crm_change_lead_status($1,'RNR','New')", [statusLead]),
    /status changed/i,
    'a stale editor cannot overwrite a newer disposition',
  );
  await assert.rejects(
    db.query("select crm_change_lead_status($1,'RNR','New')", [otherOwnerStatusLead]),
    /unavailable or access denied/i,
    'an employee cannot change another employee\'s lead',
  );
  const detailsVersion = (await db.query("select updated_at::text from leads where id=$1", [statusLead])).rows[0].updated_at;
  const drawerStatus = (await db.query(
    "select * from crm_update_lead_details($1,$2::jsonb,$3)",
    [statusLead, JSON.stringify({ status: 'RNR', remarks: 'Drawer edit' }), detailsVersion],
  )).rows[0];
  assert.equal(drawerStatus.status, 'RNR', 'detail drawer can commit a status and other fields together');
  const detailAudit = (await db.query(
    "select user_id::text,action_type,description,created_at from lead_activities where lead_id=$1 and action_type='Status changed' order by created_at desc,id desc limit 1",
    [statusLead],
  )).rows[0];
  assert.equal(detailAudit.user_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(detailAudit.action_type, 'Status changed');
  assert.match(detailAudit.description, /Changed: Remarks updated; Status: DNP.*RNR/);
  assert.ok(detailAudit.created_at, 'detail drawer audit entry has an exact timestamp');
  const currentDetailVersion = (await db.query("select updated_at::text from leads where id=$1", [statusLead])).rows[0].updated_at;
  const detailNoOp = (await db.query(
    "select * from crm_update_lead_details($1,$2::jsonb,$3)",
    [statusLead, JSON.stringify({ status: 'RNR', remarks: 'Drawer edit' }), currentDetailVersion],
  )).rows[0];
  assert.equal(detailNoOp.status, 'RNR', 'a no-op save returns the authoritative saved lead');
  assert.equal((await db.query("select updated_at::text from leads where id=$1", [statusLead])).rows[0].updated_at, currentDetailVersion, 'saving unchanged details does not invalidate other editors');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [statusLead])).rows[0].n, 2, 'a no-op detail save does not duplicate timeline entries');
  const followUpDateVersion = (await db.query("select updated_at::text from leads where id=$1", [statusLead])).rows[0].updated_at;
  const savedFollowUpDate = (await db.query(
    "select * from crm_update_lead_details($1,$2::jsonb,$3)",
    [statusLead, JSON.stringify({ follow_up_date: '2026-11-09' }), followUpDateVersion],
  )).rows[0];
  assert.equal(savedFollowUpDate.follow_up_date, '2026-11-09', 'follow-up date saves through the atomic detail path');
  assert.equal(savedFollowUpDate.status, 'RNR', 'saving a follow-up date does not change the lead disposition');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1 and description='Changed: Follow-up date: — → 2026-11-09.'", [statusLead])).rows[0].n, 1,
    'follow-up date timeline receipt is written with the saved value');
  await assert.rejects(db.query(
    "select crm_update_lead_details($1,$2::jsonb,$3)",
    [statusLead, JSON.stringify({ status: 'New' }), detailsVersion],
  ), /changed while you were editing/i, 'detail edits reject stale form versions');
  assert.equal((await db.query("select status from leads where id=$1", [statusLead])).rows[0].status, 'RNR', 'a stale detail form cannot revert a saved status');
  await assert.rejects(db.query(
    "select crm_update_lead_details($1,$2::jsonb,$3)",
    [otherOwnerStatusLead, JSON.stringify({ status: 'DNP' }), '2000-01-01T00:00:00Z'],
  ), /Lead not found|access denied/i, 'detail edits cannot cross employee ownership');
  await assert.rejects(db.query(
    "select crm_update_lead_details($1,$2::jsonb,$3)",
    [statusLead, JSON.stringify({ assigned_to: 'Agent B' }), currentDetailVersion],
  ), /Only admins can assign or transfer/i, 'employees cannot bypass assignment permissions through the detail RPC');
  await assert.rejects(
    db.query("select crm_change_lead_status($1,'Unsupported','DNP')", [statusLead]),
    /available lead statuses/i,
    'the database rejects values outside the CRM status vocabulary',
  );
  await db.query("select crm_change_lead_status($1,'RNR','RNR')", [statusLead]);
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1 and action_type='Status changed'", [statusLead])).rows[0].n, 2,
    'saving the same status does not add a duplicate transition');
  await db.exec("reset role; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; set role authenticated;");
  await db.query("select crm_change_lead_status($1,'Follow-Up','New')", [otherOwnerStatusLead]);
  assert.equal((await db.query("select status from leads where id=$1", [otherOwnerStatusLead])).rows[0].status, 'Follow-Up',
    'admin can change a team lead disposition');
  await db.exec("reset role; update profiles set role='manager' where id='00000000-0000-4000-8000-000000000003'; set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  await db.query("select crm_change_lead_status($1,'DNP','Follow-Up')", [otherOwnerStatusLead]);
  assert.equal((await db.query("select user_id from lead_activities where lead_id=$1 and action_type='Status changed' and description like '%DNP'", [otherOwnerStatusLead])).rows[0].user_id,
    '00000000-0000-4000-8000-000000000003', 'manager can update a team lead and is recorded as the actor');
  const managerDetailVersion = (await db.query("select updated_at::text from leads where id=$1", [otherOwnerStatusLead])).rows[0].updated_at;
  await db.query("select crm_update_lead_details($1,$2::jsonb,$3)",
    [otherOwnerStatusLead, JSON.stringify({ status: 'CallBack', remarks: 'Manager drawer edit' }), managerDetailVersion]);
  assert.equal((await db.query("select status from leads where id=$1", [otherOwnerStatusLead])).rows[0].status, 'CallBack', 'manager detail drawer can save a team disposition');
  assert.equal((await db.query("select user_id::text from lead_activities where lead_id=$1 and description like '%CallBack.'", [otherOwnerStatusLead])).rows[0].user_id,
    '00000000-0000-4000-8000-000000000003', 'manager detail edit timeline records the correct actor');
  await db.exec("reset role; update profiles set role='employee' where id='00000000-0000-4000-8000-000000000003';");
  await db.exec(`reset role; create function public.reject_status_activity() returns trigger language plpgsql as $$
    begin if new.action_type in ('Status changed','Appointment date updated') then raise exception 'fixture timeline rejection'; end if; return new; end $$;
    create trigger reject_status_activity before insert on public.lead_activities for each row execute function public.reject_status_activity();
    set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`);
  await assert.rejects(db.query("select crm_change_lead_status($1,'New','RNR')", [statusLead]), /fixture timeline rejection/i);
  assert.equal((await db.query("select status from leads where id=$1", [statusLead])).rows[0].status, 'RNR',
    'a failed timeline insert rolls back the status update');
  await assert.rejects(db.query("select crm_update_lead_details($1,$2::jsonb,$3)",
    [statusLead, JSON.stringify({ status: 'New' }), (await db.query("select updated_at::text from leads where id=$1", [statusLead])).rows[0].updated_at]),
    /fixture timeline rejection/i, 'detail drawer save rolls back when its timeline entry fails');
  assert.equal((await db.query("select status from leads where id=$1", [statusLead])).rows[0].status, 'RNR',
    'failed detail timeline cannot partially change the disposition');
  await assert.rejects(db.query("select crm_update_lead_appointment($1,'opd_booked_date',$2::text,$3)",
    [appointmentLead, '2026-11-13', (await db.query("select updated_at::text from leads where id=$1", [appointmentLead])).rows[0].updated_at]),
    /fixture timeline rejection/i, 'appointment date rolls back when its timeline entry fails');
  assert.equal((await db.query("select opd_booked_date from leads where id=$1", [appointmentLead])).rows[0].opd_booked_date, '2026-11-12',
    'a failed appointment timeline cannot leave a partially saved date');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [appointmentLead])).rows[0].n, 1,
    'failed appointment update does not leave an activity entry');
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1 and action_type='Status changed'", [statusLead])).rows[0].n, 2,
    'failed status transition leaves no partial timeline entry');
  await db.exec("reset role; drop trigger reject_status_activity on public.lead_activities; drop function reject_status_activity();");

  // Weekly-off and leave scheduling retain their role boundaries and attendance guard.
  await db.exec("reset role; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; set role authenticated;");
  const weeklyOff = (await db.query(`insert into employee_weekly_offs
    (employee_id,week_start_date,off_date,note,created_by,updated_by)
    values('00000000-0000-4000-8000-000000000002','2026-11-09','2026-11-09','Rotating Monday',
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001') returning id`)).rows[0].id;
  await assert.rejects(db.query(`insert into employee_weekly_offs
    (employee_id,week_start_date,off_date,created_by,updated_by)
    values('00000000-0000-4000-8000-000000000002','2026-11-09','2026-11-10',
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001')`),
    /employee_weekly_offs_monday_start|employee_weekly_offs_one_per_week/i,
    'a weekly off must be one selected weekday in its week');
  await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  assert.equal((await db.query("select count(*)::int n from employee_weekly_offs where id=$1", [weeklyOff])).rows[0].n, 1,
    'employee can view their own weekly-off schedule');
  await assert.rejects(db.query(`insert into employee_weekly_offs
    (employee_id,week_start_date,off_date,created_by,updated_by)
    values('00000000-0000-4000-8000-000000000002','2026-11-16','2026-11-16',
      '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002')`), /row-level security|permission denied/i,
    'employees cannot create or change their own weekly off');
  const weeklyOffAbsentError = await db.query(
    "insert into attendance(employee_id,attendance_date,status) values('00000000-0000-4000-8000-000000000002','2026-11-09','Absent')",
  ).then(() => null, (error) => error);
  assert.ok(weeklyOffAbsentError, 'a scheduled weekly off cannot be marked Absent');
  assert.match(String(weeklyOffAbsentError.message ?? weeklyOffAbsentError), /scheduled weekly off or approved leave/i);
  await db.query("insert into attendance(employee_id,attendance_date,status) values('00000000-0000-4000-8000-000000000002','2026-11-09','Present')");
  assert.equal((await db.query("select count(*)::int n from attendance where employee_id=auth.uid() and attendance_date='2026-11-09' and status='Present'")).rows[0].n, 1,
    'sign-in remains allowed on a weekly-off date');
  await db.query(`insert into employee_leave_requests(employee_id,start_date,end_date,leave_type,duration,reason)
    values(auth.uid(),'2026-12-01','2026-12-01','Sick','full_day','Medical appointment')`);
  const leaveRequest = (await db.query("select id from employee_leave_requests where employee_id=auth.uid() and start_date='2026-12-01'")).rows[0].id;
  await db.query(`insert into employee_leave_requests(employee_id,start_date,end_date,leave_type,duration)
    values(auth.uid(),'2026-12-03','2026-12-03','Casual','half_day')`);
  await assert.rejects(db.query(`insert into employee_leave_requests(employee_id,start_date,end_date,leave_type,duration)
    values(auth.uid(),'2026-12-05','2026-12-06','Paid','half_day')`), /employee_leave_requests_half_day_one_date/i,
    'half-day leave must be one date');
  await assert.rejects(db.query(`insert into employee_leave_requests(employee_id,start_date,end_date,leave_type,duration)
    values(auth.uid(),'2026-12-01','2026-12-01','Paid','full_day')`), /overlap an existing/i,
    'overlapping pending/approved leave is rejected');
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from employee_weekly_offs where id=$1", [weeklyOff])).rows[0].n, 0,
    'another employee cannot read this employee\'s weekly-off schedule');
  assert.equal((await db.query("select count(*)::int n from employee_leave_requests where id=$1", [leaveRequest])).rows[0].n, 0,
    'another employee cannot read this leave request');
  await db.exec("reset role; update profiles set role='manager' where id='00000000-0000-4000-8000-000000000003'; set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from employee_weekly_offs where id=$1", [weeklyOff])).rows[0].n, 1,
    'manager can view the team weekly-off schedule');
  assert.equal((await db.query("select count(*)::int n from employee_leave_requests where id=$1", [leaveRequest])).rows[0].n, 0,
    'leave request details remain hidden from managers');
  assert.equal((await db.query("update employee_weekly_offs set note='Manager edit' where id=$1 returning id", [weeklyOff])).rows.length, 0,
    'weekly-off management remains admin-only');
  await assert.rejects(db.query(`insert into employee_weekly_offs
    (employee_id,week_start_date,off_date,created_by,updated_by)
    values('00000000-0000-4000-8000-000000000003','2026-11-16','2026-11-16',
      '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003')`), /row-level security|permission denied/i,
    'managers cannot manage weekly offs');
  assert.equal((await db.query("update employee_leave_requests set status='Approved' where id=$1 returning id", [leaveRequest])).rows.length, 0,
    'only admins can approve leave requests');
  await db.exec("reset role; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; set role authenticated;");
  await db.query("update employee_leave_requests set status='Approved',reviewed_by=auth.uid(),reviewed_at=now() where id=$1", [leaveRequest]);
  assert.equal((await db.query("select status from employee_leave_requests where id=$1", [leaveRequest])).rows[0].status, 'Approved',
    'admin can approve an employee leave request');
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  const leaveAbsentError = await db.query(
    "insert into attendance(employee_id,attendance_date,status) values(auth.uid(),'2026-12-01','Absent')",
  ).then(() => null, (error) => error);
  assert.ok(leaveAbsentError, 'approved leave cannot be marked Absent');
  assert.match(String(leaveAbsentError.message ?? leaveAbsentError), /scheduled weekly off or approved leave/i);
  await db.query("insert into attendance(employee_id,attendance_date,status) values(auth.uid(),'2026-12-01','Present')");
  assert.equal((await db.query("select count(*)::int n from attendance where employee_id=auth.uid() and attendance_date='2026-12-01' and status='Present'")).rows[0].n, 1,
    'work attendance remains allowed during approved leave for admin review');
  await db.exec("reset role; insert into calendar_events(owner_id,event_date,title) values('00000000-0000-4000-8000-000000000002','2026-12-02','Own event'); set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  assert.equal((await db.query("select count(*)::int n from calendar_events")).rows[0].n, 1,
    'signed-in users retain access to their own calendar events');
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from calendar_events")).rows[0].n, 0,
    'signed-in users cannot see another user\'s calendar events');
  await db.exec("reset role; set role anon; set request.jwt.claim.sub='';");
  assert.equal((await db.query("select count(*)::int n from calendar_events")).rows[0].n, 0,
    'anonymous callers cannot read calendar events');
  await assert.rejects(db.query("insert into calendar_events(owner_id,event_date,title) values('00000000-0000-4000-8000-000000000002','2026-12-03','Anonymous event')"),
    /row-level security|permission denied/i,
    'anonymous callers cannot write calendar events');
  await db.exec("reset role; update profiles set role='employee' where id='00000000-0000-4000-8000-000000000003';");
  await db.exec("reset role; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");
  let missingRoleDenied=false;try{await db.query('select crm_capacity()');}catch{missingRoleDenied=true;}assert.ok(missingRoleDenied,'missing profiles must not bypass admin guards');
  await db.close();
  console.log(
    "Isolated migration checks passed: calendar owner/anonymous RLS, status/assignment RLS, weekly offs and leave, appointment owner RLS, agent buckets, deletion reviews, and linked-data cleanup",
  );
})().catch(async (e) => {
  console.error(e);
  await db?.close();
  process.exitCode = 1;
});
