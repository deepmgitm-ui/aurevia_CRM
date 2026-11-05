-- Stored generated columns are not populated on NEW inside a BEFORE trigger.
-- Ignore their transient NULL values when comparing protected columns.
create or replace function public.block_employee_core_lead_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if public.current_user_role()::text = 'employee' and (
    (to_jsonb(new) - array[
      'name', 'phone', 'email', 'gender', 'city', 'disease',
      'insurance_status', 'remarks', 'status', 'temperature',
      'lead_date', 'follow_up_date', 'opd_booked_date',
      'opd_done_date', 'ipd_done_date', 'updated_at',
      'lead_day', 'follow_up_day', 'treatment_key'
    ]) is distinct from
    (to_jsonb(old) - array[
      'name', 'phone', 'email', 'gender', 'city', 'disease',
      'insurance_status', 'remarks', 'status', 'temperature',
      'lead_date', 'follow_up_date', 'opd_booked_date',
      'opd_done_date', 'ipd_done_date', 'updated_at',
      'lead_day', 'follow_up_day', 'treatment_key'
    ])
  ) then
    raise exception 'Patient details updated; assignment and source are managed by admins and managers.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;
