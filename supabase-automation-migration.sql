-- Aurevia CRM — workflow automation rules.
-- Idempotent: every statement can be re-run safely.
--
-- WHY: simple "if this happens, do that" rules (welcome new leads, nudge stale
-- leads, escalate overdue follow-ups, balance the workload, congratulate on
-- surgery) run with ONE click from Settings -> Automation — or on a schedule
-- once CRON_SECRET is set and the /api/automation/run route is called by a
-- cron job. Every run writes a receipt row to crm_automation_runs, so an admin
-- can always see what the robot did and undo nothing (it only ever touches
-- status, temperature, assigned_to and follow_up_date — NEVER deletes).
--
-- ---------------------------------------------------------------------------
-- crm_automation_rules: admin-defined rules, one row each.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_automation_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null default '',
  kind text not null default '',
  stage text not null default '',
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_run_summary text not null default '',
  created_at timestamptz not null default now()
);

alter table public.crm_automation_rules enable row level security;

drop policy if exists crm_automation_rules_select_all on public.crm_automation_rules;
create policy crm_automation_rules_select_all
on public.crm_automation_rules for select
to authenticated
using (true);

drop policy if exists crm_automation_rules_write_admin_manager on public.crm_automation_rules;
create policy crm_automation_rules_write_admin_manager
on public.crm_automation_rules for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

insert into public.crm_automation_rules (key, label, kind, stage) values
  ('welcome', 'Welcome new leads (New + Warm + follow-up tomorrow)', 'welcome', 'new'),
  ('nudge', 'Nudge cooling leads (Warm, inactive 7+ days)', 'nudge', 'contacted'),
  ('overdue', 'Escalate overdue follow-ups (Hot temperature)', 'overdue', 'contacted'),
  ('balance', 'Balance workload (auto-assign unassigned)', 'balance', 'new'),
  ('celebrate', 'Celebrate surgery wins (Surgery Completed)', 'celebrate', 'surgery')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- crm_automation_runs: one receipt row per rule execution.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null default '',
  run_by uuid references public.profiles(id) on delete set null,
  run_by_name text not null default '-',
  affected integer not null default 0,
  detail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.crm_automation_runs enable row level security;

drop policy if exists crm_automation_runs_select_team on public.crm_automation_runs;
create policy crm_automation_runs_select_team
on public.crm_automation_runs for select
to authenticated
using (public.current_user_role() in ('admin', 'manager'));

drop policy if exists crm_automation_runs_insert_team on public.crm_automation_runs;
create policy crm_automation_runs_insert_team
on public.crm_automation_runs for insert
to authenticated
with check (public.current_user_role() in ('admin', 'manager'));

create index if not exists crm_automation_runs_rule_idx
  on public.crm_automation_runs (rule_key, created_at desc);

comment on table public.crm_automation_rules is
  'If-this-then-that rules run from Settings -> Automation (or the cron route).';
comment on table public.crm_automation_runs is
  'Receipt ledger of every automation run: what changed, when, and by whom.';
