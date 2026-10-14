-- Add lookup indexes for foreign keys used by joins and cascades. Guards keep
-- the migration compatible with isolated test fixtures that omit legacy
-- tables; all listed tables and columns exist in the deployed CRM database.
do $$
begin
  if to_regclass('public.attendance') is not null then
    execute 'create index if not exists attendance_marked_by_idx on public.attendance(marked_by)';
  end if;
  if to_regclass('public.attendance_requests') is not null then
    execute 'create index if not exists attendance_requests_reviewed_by_idx on public.attendance_requests(reviewed_by)';
  end if;
  if to_regclass('public.crm_appointment_events') is not null then
    execute 'create index if not exists crm_appointment_events_appointment_id_idx on public.crm_appointment_events(appointment_id)';
    execute 'create index if not exists crm_appointment_events_lead_id_idx on public.crm_appointment_events(lead_id)';
  end if;
  if to_regclass('public.crm_appointments') is not null then
    execute 'create index if not exists crm_appointments_assigned_profile_id_idx on public.crm_appointments(assigned_profile_id)';
    execute 'create index if not exists crm_appointments_created_by_idx on public.crm_appointments(created_by)';
    execute 'create index if not exists crm_appointments_performed_by_idx on public.crm_appointments(performed_by)';
  end if;
  if to_regclass('public.crm_assignment_events') is not null then
    execute 'create index if not exists crm_assignment_events_actor_id_idx on public.crm_assignment_events(actor_id)';
    execute 'create index if not exists crm_assignment_events_assigned_profile_id_idx on public.crm_assignment_events(assigned_profile_id)';
    execute 'create index if not exists crm_assignment_events_lead_id_idx on public.crm_assignment_events(lead_id)';
  end if;
  if to_regclass('public.crm_automation_runs') is not null then
    execute 'create index if not exists crm_automation_runs_run_by_idx on public.crm_automation_runs(run_by)';
  end if;
  if to_regclass('public.crm_merge_history') is not null then
    execute 'create index if not exists crm_merge_history_actor_id_idx on public.crm_merge_history(actor_id)';
  end if;
  if to_regclass('public.lead_deletion_backups') is not null then
    execute 'create index if not exists lead_deletion_backups_deleted_by_idx on public.lead_deletion_backups(deleted_by)';
  end if;
end;
$$;
