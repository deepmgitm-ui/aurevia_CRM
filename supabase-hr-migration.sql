-- Aurevia CRM — optional HR + Attendance migration.
-- Idempotent: every statement can be re-run safely.
--
-- The dashboard works without this file — the Agent detail panel simply shows
-- "—" for the HR fields until the columns exist, and the secure directory query
-- falls back to the three base columns automatically.

-- ---------------------------------------------------------------------------
-- 1. HR fields on public.profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists gender text,
  add column if not exists blood_group text,
  add column if not exists emergency_contact text,
  add column if not exists manager_name text,
  add column if not exists photo_url text;

comment on column public.profiles.phone is 'HR: contact number shown in the admin Agent detail panel.';
comment on column public.profiles.email is 'HR: email id shown in the admin Agent detail panel.';
comment on column public.profiles.blood_group is 'HR: blood group.';
comment on column public.profiles.emergency_contact is 'HR: emergency contact number.';
comment on column public.profiles.manager_name is 'HR: assigned manager (free text, matches profiles.name).';
comment on column public.profiles.photo_url is 'HR: uploaded photo URL (Supabase Storage public URL).';

-- ---------------------------------------------------------------------------
-- 2. Attendance register
-- ---------------------------------------------------------------------------
do $$
begin
  create type public.attendance_status as enum ('Present', 'Absent', 'Half-Day');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null,
  status public.attendance_status not null default 'Present',
  marked_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

-- Check-in / check-out wall-clock times, plus the flag that says "this row came
-- from a sign-in, not from a manager marking the register by hand".
alter table public.attendance
  add column if not exists check_in_at timestamptz,
  add column if not exists check_out_at timestamptz,
  add column if not exists auto_marked boolean not null default false;

comment on column public.attendance.check_in_at is
  'Set once, on the employee''s first sign-in of that clinic day.';
comment on column public.attendance.auto_marked is
  'true when the row was created by a sign-in rather than by a manager.';

-- Rows created before this migration were manager entries; their created_at is
-- the best available stand-in for a check-in time.
update public.attendance
set check_in_at = created_at
where check_in_at is null and auto_marked = false;

drop trigger if exists attendance_set_updated_at on public.attendance;
create trigger attendance_set_updated_at
before update on public.attendance
for each row execute function public.set_updated_at();

alter table public.attendance enable row level security;

-- Role-based logic: employees can VIEW only their own attendance row; admins
-- and managers can view and EDIT everyone's.
--
-- Signing in IS the check-in, so an employee needs write access to their OWN
-- row. The policy is deliberately narrow: today only, always 'Present', always
-- auto_marked. A self-service mark can therefore never write "Absent" over a
-- real day, nor back-fill yesterday, nor touch a colleague's row.
drop policy if exists attendance_self_check_in on public.attendance;
create policy attendance_self_check_in
on public.attendance for insert
to authenticated
with check (
  employee_id = auth.uid()
  and attendance_date = (now() at time zone 'Asia/Kolkata')::date
  and status = 'Present'
  and auto_marked
);

-- Employees may correct their own check-in TIME on an auto-marked row (a
-- sign-in that happened at the wrong moment). Status and note stay admin-only.
drop policy if exists attendance_self_update_check_in on public.attendance;
create policy attendance_self_update_check_in
on public.attendance for update
to authenticated
using (employee_id = auth.uid() and auto_marked)
with check (employee_id = auth.uid() and auto_marked);

-- CHANGE / MODIFY / DELETE: admin + manager only. The self-service policies
-- above deliberately do not grant delete, so an employee can never erase their
-- own attendance — only a manager can.
drop policy if exists attendance_admin_manager_write on public.attendance;
create policy attendance_admin_manager_write
on public.attendance for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

create index if not exists attendance_date_idx on public.attendance (attendance_date desc);
create index if not exists attendance_employee_date_idx
  on public.attendance (employee_id, attendance_date desc);
