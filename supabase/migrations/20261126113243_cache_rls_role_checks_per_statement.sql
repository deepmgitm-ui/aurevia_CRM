-- Keep the existing access rules, but evaluate the stable viewer-role lookup
-- once per statement instead of once for every lead row scanned.
alter policy leads_admin_manager_all on public.leads
  using ((select public.current_user_role()) = any (array['admin'::public.user_role, 'manager'::public.user_role]))
  with check ((select public.current_user_role()) = any (array['admin'::public.user_role, 'manager'::public.user_role]));

alter policy leads_employee_insert on public.leads
  with check (
    (select public.current_user_role()) = 'employee'::public.user_role
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and lower(btrim(p.name)) <> all (array['', '-', 'unassigned']::text[])
        and lower(btrim(p.name)) = lower(btrim(leads.assigned_to))
    )
  );

alter policy leads_employee_select on public.leads
  using (
    (select public.current_user_role()) = 'employee'::public.user_role
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and lower(btrim(p.name)) <> all (array['', '-', 'unassigned']::text[])
        and lower(btrim(p.name)) = lower(btrim(leads.assigned_to))
    )
  );

alter policy leads_employee_update on public.leads
  using (
    (select public.current_user_role()) = 'employee'::public.user_role
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and lower(btrim(p.name)) <> all (array['', '-', 'unassigned']::text[])
        and lower(btrim(p.name)) = lower(btrim(leads.assigned_to))
    )
  )
  with check (
    (select public.current_user_role()) = 'employee'::public.user_role
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and lower(btrim(p.name)) <> all (array['', '-', 'unassigned']::text[])
        and lower(btrim(p.name)) = lower(btrim(leads.assigned_to))
    )
  );

alter policy lead_activities_admin_manager_all on public.lead_activities
  using ((select public.current_user_role()) = any (array['admin'::public.user_role, 'manager'::public.user_role]))
  with check ((select public.current_user_role()) = any (array['admin'::public.user_role, 'manager'::public.user_role]));

alter policy lead_activities_employee_insert on public.lead_activities
  with check (
    (select public.current_user_role()) = 'employee'::public.user_role
    and user_id = (select auth.uid())
    and exists (select 1 from public.leads l where l.id = lead_activities.lead_id)
  );