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
  await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.profiles(id uuid primary key,name text,role text,phone text,email text,gender text,blood_group text,emergency_contact text,manager_name text,photo_url text);
insert into profiles values('00000000-0000-4000-8000-000000000001','Admin','admin'),('00000000-0000-4000-8000-000000000002','Agent A','employee'),('00000000-0000-4000-8000-000000000003','Agent B','employee');
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
  }
  const hardened = (await db.query(`select
    has_function_privilege('anon','public.handle_new_user()','execute') as anon_handle,
    has_function_privilege('authenticated','public.handle_new_user()','execute') as auth_handle,
    has_function_privilege('anon','public.rls_auto_enable()','execute') as anon_rls,
    has_function_privilege('authenticated','public.rls_auto_enable()','execute') as auth_rls,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.handle_new_user()'::regprocedure) as empty_handle_path,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.current_user_role()'::regprocedure) as empty_role_path,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.crm_scheduler_status()'::regprocedure) as empty_scheduler_path,
    (select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='public.set_updated_at()'::regprocedure) as pinned_updated_path,
    exists(select 1 from pg_attribute where attrelid='public.leads'::regclass and attname='meta_leadgen_id' and not attisdropped) as has_meta_id
  `)).rows[0];
  assert.deepEqual(hardened, {
    anon_handle: false,
    auth_handle: false,
    anon_rls: false,
    auth_rls: false,
    empty_handle_path: true,
    empty_role_path: true,
    empty_scheduler_path: true,
    pinned_updated_path: true,
    has_meta_id: true,
  });
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
      await db.query("select follow_up_at from leads")
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
  await db.exec(
    `set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';`,
  );
  await db.query("select crm_change_appointment_status($1,'completed')", [
    saved.appointmentId,
  ]);
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
await db.query("select crm_change_appointment_status($1,'completed')",[ipd.appointmentId]);
daily=(await db.query('select crm_daily_work_counts($1) x',[today])).rows[0].x;assert.equal(daily.ipdDone,1);
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

  // Agent bucket lifecycle: initial assignments are Fresh; any agent field
  // edit or logged activity changes that lead to Follow-up.
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const bucketIds = {};
  for (const [key, name, status] of [
    ["edited", "Bucket edited", "New"],
    ["activity", "Bucket activity", "New"],
    ["opdBooked", "Bucket OPD booked", "OPD Booked"],
    ["opdDone", "Bucket OPD done", "OPD Done"],
    ["ipdBooked", "Bucket IPD booked", "IPD Booked"],
    ["ipdDone", "Bucket IPD done", "IPD Done"],
  ]) {
    bucketIds[key] = (await db.query(
      "insert into leads(name,phone,assigned_to,status) values($1,$2,'Agent A',$3) returning id",
      [name, String(9100000000 + Object.keys(bucketIds).length), status],
    )).rows[0].id;
  }
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.edited])).rows[0].workflow_bucket, "fresh");
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  await db.query("update leads set remarks='First agent edit' where id=$1", [bucketIds.edited]);
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,auth.uid(),'Note','First agent activity')", [bucketIds.activity]);
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.edited])).rows[0].workflow_bucket, "followup");
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.activity])).rows[0].workflow_bucket, "followup");
  for (const [key, expected] of [["opdBooked", "opdBooked"], ["opdDone", "opdDone"], ["ipdBooked", "ipdBooked"], ["ipdDone", "ipdDone"]]) {
    assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds[key]])).rows[0].workflow_bucket, expected);
  }
  const bucketSummary = (await db.query("select crm_lead_bucket_summary('Agent A') x")).rows[0].x;
  assert.ok(bucketSummary.fresh >= 1205, "new unedited assignment counts as Fresh");
  assert.ok(bucketSummary.followUp >= 2, "first edits and activities count as Follow-up");
  assert.ok(bucketSummary.ipdBooked >= 1 && bucketSummary.ipdDone >= 1, "IPD booked and done are separate");

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
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [otherAppointment])).rows[0].n, 1, "appointment is visible to its assigned employee");
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  await db.query("update leads set assigned_to='Agent B' where id=$1", [bucketIds.opdBooked]);
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [ownAppointment])).rows[0].n, 0, "reassignment immediately removes old employee access");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [ownAppointment])).rows[0].n, 1, "reassignment grants the new employee access");
  await db.exec("reset role;");

  // Closed statuses wait seven days before review. Agent notes are private to
  // that assigned employee; only an administrator can Keep or Delete.
  await db.exec("reset role;");
  const keepLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,closed_status_since) values('Review Keep','9190000001','Agent A','Not Interested',now()-interval '8 days') returning id",
  )).rows[0].id;
  await db.query("select crm_private.daily_lost_lead_reviews()");
  const keepReview = (await db.query("select id from crm_lead_deletion_reviews where lead_id=$1", [keepLead])).rows[0].id;
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  await db.query("select crm_submit_deletion_review_note($1,'Patient requested a callback')", [keepReview]);
  assert.equal((await db.query("select agent_note from crm_lead_deletion_reviews where id=$1", [keepReview])).rows[0].agent_note, "Patient requested a callback");
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  assert.equal((await db.query("select count(*)::int n from crm_lead_deletion_reviews where id=$1", [keepReview])).rows[0].n, 0, "another employee cannot see this review");
  await assert.rejects(db.query("select crm_submit_deletion_review_note($1,'Unauthorized note')", [keepReview]));
  await assert.rejects(db.query("select crm_admin_resolve_deletion_review($1,'delete',null)", [keepReview]));
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;");
  await db.query("select crm_admin_resolve_deletion_review($1,'keep',null)", [keepReview]);
  assert.equal((await db.query("select decision from crm_lead_deletion_reviews where id=$1", [keepReview])).rows[0].decision, "kept");

  // When the review remains unanswered through its seven-day deadline, lead,
  // activity, appointments, assignment history and JSON recovery copies purge.
  await db.exec("reset role;");
  const purgeLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,closed_status_since) values('Review Purge','9190000002','Agent A','Wrong Number',now()-interval '8 days') returning id",
  )).rows[0].id;
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000002','Note','Private patient note')", [purgeLead]);
  const purgeAppointment = (await db.query("insert into crm_appointments(lead_id,kind,status,starts_on) values($1,'opdBooked','booked',$2) returning id", [purgeLead, today])).rows[0].id;
  await db.query("insert into lead_deletion_backups(scope,search,row_count,activity_count,lead_rows,activity_rows) values('selected','',1,1,jsonb_build_array(jsonb_build_object('id',$1::text,'name','Review Purge')),jsonb_build_array(jsonb_build_object('lead_id',$1::text,'description','Private patient note')))", [purgeLead]);
  await db.query("select crm_private.daily_lost_lead_reviews()");
  const purgeReview = (await db.query("select id from crm_lead_deletion_reviews where lead_id=$1", [purgeLead])).rows[0].id;
  await db.query("update crm_lead_deletion_reviews set delete_after=now()-interval '1 minute' where id=$1", [purgeReview]);
  await db.query("select crm_private.daily_lost_lead_reviews()");
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [purgeLead])).rows[0].n, 0, "unanswered due review removes lead");
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [purgeLead])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [purgeAppointment])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from crm_assignment_events where lead_id=$1", [purgeLead])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from lead_deletion_backups where lead_rows @> jsonb_build_array(jsonb_build_object('id',$1::text))", [purgeLead])).rows[0].n, 0, "recovery copy is scrubbed");

  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");
  let missingRoleDenied=false;try{await db.query('select crm_capacity()');}catch{missingRoleDenied=true;}assert.ok(missingRoleDenied,'missing profiles must not bypass admin guards');
  await db.close();
  console.log(
    "Isolated migration checks passed: CRM workflows, appointment owner RLS and reassignment, agent buckets, deletion reviews, and linked-data cleanup",
  );
})().catch(async (e) => {
  console.error(e.message);
  await db?.close();
  process.exitCode = 1;
});
