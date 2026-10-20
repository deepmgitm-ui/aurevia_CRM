-- Both existing SELECT policies on attendance have identical predicates.
-- Keep attendance_select_own_or_manage as the single effective policy.
drop policy if exists attendance_select_own_or_admin on public.attendance;
