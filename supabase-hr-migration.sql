-- Aurevia CRM — optional HR + Attendance migration.
-- Idempotent: every statement can be re-run safely.
--
-- The dashboard works without this file — the Agent detail panel simply shows
-- "—" for the HR fields until the columns exist, and the secure directory query
-- falls back to the three base columns automatically.

-- ---------------------------------------------------------------------------
-- 1. Private HR fields. They live separately so RLS can restrict entire rows.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_private_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  phone text,
  email text,
  gender text,
  blood_group text,
  emergency_contact text,
  manager_name text,
  photo_url text
);

alter table public.employee_private_profiles enable row level security;
revoke all on public.employee_private_profiles from public, anon, authenticated;
grant select on public.employee_private_profiles to authenticated;
drop policy if exists employee_private_profiles_read on public.employee_private_profiles;
create policy employee_private_profiles_read
on public.employee_private_profiles for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.current_user_role())::text in ('admin', 'manager')
);

-- Existing CRM installs already have HR columns. Copy their values before the
-- application migration removes those columns; fresh installs skip this block.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'emergency_contact'
  ) then
    execute $copy$
      insert into public.employee_private_profiles (
        id, phone, email, gender, blood_group, emergency_contact, manager_name, photo_url
      )
      select id, phone, email, gender, blood_group, emergency_contact, manager_name, photo_url
      from public.profiles
      on conflict (id) do update set
        phone = excluded.phone, email = excluded.email, gender = excluded.gender,
        blood_group = excluded.blood_group, emergency_contact = excluded.emergency_contact,
        manager_name = excluded.manager_name, photo_url = excluded.photo_url
    $copy$;
  end if;
end;
$$;

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
-- and managers can view and EDIT everyone's. Employees cannot update their
-- own rows, including automatically recorded check-ins.
drop policy if exists attendance_select_own_or_manage on public.attendance;
create policy attendance_select_own_or_manage
on public.attendance for select
to authenticated
using (
  employee_id = auth.uid()
  or public.current_user_role() in ('admin', 'manager')
);

--
-- Signing in IS the check-in, so an employee needs write access to their OWN
-- row. This policy grants INSERT only: today, always 'Present', always
-- auto_marked.
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

drop policy if exists attendance_self_update_check_in on public.attendance;

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
