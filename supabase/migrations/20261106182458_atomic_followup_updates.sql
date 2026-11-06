-- Keep the follow-up date and its timeline entry in one transaction.
create or replace function public.crm_update_task_follow_up(
  p_lead uuid,
  p_action text,
  p_follow_up date default null,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  activity_type text;
  activity_description text;
  updated_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_action is null or p_action not in ('complete', 'reschedule') then raise exception 'Invalid follow-up action'; end if;
  if p_action = 'reschedule' and p_follow_up is null then raise exception 'Choose a valid follow-up date'; end if;
  if length(coalesce(p_note, '')) > 2000 then raise exception 'Follow-up note is too long'; end if;

  if p_action = 'complete' then
    update public.leads
      set follow_up_date = '-', follow_up_at = null
      where id = p_lead
      returning id into updated_id;
    activity_type := 'Follow-up completed';
    activity_description := concat_ws(' — ', activity_type, nullif('Note: ' || btrim(p_note), 'Note: '));
  else
    update public.leads
      set follow_up_date = p_follow_up::text, follow_up_at = null
      where id = p_lead
      returning id into updated_id;
    activity_type := 'Follow-up rescheduled';
    activity_description := 'Next follow-up: ' || p_follow_up::text;
  end if;

  if updated_id is null then raise exception 'Lead unavailable or access denied'; end if;

  insert into public.lead_activities(lead_id, user_id, action_type, description)
  values (p_lead, auth.uid(), activity_type, activity_description);
end;
$$;

revoke all on function public.crm_update_task_follow_up(uuid, text, date, text) from public, anon;
grant execute on function public.crm_update_task_follow_up(uuid, text, date, text) to authenticated;
