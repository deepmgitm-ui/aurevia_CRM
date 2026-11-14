-- Give managers the same CRM operations as admins while keeping user account
-- creation and role changes administrator-only.

-- Managers may not insert profile rows (user accounts) or change anyone's role.
do $migration$
declare
  function_definition text;
  old_fragment text := 'if new.role::text <> ''employee'' and viewer_role is distinct from ''admin'' then';
  new_fragment text := 'if viewer_role is distinct from ''admin'' then';
  replacement_count integer;
begin
  function_definition := pg_get_functiondef('public.guard_staff_identity()'::regprocedure);
  replacement_count := (length(function_definition) - length(replace(function_definition, old_fragment, ''))) / length(old_fragment);
  if replacement_count <> 1 then
    raise exception 'Expected one profile-insert privilege check, found %', replacement_count;
  end if;
  execute replace(function_definition, old_fragment, new_fragment);
end;
$migration$;

-- Split profile writes so managers can update operational profile fields but
-- cannot create/delete profile rows or change roles through the Data API.
drop policy if exists profiles_admin_manager_all on public.profiles;
create policy profiles_admin_manager_update on public.profiles
  for update to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));
create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check (public.current_user_role() = 'admin');
create policy profiles_admin_delete on public.profiles
  for delete to authenticated using (public.current_user_role() = 'admin');

-- Remove the legacy manager-only lead reassignment block. Employee edits are
-- still protected by block_employee_core_lead_update and the lead actions.
drop trigger if exists leads_manager_assignment_guard on public.leads;

-- Managers share the admin CRM data and workflow panels.
drop policy if exists crm_campaign_rules_delete_admin on public.crm_campaign_assignment_rules;
create policy crm_campaign_rules_delete_admin on public.crm_campaign_assignment_rules
  for delete to authenticated using (public.current_user_role() in ('admin', 'manager'));
drop policy if exists crm_campaign_rules_insert_admin on public.crm_campaign_assignment_rules;
create policy crm_campaign_rules_insert_admin on public.crm_campaign_assignment_rules
  for insert to authenticated with check (public.current_user_role() in ('admin', 'manager') and created_by = (select auth.uid()));
drop policy if exists crm_campaign_rules_update_admin on public.crm_campaign_assignment_rules;
create policy crm_campaign_rules_update_admin on public.crm_campaign_assignment_rules
  for update to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

drop policy if exists crm_duplicate_review_queue_admin_select on public.crm_duplicate_review_queue;
create policy crm_duplicate_review_queue_admin_select on public.crm_duplicate_review_queue
  for select to authenticated using (public.current_user_role() in ('admin', 'manager'));

drop policy if exists crm_lead_deletion_reviews_select on public.crm_lead_deletion_reviews;
create policy crm_lead_deletion_reviews_select on public.crm_lead_deletion_reviews
  for select to authenticated using (public.current_user_role() in ('admin', 'manager') or assigned_profile_id = (select auth.uid()));

drop policy if exists crm_lead_retention_archives_admin_read on public.crm_lead_retention_archives;
create policy crm_lead_retention_archives_admin_read on public.crm_lead_retention_archives
  for select to authenticated using (public.current_user_role() in ('admin', 'manager'));

drop policy if exists crm_merge_admin on public.crm_merge_history;
create policy crm_merge_admin on public.crm_merge_history
  for all to authenticated
  using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager') and actor_id = (select auth.uid()));

drop policy if exists crm_star_of_month_admin_manage on public.crm_star_of_month;
create policy crm_star_of_month_admin_manage on public.crm_star_of_month
  for all to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

drop policy if exists employee_leave_requests_select_own_or_admin on public.employee_leave_requests;
create policy employee_leave_requests_select_own_or_admin on public.employee_leave_requests
  for select to authenticated using (employee_id = (select auth.uid()) or public.current_user_role() in ('admin', 'manager'));
drop policy if exists employee_leave_requests_admin_update on public.employee_leave_requests;
create policy employee_leave_requests_admin_update on public.employee_leave_requests
  for update to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

drop policy if exists employee_weekly_offs_admin_delete on public.employee_weekly_offs;
create policy employee_weekly_offs_admin_delete on public.employee_weekly_offs
  for delete to authenticated using (public.current_user_role() in ('admin', 'manager'));
drop policy if exists employee_weekly_offs_admin_insert on public.employee_weekly_offs;
create policy employee_weekly_offs_admin_insert on public.employee_weekly_offs
  for insert to authenticated with check (public.current_user_role() in ('admin', 'manager') and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
drop policy if exists employee_weekly_offs_admin_update on public.employee_weekly_offs;
create policy employee_weekly_offs_admin_update on public.employee_weekly_offs
  for update to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager') and updated_by = (select auth.uid()));

drop policy if exists crm_runtime_admin on public.crm_runtime_settings;
create policy crm_runtime_admin on public.crm_runtime_settings
  for all to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

drop policy if exists crm_appointment_insert on public.crm_appointments;
create policy crm_appointment_insert on public.crm_appointments
  for insert to authenticated with check (public.current_user_role() in ('admin', 'manager'));
drop policy if exists crm_appointment_event_merge on public.crm_appointment_events;
create policy crm_appointment_event_merge on public.crm_appointment_events
  for update to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));
