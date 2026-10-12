/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS PostgreSQL verification. */
const {
  PGlite,
} = require("../.crm-verification/node_modules/@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
let db;
(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema crm_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,name text,role text);
 insert into profiles values('00000000-0000-4000-8000-000000000001','Admin','admin'),('00000000-0000-4000-8000-000000000002','Agent A','employee'),('00000000-0000-4000-8000-000000000003','Agent B','employee');
 create function public.current_user_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid()$$;
 grant usage on schema public,auth to authenticated;grant select on profiles to authenticated;`);
  const file = fs
    .readdirSync("supabase/migrations")
    .find((file) => file.endsWith("_team_activity_presence.sql"));
  await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  for(const fix of fs.readdirSync("supabase/migrations").filter(file=>file.endsWith("_team_activity_tab_signal.sql")).sort()) await db.exec(fs.readFileSync("supabase/migrations/"+fix,"utf8"));
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'`,
  );
  await db.query("select crm_activity_heartbeat(true)");
  let roster = (await db.query("select * from crm_activity_roster()")).rows;
  assert.equal(roster.length, 1, "employees see only themselves");
  assert.equal(roster[0].name, "Agent A");
  assert.equal(roster[0].online_seconds, 0);
  await db.query("select crm_activity_heartbeat(true)");
  assert.equal(
    (await db.query("select count(*)::int n from crm_user_activity")).rows[0].n,
    1,
    "duplicate tabs use one daily row",
  );
  await assert.rejects(
    db.query("update crm_user_activity set active_seconds=8000"),
    "duration is not client writable",
  );
  await assert.rejects(
    db.query(
      `insert into crm_user_activity(user_id,activity_signal) values('00000000-0000-4000-8000-000000000003',true)`,
    ),
    "another identity cannot be supplied",
  );
  // Arrange timestamps as the isolated database owner, then exercise the real invoker RPC.
  await db.exec(
    "reset role;alter table crm_user_activity disable trigger crm_activity_stamp",
  );
  await db.exec(
    `update crm_user_activity set last_seen=clock_timestamp()-interval '60 seconds',last_active=clock_timestamp()-interval '60 seconds';alter table crm_user_activity enable trigger crm_activity_stamp;set role authenticated;`,
  );
  await db.query("select crm_activity_heartbeat(false)");
  roster = (await db.query("select * from crm_activity_roster()")).rows;
  assert.ok(roster[0].online_seconds >= 60 && roster[0].online_seconds <= 62);
  assert.equal(
    roster[0].active_seconds,
    roster[0].online_seconds,
    "recent interaction receives bounded active credit",
  );
  const credited = roster[0].active_seconds;
  await db.exec("reset role;alter table crm_user_activity disable trigger crm_activity_stamp;update crm_user_activity set last_seen=clock_timestamp()-interval '1 second',last_active=clock_timestamp()-interval '6 minutes';alter table crm_user_activity enable trigger crm_activity_stamp;set role authenticated;");
  await db.query('select crm_activity_heartbeat(true)');
  roster=(await db.query('select * from crm_activity_roster()')).rows;
  assert.ok(Date.now()-roster[0].last_active.getTime()<5000,'fresh active tab overrides an idle-tab signal');
  assert.equal(roster[0].active_seconds,credited,'signal-only updates do not double-count');
  assert.equal(roster[0].online_seconds,credited);

  await db.exec(
    `reset role;alter table crm_user_activity disable trigger crm_activity_stamp;update crm_user_activity set last_seen=clock_timestamp()-interval '10 minutes',last_active=clock_timestamp()-interval '10 minutes';alter table crm_user_activity enable trigger crm_activity_stamp;set role authenticated;`,
  );
  await db.query("select crm_activity_heartbeat(false)");
  roster = (await db.query("select * from crm_activity_roster()")).rows;
  assert.equal(
    roster[0].active_seconds,
    credited,
    "closed-tab/sleep gaps are not credited",
  );
  assert.equal(roster[0].online_seconds, credited);
  assert.ok(
    Date.now() - roster[0].session_started_at.getTime() < 5000,
    "long gaps start a new session",
  );
  await db.exec(
    `set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003'`,
  );
  assert.equal(
    (await db.query("select count(*)::int n from crm_user_activity")).rows[0].n,
    0,
    "other users cannot read daily tracking",
  );
  await db.exec(
    `set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'`,
  );
  assert.equal(
    (await db.query("select * from crm_activity_roster()")).rows.length,
    3,
    "admin sees whole roster including offline users",
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select crm_activity_heartbeat(true)"),
    "anonymous tracking is blocked",
  );
  await assert.rejects(
    db.query("select * from crm_activity_roster()"),
    "anonymous roster is blocked",
  );
  await db.close();
  console.log(
    "Team activity passed: own identity, server durations, tab deduplication, network gaps, session restart, roster permissions and anonymous denial.",
  );
})().catch(async (error) => {
  console.error(error.message);
  await db?.close();
  process.exitCode = 1;
});
