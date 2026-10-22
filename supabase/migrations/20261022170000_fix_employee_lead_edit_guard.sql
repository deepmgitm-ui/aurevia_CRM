-- Generated columns are not populated in NEW during BEFORE UPDATE triggers.
-- Exclude workflow_bucket from the protected-field comparison so employee
-- edits to allowed lead details and remarks are not rejected as assignment
-- or source changes.
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
      'lead_day', 'follow_up_day', 'treatment_key', 'workflow_bucket'
    ]) is distinct from
    (to_jsonb(old) - array[
      'name', 'phone', 'email', 'gender', 'city', 'disease',
      'insurance_status', 'remarks', 'status', 'temperature',
      'lead_date', 'follow_up_date', 'opd_booked_date',
      'opd_done_date', 'ipd_done_date', 'updated_at',
      'lead_day', 'follow_up_day', 'treatment_key', 'workflow_bucket'
    ])
  ) then
    raise exception 'You can update lead details and notes. Assignment and source can only be changed by admins and managers.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;
