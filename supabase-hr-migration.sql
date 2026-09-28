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

alter table public.attendance enable row level security;

-- Role-based logic: employees can VIEW only their own attendance row; admins
-- and managers can view and EDIT everyone's.
drop policy if exists attendance_select_own_or_admin on public.attendance;
create policy attendance_select_own_or_admin
on public.attendance for select
to authenticated
using (
  employee_id = auth.uid()
  or public.current_user_role() in ('admin', 'manager')
);

drop policy if exists attendance_admin_manager_write on public.attendance;
create policy attendance_admin_manager_write
on public.attendance for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

create index if not exists attendance_date_idx on public.attendance (attendance_date desc);
