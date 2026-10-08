-- Employee requests for a missed sign-in, reviewed by an admin or manager.
-- Idempotent: safe to run more than once.

create table if not exists public.attendance_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null,
  reason text not null default '' check (char_length(reason) <= 1000),
  status text not null default 'Pending'
    check (status in ('Pending', 'Approved', 'Rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 1000)
);

create unique index if not exists attendance_requests_one_pending_per_day_idx
  on public.attendance_requests (employee_id, attendance_date)
  where status = 'Pending';
create index if not exists attendance_requests_created_at_idx
  on public.attendance_requests (created_at desc);

alter table public.attendance_requests enable row level security;

drop policy if exists attendance_requests_select_own_or_manage on public.attendance_requests;
create policy attendance_requests_select_own_or_manage
on public.attendance_requests for select
to authenticated
using (
  employee_id = auth.uid()
  or public.current_user_role() in ('admin', 'manager')
);

drop policy if exists attendance_requests_employee_insert on public.attendance_requests;
create policy attendance_requests_employee_insert
on public.attendance_requests for insert
to authenticated
with check (
  employee_id = auth.uid()
  and status = 'Pending'
  and reviewed_by is null
  and reviewed_at is null
  and attendance_date < (now() at time zone 'Asia/Kolkata')::date
);

drop policy if exists attendance_requests_admin_manager_update on public.attendance_requests;
create policy attendance_requests_admin_manager_update
on public.attendance_requests for update
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

create or replace function public.review_attendance_request(
  p_request_id uuid,
  p_approved boolean,
  p_review_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  request_row public.attendance_requests%rowtype;
begin
  if auth.uid() is null
    or public.current_user_role() not in ('admin', 'manager') then
    raise exception 'Only an admin or manager can review attendance requests.';
  end if;

  if p_review_note is not null and char_length(trim(p_review_note)) > 1000 then
    raise exception 'Review note must be 1,000 characters or fewer.';
  end if;

  select *
    into request_row
    from public.attendance_requests
    where id = p_request_id
    for update;

  if not found then
    raise exception 'Attendance request not found.';
  end if;
  if request_row.status <> 'Pending' then
    raise exception 'This attendance request has already been reviewed.';
  end if;

  if p_approved then
    if exists (
      select 1 from public.attendance
      where employee_id = request_row.employee_id
        and attendance_date = request_row.attendance_date
    ) then
      raise exception 'Attendance is already recorded for that date.';
    end if;

    insert into public.attendance (
      employee_id,
      attendance_date,
      status,
      marked_by,
      note,
      auto_marked
    ) values (
      request_row.employee_id,
      request_row.attendance_date,
      'Present',
      auth.uid(),
      concat(
        'Missed sign-in request approved',
        case when request_row.reason = '' then '' else ': ' || request_row.reason end
      ),
      false
    );
  end if;

  update public.attendance_requests
    set status = case when p_approved then 'Approved' else 'Rejected' end,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = coalesce(trim(p_review_note), '')
    where id = request_row.id;

  return request_row.id;
end;
$$;

revoke all on function public.review_attendance_request(uuid, boolean, text) from public;
grant execute on function public.review_attendance_request(uuid, boolean, text) to authenticated;
