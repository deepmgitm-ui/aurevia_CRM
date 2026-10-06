-- Run after supabase-hr-migration.sql has created public.attendance.
-- Employees can read only their own rows; admins/managers can read the team.
drop policy if exists attendance_select_own_or_manage on public.attendance;
create policy attendance_select_own_or_manage
on public.attendance for select
to authenticated
using (
  employee_id = auth.uid()
  or public.current_user_role() in ('admin', 'manager')
);

-- Remove employee UPDATE access to their own auto-recorded attendance.
-- Attendance INSERT on sign-in and admin/manager write access remain unchanged.
drop policy if exists attendance_self_update_check_in on public.attendance;
