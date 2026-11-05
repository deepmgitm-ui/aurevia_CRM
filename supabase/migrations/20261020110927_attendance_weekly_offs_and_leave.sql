-- Rotating employee days off and approved leave are schedule records, not
-- attendance marks. They therefore never create or overwrite lead data.

create table if not exists public.employee_weekly_offs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  week_start_date date not null,
  off_date date not null,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_weekly_offs_monday_start check (
    week_start_date = off_date - (extract(isodow from off_date)::integer - 1)
  ),
  constraint employee_weekly_offs_one_per_week unique (employee_id, week_start_date)
);

create index if not exists employee_weekly_offs_date_idx
  on public.employee_weekly_offs (off_date, employee_id);

alter table public.employee_weekly_offs enable row level security;
revoke all on public.employee_weekly_offs from public, anon, authenticated;
grant select, insert, update, delete on public.employee_weekly_offs to authenticated;

drop policy if exists employee_weekly_offs_select_own_or_manage on public.employee_weekly_offs;
create policy employee_weekly_offs_select_own_or_manage
on public.employee_weekly_offs for select to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.current_user_role())::text in ('admin', 'manager')
);

drop policy if exists employee_weekly_offs_admin_insert on public.employee_weekly_offs;
create policy employee_weekly_offs_admin_insert
on public.employee_weekly_offs for insert to authenticated
with check (
  (select public.current_user_role())::text = 'admin'
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists employee_weekly_offs_admin_update on public.employee_weekly_offs;
create policy employee_weekly_offs_admin_update
on public.employee_weekly_offs for update to authenticated
using ((select public.current_user_role())::text = 'admin')
with check (
  (select public.current_user_role())::text = 'admin'
  and updated_by = (select auth.uid())
);

drop policy if exists employee_weekly_offs_admin_delete on public.employee_weekly_offs;
create policy employee_weekly_offs_admin_delete
on public.employee_weekly_offs for delete to authenticated
using ((select public.current_user_role())::text = 'admin');

create table if not exists public.employee_leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  leave_type text not null check (leave_type in ('Casual', 'Sick', 'Paid', 'Unpaid', 'Other')),
  duration text not null default 'full_day' check (duration in ('full_day', 'half_day')),
  reason text not null default '' check (char_length(reason) <= 1000),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 1000),
  constraint employee_leave_requests_valid_dates check (start_date <= end_date),
  constraint employee_leave_requests_half_day_one_date check (duration <> 'half_day' or start_date = end_date)
);

create index if not exists employee_leave_requests_employee_dates_idx
  on public.employee_leave_requests (employee_id, start_date, end_date);
create index if not exists employee_leave_requests_pending_idx
  on public.employee_leave_requests (created_at desc)
  where status = 'Pending';

alter table public.employee_leave_requests enable row level security;
revoke all on public.employee_leave_requests from public, anon, authenticated;
grant select, insert, update on public.employee_leave_requests to authenticated;

drop policy if exists employee_leave_requests_select_own_or_admin on public.employee_leave_requests;
create policy employee_leave_requests_select_own_or_admin
on public.employee_leave_requests for select to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.current_user_role())::text = 'admin'
);

drop policy if exists employee_leave_requests_employee_insert on public.employee_leave_requests;
create policy employee_leave_requests_employee_insert
on public.employee_leave_requests for insert to authenticated
with check (
  employee_id = (select auth.uid())
  and status = 'Pending'
  and reviewed_by is null
  and reviewed_at is null
  and start_date >= ((now() at time zone 'Asia/Kolkata')::date)
);

drop policy if exists employee_leave_requests_admin_update on public.employee_leave_requests;
create policy employee_leave_requests_admin_update
on public.employee_leave_requests for update to authenticated
using ((select public.current_user_role())::text = 'admin')
with check ((select public.current_user_role())::text = 'admin');

-- Serialize requests for one employee before checking date-range overlap, so
-- two simultaneous submissions cannot reserve overlapping pending/approved leave.
create or replace function public.guard_employee_leave_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform 1 from public.profiles where id = new.employee_id for update;
  if not found then raise exception 'The employee profile could not be found.'; end if;

  if exists (
    select 1
    from public.employee_leave_requests existing
    where existing.employee_id = new.employee_id
      and existing.id is distinct from new.id
      and existing.status in ('Pending', 'Approved')
      and existing.start_date <= new.end_date
      and existing.end_date >= new.start_date
  ) then
    raise exception 'These dates overlap an existing pending or approved leave request.';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_employee_leave_request() from public, anon, authenticated;
drop trigger if exists employee_leave_requests_guard_overlap on public.employee_leave_requests;
create trigger employee_leave_requests_guard_overlap
before insert or update of employee_id, start_date, end_date, status
on public.employee_leave_requests
for each row execute function public.guard_employee_leave_request();

-- Absent is a deliberate attendance mark. It cannot coexist with a scheduled
-- weekly off or approved leave; a Present sign-in on those dates remains valid
-- and can be reviewed as worked time by the admin.
create or replace function public.prevent_absent_on_scheduled_off_or_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status::text = 'Absent' and (
    exists (
      select 1 from public.employee_weekly_offs o
      where o.employee_id = new.employee_id and o.off_date = new.attendance_date
    )
    or exists (
      select 1 from public.employee_leave_requests l
      where l.employee_id = new.employee_id
        and l.status = 'Approved'
        and l.start_date <= new.attendance_date
        and l.end_date >= new.attendance_date
    )
  ) then
    raise exception 'This date is a scheduled weekly off or approved leave. Remove or change it before marking Absent.';
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_absent_on_scheduled_off_or_leave() from public, anon, authenticated;

-- Some isolated migration checks omit the base attendance table. Install the
-- trigger whenever the app's existing attendance table is present.
do $block$
begin
  if to_regclass('public.attendance') is not null then
    execute 'drop trigger if exists attendance_prevent_absent_on_scheduled_off_or_leave on public.attendance';
    execute 'create trigger attendance_prevent_absent_on_scheduled_off_or_leave
      before insert or update of status, employee_id, attendance_date
      on public.attendance
      for each row execute function public.prevent_absent_on_scheduled_off_or_leave()';
  end if;
end;
$block$;