drop policy if exists crm_assignment_event_merge on public.crm_assignment_events;
create policy crm_assignment_event_merge on public.crm_assignment_events
  for update to authenticated using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- Preserve existing function bodies and validation, changing only admin-only
-- gates that guard shared CRM work. User-management actions remain untouched.
do $migration$
declare
  change record;
  function_definition text;
  replacement_count integer;
begin
  for change in
    select * from (values
      ('public.crm_activity_feed_for_actor(uuid,integer,integer)', 'if actor_role is distinct from ''admin'' then', 'if actor_role not in (''admin'', ''manager'') then'),
      ('public.crm_admin_lead_retention_reminders(integer)', 'if auth.uid() is null or (select public.current_user_role())::text <> ''admin'' then', 'if auth.uid() is null or (select public.current_user_role())::text not in (''admin'', ''manager'') then'),
      ('public.crm_admin_resolve_deletion_review(uuid,text,integer)', 'if auth.uid() is null or (select public.current_user_role())::text <> ''admin'' then', 'if auth.uid() is null or (select public.current_user_role())::text not in (''admin'', ''manager'') then'),
      ('public.crm_capacity()', 'coalesce(public.current_user_role()::text,'''')<>''admin''', 'coalesce(public.current_user_role()::text,'''') not in (''admin'',''manager'')'),
      ('public.crm_capacity_breakdown()', 'coalesce(public.current_user_role()::text, '''') <> ''admin''', 'coalesce(public.current_user_role()::text, '''') not in (''admin'', ''manager'')'),
      ('public.crm_duplicate_groups(integer)', 'coalesce(public.current_user_role()::text,'''')<>''admin''', 'coalesce(public.current_user_role()::text,'''') not in (''admin'',''manager'')'),
      ('public.crm_merge_leads(uuid,uuid,timestamptz,timestamptz,text)', 'coalesce(public.current_user_role()::text,'''')<>''admin''', 'coalesce(public.current_user_role()::text,'''') not in (''admin'',''manager'')'),
      ('public.crm_resolve_duplicate_review_items(uuid[],text,text,boolean)', 'actor_role <> ''admin''', 'actor_role not in (''admin'', ''manager'')'),
      ('public.crm_save_calendar_entry(jsonb)', 'coalesce(public.current_user_role()::text, '''') <> ''admin''', 'coalesce(public.current_user_role()::text, '''') not in (''admin'', ''manager'')'),
      ('public.crm_scheduler_status()', 'coalesce(public.current_user_role()::text,'''')<>''admin''', 'coalesce(public.current_user_role()::text,'''') not in (''admin'',''manager'')'),
      ('public.crm_transfer_assignment_batch(uuid,text,boolean)', 'if actor_role is distinct from ''admin'' then', 'if actor_role not in (''admin'', ''manager'') then')
    ) as changes(signature, old_fragment, new_fragment)
  loop
    function_definition := pg_get_functiondef(change.signature::regprocedure);
    replacement_count := (length(function_definition) - length(replace(function_definition, change.old_fragment, ''))) / length(change.old_fragment);
    if replacement_count <> 1 then
      raise exception 'Expected one role check in %, found %', change.signature, replacement_count;
    end if;
    execute replace(function_definition, change.old_fragment, change.new_fragment);
  end loop;
end;
$migration$;

-- Managers can route leads to the same existing staff roles as admins; this
-- changes lead ownership only and cannot create accounts or modify profile roles.
do $migration$
declare
  function_signature text;
  function_definition text;
  old_fragment text := '(actor_role = ''admin'' or p.role::text = ''employee'')';
  new_fragment text := '(actor_role in (''admin'', ''manager'') or p.role::text = ''employee'')';
  replacement_count integer;
begin
  foreach function_signature in array array[
    'public.crm_assign_leads_bulk(jsonb,text,boolean,boolean,uuid)',
    'public.crm_add_leads_to_assignment_batch(uuid,jsonb)',
    'public.crm_update_lead_details_admin(uuid,jsonb,timestamp with time zone,boolean)',
    'public.crm_resolve_duplicate_review_items(uuid[],text,text,boolean)'
  ] loop
    function_definition := pg_get_functiondef(function_signature::regprocedure);
    replacement_count := (length(function_definition) - length(replace(function_definition, old_fragment, ''))) / length(old_fragment);
    if replacement_count < 1 then
      raise exception 'Expected a team-target guard in %, found %', function_signature, replacement_count;
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end loop;
end;
$migration$;
