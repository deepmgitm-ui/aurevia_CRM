-- Aurevia CRM — personal planner table for "Plan your calendar".
--
-- ONE TABLE, ONE PROMISE: calendar_events holds ONLY the signed-in user's own
-- notes/calls/visits/leaves (owner_id = auth.uid()). Lead reminders are NOT
-- copied here — they are read live from leads.follow_up_date instead, so the
-- two can never drift out of sync.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste → Run. Safe to re-run
-- (IF NOT EXISTS everywhere; existing rows are untouched).

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_date date not null,
  title text not null,
  kind text not null default 'note'
    check (kind in ('note', 'call', 'visit', 'leave')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists calendar_events_owner_date_idx
  on public.calendar_events (owner_id, event_date);

-- RLS: a user reads/writes ONLY their own rows. The owner_id = auth.uid()
-- check runs inside every policy, so even a crafted client query can never
-- touch another person's events.
alter table public.calendar_events enable row level security;

drop policy if exists calendar_events_select_own on public.calendar_events;
create policy calendar_events_select_own on public.calendar_events
  for select using (auth.uid() = owner_id);

drop policy if exists calendar_events_insert_own on public.calendar_events;
create policy calendar_events_insert_own on public.calendar_events
  for insert with check (auth.uid() = owner_id);

drop policy if exists calendar_events_update_own on public.calendar_events;
create policy calendar_events_update_own on public.calendar_events
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists calendar_events_delete_own on public.calendar_events;
create policy calendar_events_delete_own on public.calendar_events
  for delete using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Timeline lanes need employees to READ the activity history of the leads that
-- are assigned to them (notes, status changes, follow-up done). Admins/managers
-- already have full read via lead_activities_admin_manager_all in the base
-- schema; this closes the gap for employees — scoped to their own leads only.
-- ---------------------------------------------------------------------------
drop policy if exists lead_activities_employee_select_own on public.lead_activities;
create policy lead_activities_employee_select_own on public.lead_activities
  for select to authenticated
  using (
    public.current_user_role() = 'employee'
    and exists (
      select 1
      from public.leads
      where public.leads.id = lead_activities.lead_id
        and public.leads.assigned_to = (select name from public.profiles where id = auth.uid())
    )
  );