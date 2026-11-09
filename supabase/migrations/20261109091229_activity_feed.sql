create or replace function public.crm_activity_feed(
  p_scope text default 'mine',
  p_limit integer default 26,
  p_offset integer default 0
)
returns table (
  event_key text,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  actor_id uuid,
  actor_name text,
  action_type text,
  description text,
  occurred_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to view activity.';
  end if;

  select public.current_user_role()::text into actor_role;
  if actor_role is null or actor_role not in ('admin', 'manager') then
    raise exception using errcode = '42501', message = 'Only admins and managers can view team activity.';
  end if;
  if p_scope is null or p_scope not in ('mine', 'all') then
    raise exception using errcode = '22023', message = 'Choose your activity or all activity.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51
     or p_offset is null or p_offset < 0 or p_offset > 99999 then
    raise exception using errcode = '22023', message = 'Activity page is out of range.';
  end if;

  return query
  with lead_events as (
    select
      'activity:' || a.id::text as event_key,
      a.lead_id,
      coalesce(nullif(btrim(l.name), ''), 'Unavailable lead')::text as lead_name,
      coalesce(nullif(btrim(l.phone), ''), '-')::text as lead_phone,
      a.user_id as actor_id,
      coalesce(nullif(btrim(p.name), ''), case when a.user_id is null then 'System' else 'Team member' end)::text as actor_name,
      coalesce(nullif(btrim(a.action_type), ''), 'Activity')::text as action_type,
      coalesce(nullif(a.description, ''), 'Activity recorded.')::text as description,
      a.created_at as occurred_at
    from public.lead_activities a
    left join public.leads l on l.id = a.lead_id
    left join public.profiles p on p.id = a.user_id
    where p_scope = 'all' or a.user_id = auth.uid()
  ), assignment_events as (
    select
      'assignment:' || e.id::text as event_key,
      e.lead_id,
      coalesce(nullif(btrim(l.name), ''), 'Unavailable lead')::text as lead_name,
      coalesce(nullif(btrim(l.phone), ''), '-')::text as lead_phone,
      e.actor_id,
      coalesce(nullif(btrim(p.name), ''), case when e.actor_id is null then 'System' else 'Team member' end)::text as actor_name,
      case e.event_kind
        when 'transfer' then 'Transfer'
        when 'unassignment' then 'Unassignment'
        else 'Assignment'
      end::text as action_type,
      case e.event_kind
        when 'transfer' then format('Transferred from %s to %s.', coalesce(nullif(btrim(e.previous_assigned_to), ''), 'Unassigned'), coalesce(nullif(btrim(e.assigned_to), ''), 'Unassigned'))
        when 'unassignment' then format('Unassigned from %s.', coalesce(nullif(btrim(e.previous_assigned_to), ''), 'previous owner'))
        else format('Assigned to %s.', coalesce(nullif(btrim(e.assigned_to), ''), 'Unassigned'))
      end::text as description,
      e.assigned_at as occurred_at
    from public.crm_assignment_events e
    left join public.leads l on l.id = e.lead_id
    left join public.profiles p on p.id = e.actor_id
    where p_scope = 'all' or e.actor_id = auth.uid()
  ), unlogged_creations as (
    select
      'lead-created:' || l.id::text as event_key,
      l.id as lead_id,
      coalesce(nullif(btrim(l.name), ''), 'Unavailable lead')::text as lead_name,
      coalesce(nullif(btrim(l.phone), ''), '-')::text as lead_phone,
      null::uuid as actor_id,
      case when l.source ilike 'Added from Site%' then 'Website form' else 'CRM / import' end::text as actor_name,
      'Lead added'::text as action_type,
      format('New lead · Source: %s', coalesce(nullif(btrim(l.source), ''), 'Unknown'))::text as description,
      l.created_at as occurred_at
    from public.leads l
    where p_scope = 'all'
      and not exists (
        select 1 from public.lead_activities a
        where a.lead_id = l.id and lower(btrim(coalesce(a.action_type, ''))) = 'created'
      )
  ), activity_rows as (
    select * from lead_events
    union all
    select * from assignment_events
    union all
    select * from unlogged_creations
  )
  select
    r.event_key,
    r.lead_id,
    r.lead_name,
    r.lead_phone,
    r.actor_id,
    r.actor_name,
    r.action_type,
    r.description,
    r.occurred_at
  from activity_rows r
  order by r.occurred_at desc, r.event_key desc
  limit p_limit offset p_offset;
end;
$function$;

revoke all on function public.crm_activity_feed(text, integer, integer) from public, anon;
grant execute on function public.crm_activity_feed(text, integer, integer) to authenticated;
