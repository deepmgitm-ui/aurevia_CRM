-- Cache request identity and role checks once per statement instead of once
-- per candidate row. Authorization conditions remain unchanged.
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_authenticated') then
    execute 'alter policy profiles_select_authenticated on public.profiles using ((select auth.uid()) is not null)';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_admin_manager_all') then
    execute 'alter policy profiles_admin_manager_all on public.profiles using ((select public.current_user_role())::text in (''admin'', ''manager'')) with check ((select public.current_user_role())::text in (''admin'', ''manager''))';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='calendar_events' and policyname='calendar_events_delete_own') then
    execute 'alter policy calendar_events_delete_own on public.calendar_events using ((select auth.uid()) = owner_id)';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='calendar_events' and policyname='calendar_events_insert_own') then
    execute 'alter policy calendar_events_insert_own on public.calendar_events with check ((select auth.uid()) = owner_id)';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='calendar_events' and policyname='calendar_events_select_own') then
    execute 'alter policy calendar_events_select_own on public.calendar_events using ((select auth.uid()) = owner_id)';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='calendar_events' and policyname='calendar_events_update_own') then
    execute 'alter policy calendar_events_update_own on public.calendar_events using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='attendance' and policyname='attendance_admin_manager_write') then
    execute 'alter policy attendance_admin_manager_write on public.attendance using ((select public.current_user_role())::text in (''admin'', ''manager'')) with check ((select public.current_user_role())::text in (''admin'', ''manager''))';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='attendance' and policyname='attendance_select_own_or_admin') then
    execute 'alter policy attendance_select_own_or_admin on public.attendance using (employee_id = (select auth.uid()) or (select public.current_user_role())::text in (''admin'', ''manager''))';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='attendance' and policyname='attendance_select_own_or_manage') then
    execute 'alter policy attendance_select_own_or_manage on public.attendance using (employee_id = (select auth.uid()) or (select public.current_user_role())::text in (''admin'', ''manager''))';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='attendance' and policyname='attendance_self_check_in') then
    execute 'alter policy attendance_self_check_in on public.attendance with check (employee_id = (select auth.uid()) and attendance_date = ((now() at time zone ''Asia/Kolkata''))::date and status::text = ''Present'' and auto_marked)';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_requests' and policyname='attendance_requests_admin_manager_update') then
    execute 'alter policy attendance_requests_admin_manager_update on public.attendance_requests using ((select public.current_user_role())::text in (''admin'', ''manager'')) with check ((select public.current_user_role())::text in (''admin'', ''manager''))';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_requests' and policyname='attendance_requests_employee_insert') then
    execute 'alter policy attendance_requests_employee_insert on public.attendance_requests with check (employee_id = (select auth.uid()) and status = ''Pending'' and reviewed_by is null and reviewed_at is null and attendance_date < ((now() at time zone ''Asia/Kolkata''))::date)';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_requests' and policyname='attendance_requests_select_own_or_manage') then
    execute 'alter policy attendance_requests_select_own_or_manage on public.attendance_requests using (employee_id = (select auth.uid()) or (select public.current_user_role())::text in (''admin'', ''manager''))';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='crm_merge_history' and policyname='crm_merge_admin') then
    execute 'alter policy crm_merge_admin on public.crm_merge_history using ((select public.current_user_role())::text = ''admin'') with check ((select public.current_user_role())::text = ''admin'' and actor_id = (select auth.uid()))';
  end if;
end;
$$;
