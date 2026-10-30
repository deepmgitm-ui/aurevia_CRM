-- Aggregate-only capacity report. The function does not expose object names,
-- patient data, or private profile details to the caller.
create or replace function public.crm_capacity_breakdown()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  file_bytes numeric;
  missing_sizes bigint;
begin
  if auth.uid() is null or coalesce(public.current_user_role()::text, '') <> 'admin' then
    raise exception 'Admin access required';
  end if;
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end), 0),
         count(*) filter (where metadata->>'size' is null or metadata->>'size' !~ '^[0-9]+$')
    into file_bytes, missing_sizes from storage.objects;
  return jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'storageBytes', case when missing_sizes = 0 then file_bytes else null end,
    'leads', (select count(*) from public.leads),
    'staff', (select count(*) from public.profiles),
    'leadBytes', pg_total_relation_size('public.leads'::regclass),
    'activityBytes', pg_total_relation_size('public.lead_activities'::regclass),
    'assignmentBytes', pg_total_relation_size('public.crm_assignment_events'::regclass),
    'userBytes', pg_total_relation_size('public.profiles'::regclass)
      + pg_total_relation_size('public.employee_private_profiles'::regclass)
      + pg_total_relation_size('auth.users'::regclass),
    'appointments', (select count(*) from public.crm_appointments)
  );
end;
$function$;
revoke all on function public.crm_capacity_breakdown() from public, anon;
grant execute on function public.crm_capacity_breakdown() to authenticated;
