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
create schema storage;create table storage.objects(metadata jsonb);
insert into storage.objects(metadata) values ('{"size":100}'::jsonb), ('{"size":250}'::jsonb);
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
    (select prosecdef=false from pg_proc where oid='public.crm_update_lead_details_admin(uuid,jsonb,timestamptz,boolean)'::regprocedure) as invoker_admin_lead_edit,
    (select proconfig @> array['search_path=""'] from pg_proc where oid='public.crm_update_lead_details_admin(uuid,jsonb,timestamptz,boolean)'::regprocedure) as empty_admin_lead_edit_path,
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
    invoker_admin_lead_edit: true,
    empty_admin_lead_edit_path: true,
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
    "New → OPD Done",
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
assert.equal(ipdTransition,'IPD Booked → IPD Done','calendar edits and completion both record status transitions');
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
  let importedLead = (await db.query("select status,workflow_bucket from leads where id=$1", [importedLeadId])).rows[0];
  assert.equal(importedLead.status, 'DNP', 'assignment preserves the imported disposition');
  assert.equal(importedLead.workflow_bucket, 'fresh', 'assignment alone keeps the imported lead untouched');
  await db.query("update leads set remarks='First CRM update' where id=$1", [importedLeadId]);
  importedLead = (await db.query("select status,workflow_bucket from leads where id=$1", [importedLeadId])).rows[0];
  assert.equal(importedLead.status, 'DNP');
  assert.notEqual(importedLead.workflow_bucket, 'fresh', 'CRM work ends the untouched state');
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
  assignmentState = (await db.query("select workflow_bucket, first_agent_touch_at from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(assignmentState.workflow_bucket, "followup", "admin disposition update removes the lead from New Today");
  assert.ok(assignmentState.first_agent_touch_at);
  const afterAdminEdit = Number((await db.query("select crm_daily_work_counts((now() at time zone 'Asia/Kolkata')::date) x")).rows[0].x.assigned);
  assert.equal(beforeAdminEdit - afterAdminEdit, 1, "daily New count matches the changed disposition");
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
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';");
  await db.query("update leads set status='RNR' where id=$1", [newAssignmentId]);
  let employeeStatus = (await db.query("select status,workflow_bucket,first_agent_touch_at from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(employeeStatus.status, "RNR", "assigned employee can save a disposition through lead RLS");
  assert.equal(employeeStatus.workflow_bucket, "followup", "employee status change ends the fresh bucket");
  assert.ok(employeeStatus.first_agent_touch_at, "employee status change records first CRM touch");
  await db.query("update leads set remarks='Agent B note' where id=$1", [newAssignmentId]);
  employeeStatus = (await db.query("select status,workflow_bucket from leads where id=$1", [newAssignmentId])).rows[0];
  assert.equal(employeeStatus.status, "RNR", "a later employee remarks edit does not revert the saved disposition");
  assert.equal(employeeStatus.workflow_bucket, "followup", "receiving agent's edit removes the lead from New Today");
  const staleEmployeeStatus = await db.query("update leads set status='New' where id=$1 and status='New' returning id", [newAssignmentId]);
  assert.equal(staleEmployeeStatus.rows.length, 0, "a stale employee status cannot replace the saved disposition");
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
    "insert into leads(name,phone,assigned_to,status,assignment_batch_id) values('Keep status DNP','9192222281','Agent A','DNP',$1),('Keep status OPD','9192222282','Agent A','OPD Booked',$1) returning id,status",
    [keepBatchId],
  )).rows;
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
  assert.equal(Number((await db.query(
    "select public.crm_transfer_assignment_batch($1,'Agent B',true) as transferred",
    [freshBatchId],
  )).rows[0].transferred), 1);
  const freshBatchLead = (await db.query("select assigned_to,status,follow_up_date,first_agent_touch_at from leads where id=$1", [freshBatchLeadId])).rows[0];
  assert.equal(freshBatchLead.assigned_to, "Agent B");
  assert.equal(freshBatchLead.status, "New", "Send as Fresh deliberately resets the disposition");
  assert.equal(freshBatchLead.follow_up_date, "-");
  assert.equal(freshBatchLead.first_agent_touch_at, null);
  assert.deepEqual((await db.query("select target_names from crm_assignment_batches where id=$1", [freshBatchId])).rows[0].target_names, ["Agent B"]);

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
    "insert into leads(name,phone,assigned_to,status) values('Bulk DNP','9192222290','-','DNP'),('Bulk New','9192222291','-','New') returning id,name,status",
  )).rows;
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
    "insert into leads(name,phone,assigned_to,status,follow_up_date,first_agent_touch_at) values('Bulk Fresh','9192222292','-','DNP','2026-11-06',now()) returning id",
  )).rows[0].id;
  const freshResult = (await db.query(
    "select public.crm_assign_leads_bulk($1::jsonb,'Fresh bulk',true,true,null) as result",
    [JSON.stringify([{ id: freshLeadId, name: "Agent B" }])],
  )).rows[0].result;
  assert.equal(Number(freshResult.assigned), 1);
  assert.deepEqual((await db.query("select assigned_to,status,follow_up_date,first_agent_touch_at from leads where id=$1", [freshLeadId])).rows[0],
    { assigned_to: "Agent B", status: "New", follow_up_date: "-", first_agent_touch_at: null },
    "Send as Fresh deliberately resets disposition and touch state");

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
    "insert into leads(name,phone,assigned_to,status) values('Bulk allowed','9192222294','-','New'),('Bulk blocked','9192222295','-','DNP') returning id,name",
  )).rows;
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
    "insert into leads(name,phone,assigned_to,status) values('Append A','9192222301','-','Follow-Up'),('Append B','9192222302','-','OPD Booked') returning id,name,status",
  )).rows;
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
    "insert into leads(name,phone,assigned_to,status,follow_up_date) values('Atomic edit','9192222310','Agent A','DNP','2026-11-07') returning id,updated_at",
  )).rows[0];
  const editedResult = (await db.query(
    "select * from public.crm_update_lead_details_admin($1,$2::jsonb,$3,false)",
    [editedLead.id, JSON.stringify({ assigned_to: "Agent B", status: "RNR", remarks: "Saved with transfer" }), editedLead.updated_at],
  )).rows[0];
  assert.deepEqual(
    { assigned_to: editedResult.assigned_to, status: editedResult.status, remarks: editedResult.remarks, follow_up_date: editedResult.follow_up_date },
    { assigned_to: "Agent B", status: "RNR", remarks: "Saved with transfer", follow_up_date: "2026-11-07" },
    "admin detail reassignment saves the edit and preserves status/follow-up in one transaction",
  );
  assert.deepEqual((await db.query("select target_names,lead_count from crm_assignment_batches where id=$1", [editedResult.assignment_batch_id])).rows[0],
    { target_names: ["Agent B"], lead_count: 1 }, "detail reassignment batch matches the saved owner");

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
    "insert into leads(name,phone,assigned_to,status,follow_up_date,first_agent_touch_at) values('Atomic fresh edit','9192222312','Agent A','DNP','2026-11-08',now()) returning id,updated_at",
  )).rows[0];
  const freshEdit = (await db.query(
    "select * from public.crm_update_lead_details_admin($1,$2::jsonb,$3,true)",
    [freshEditLead.id, JSON.stringify({ assigned_to: "Agent B" }), freshEditLead.updated_at],
  )).rows[0];
  assert.deepEqual({ status: freshEdit.status, follow_up_date: freshEdit.follow_up_date, first_agent_touch_at: freshEdit.first_agent_touch_at },
    { status: "New", follow_up_date: "-", first_agent_touch_at: null }, "Send as Fresh resets workflow only when ownership changes");

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
      [name, String(9100000000 + Object.keys(bucketIds).length), status, !['edited', 'activity'].includes(key)],
    )).rows[0].id;
  }
  const oldFreshId = (await db.query(
    "insert into leads(name,phone,assigned_to,status,assigned_at) values('Bucket old fresh','9191000000','Agent A','New',(date_trunc('day',now() at time zone 'Asia/Kolkata') - interval '1 day') at time zone 'Asia/Kolkata') returning id",
  )).rows[0].id;
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [oldFreshId])).rows[0].workflow_bucket, "fresh");
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.edited])).rows[0].workflow_bucket, "fresh");
  const initialGroups = (await db.query("select bucket,lead_count from crm_team_bucket_groups() where assigned_to='Agent A'")).rows;
  assert.ok(initialGroups.some((row) => row.bucket === "new" && Number(row.lead_count) >= 2), "today's untouched assignments are grouped as New Today");
  assert.ok(initialGroups.some((row) => row.bucket === "fresh" && Number(row.lead_count) >= 1), "untouched assignments from earlier days are grouped as Fresh");
  assert.ok(initialGroups.some((row) => row.bucket === "lost" && Number(row.lead_count) >= 1), "closed outcomes are grouped as Lost");
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  const dailyBeforeTouch = (await db.query("select crm_daily_work_counts((now() at time zone 'Asia/Kolkata')::date) x")).rows[0].x.assigned;
  await db.query("update leads set remarks='First agent edit' where id=$1", [bucketIds.edited]);
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,auth.uid(),'Note','First agent activity')", [bucketIds.activity]);
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.edited])).rows[0].workflow_bucket, "followup");
  assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds.activity])).rows[0].workflow_bucket, "followup");
  const dailyAfterTouch = (await db.query("select crm_daily_work_counts((now() at time zone 'Asia/Kolkata')::date) x")).rows[0].x.assigned;
  assert.equal(Number(dailyBeforeTouch) - Number(dailyAfterTouch), 2, "first note or field edit removes the lead from New Today");
  for (const [key, expected] of [["opdBooked", "opdBooked"], ["opdDone", "opdDone"], ["ipdBooked", "ipdBooked"], ["ipdDone", "ipdDone"]]) {
    assert.equal((await db.query("select workflow_bucket from leads where id=$1", [bucketIds[key]])).rows[0].workflow_bucket, expected);
  }
  const bucketSummary = (await db.query("select crm_lead_bucket_summary('Agent A') x")).rows[0].x;
  assert.ok(bucketSummary.fresh >= 1, "earlier untouched assignment counts as Fresh");
  assert.ok(!((await db.query("select bucket from crm_team_bucket_groups() where assigned_to='Agent A' and bucket='fresh'")).rows.length === 0), "earlier untouched lead remains in Fresh grouping");
  assert.ok(bucketSummary.followUp >= 2, "first edits and activities count as Follow-up");
  assert.ok(bucketSummary.lost >= 1, "closed outcomes are included in role-scoped lead summaries");
  assert.ok(bucketSummary.ipdBooked >= 1 && bucketSummary.ipdDone >= 1, "IPD booked and done are separate");

  // Calling outcomes keep their own status cards and do not leak into the
  // Follow-up Work continuation queue.
  const callOutcomeIds = [];
  for (const [index, status] of ["DNP", "RNR", "CallBack", "Follow-Up"].entries()) {
    callOutcomeIds.push((await db.query(
      "insert into leads(name,phone,assigned_to,status,first_agent_touch_at) values($1,$2,'Agent A',$3,now()) returning id",
      [`Bucket ${status}`, String(9100000200 + index), status],
    )).rows[0].id);
  }
  const isolatedSummary = (await db.query("select crm_lead_bucket_summary('Agent A') x")).rows[0].x;
  assert.equal(isolatedSummary.followUp, 3, "only touched New and explicit Follow-Up work enters Follow-up Work");
  assert.equal(isolatedSummary.statuses.DNP, 1);
  assert.equal(isolatedSummary.statuses.RNR, 1);
  assert.equal(isolatedSummary.statuses.CallBack, 1);
  const isolatedGroups = (await db.query("select bucket,lead_count from crm_team_bucket_groups() where assigned_to='Agent A'")).rows;
  assert.equal(Number(isolatedGroups.find((row) => row.bucket === "followup").lead_count), 3);

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

  // Reviews appear during the seven-day window; admin Keep prevents cleanup.
  await db.exec("reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';");
  const keepLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,closed_status_since) values('Review Keep','9190000001','Agent A','Not Interested',now()-interval '2 days') returning id",
  )).rows[0].id;
  await db.query("update leads set remarks='Reviewed' where id=$1", [keepLead]);
  await db.exec("alter table leads disable trigger crm_track_agent_lead_workflow");
  await db.query("update leads set closed_status_since=now()-interval '2 days' where id=$1", [keepLead]);
  await db.exec("alter table leads enable trigger crm_track_agent_lead_workflow");
  await db.query("select crm_private.daily_lost_lead_reviews()");
  const keepReview = (await db.query("select id from crm_lead_deletion_reviews where lead_id=$1", [keepLead])).rows[0].id;
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [keepLead])).rows[0].n, 1, "leads younger than seven closed days are retained");
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

  // After seven closed days, linked data is removed only after a complete
  // Recent Deletions snapshot is saved. Older duplicate snapshots are scrubbed.
  await db.exec("reset role;");
  const purgeLead = (await db.query(
    "insert into leads(name,phone,assigned_to,status,closed_status_since) values('Review Purge','9190000002','Agent A','Wrong Number',now()-interval '8 days') returning id",
  )).rows[0].id;
  await db.query("insert into lead_activities(lead_id,user_id,action_type,description) values($1,'00000000-0000-4000-8000-000000000002','Note','Private patient note')", [purgeLead]);
  await db.exec("alter table leads disable trigger crm_track_agent_lead_workflow");
  await db.query("update leads set closed_status_since=now()-interval '8 days' where id=$1", [purgeLead]);
  await db.exec("alter table leads enable trigger crm_track_agent_lead_workflow");
  const purgeAppointment = (await db.query("insert into crm_appointments(lead_id,kind,status,starts_on) values($1,'opdBooked','booked',$2) returning id", [purgeLead, today])).rows[0].id;
  await db.query("insert into lead_deletion_backups(scope,search,row_count,activity_count,lead_rows,activity_rows) values('selected','',1,1,jsonb_build_array(jsonb_build_object('id',$1::text,'name','Review Purge')),jsonb_build_array(jsonb_build_object('lead_id',$1::text,'description','Private patient note')))", [purgeLead]);
  await db.query("select crm_private.daily_lost_lead_reviews()");
  assert.equal((await db.query("select count(*)::int n from leads where id=$1", [purgeLead])).rows[0].n, 0, "unanswered due review removes lead");
  assert.equal((await db.query("select count(*)::int n from lead_activities where lead_id=$1", [purgeLead])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from crm_appointments where id=$1", [purgeAppointment])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from crm_assignment_events where lead_id=$1", [purgeLead])).rows[0].n, 0);
  const savedBackup = (await db.query("select scope,lead_rows from lead_deletion_backups where lead_rows @> jsonb_build_array(jsonb_build_object('id',$1::text))", [purgeLead])).rows;
  assert.equal(savedBackup.length, 1, "the newest recoverable snapshot survives lead deletion");
  assert.equal(savedBackup[0].scope, "Lost leads — 7-day auto-cleanup");
  assert.equal(savedBackup[0].lead_rows[0].name, "Review Purge");

  // Exercise the production-style activity policy with a second actor on one lead.
  await db.exec("reset role; drop policy fixture_activity_scope on public.lead_activities; create policy fixture_admin_activity on public.lead_activities for all to authenticated using (public.current_user_role() in ('admin','manager')) with check (public.current_user_role() in ('admin','manager')); insert into profiles(id,name,role) values ('00000000-0000-4000-8000-000000000004','Manager','manager');");
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
  await db.exec("reset role; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");
  let missingRoleDenied=false;try{await db.query('select crm_capacity()');}catch{missingRoleDenied=true;}assert.ok(missingRoleDenied,'missing profiles must not bypass admin guards');
  await db.close();
  console.log(
    "Isolated migration checks passed: CRM workflows, appointment owner RLS and reassignment, agent buckets, deletion reviews, and linked-data cleanup",
  );
})().catch(async (e) => {
  console.error(e);
  await db?.close();
  process.exitCode = 1;
});
