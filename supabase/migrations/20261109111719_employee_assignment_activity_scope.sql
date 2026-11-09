alter table public.crm_assignment_events
  add column if not exists previous_assigned_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists lead_name text;

update public.crm_assignment_events e
set lead_name = coalesce(nullif(btrim(e.lead_name), ''), nullif(btrim(l.name), '')),
    previous_assigned_profile_id = coalesce(
      e.previous_assigned_profile_id,
      (select p.id
       from public.profiles p
       where lower(btrim(p.name)) = lower(btrim(coalesce(e.previous_assigned_to, '')))
       order by p.id
       limit 1)
    )
from public.leads l
where l.id = e.lead_id
  and (e.lead_name is null or (e.previous_assigned_to is not null and e.previous_assigned_profile_id is null));

create index if not exists crm_assignment_events_previous_profile_idx
  on public.crm_assignment_events (previous_assigned_profile_id, assigned_at desc)
  where previous_assigned_profile_id is not null;

create or replace function crm_private.track_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_name text;
  target_name text;
  previous_profile_id uuid;
  target_profile_id uuid;
begin
  target_name := nullif(btrim(coalesce(new.assigned_to, '')), '');
  if lower(coalesce(target_name, '')) in ('-', 'unassigned') then
    target_name := null;
  else
    select p.id into target_profile_id
      from public.profiles p
      where lower(btrim(p.name)) = lower(btrim(target_name))
      order by p.id
      limit 1;
  end if;

  if tg_op = 'INSERT' then
    if target_name is not null then
      insert into public.crm_assignment_events
        (lead_id, assigned_profile_id, previous_assigned_profile_id, lead_name, assigned_to,
         assigned_at, actor_id, previous_assigned_to, event_kind)
      values
        (new.id, target_profile_id, null, new.name, target_name,
         coalesce(new.assigned_at, now()), auth.uid(), null, 'assignment');
    end if;
    return new;
  end if;

  previous_name := nullif(btrim(coalesce(old.assigned_to, '')), '');
  if lower(coalesce(previous_name, '')) in ('-', 'unassigned') then
    previous_name := null;
  else
    select p.id into previous_profile_id
      from public.profiles p
      where lower(btrim(p.name)) = lower(btrim(previous_name))
      order by p.id
      limit 1;
  end if;

  if lower(coalesce(previous_name, '')) is not distinct from lower(coalesce(target_name, '')) then
    return new;
  end if;

  if target_name is null then
    insert into public.crm_assignment_events
      (lead_id, assigned_profile_id, previous_assigned_profile_id, lead_name, assigned_to,
       assigned_at, actor_id, previous_assigned_to, event_kind)
    values
      (new.id, null, previous_profile_id, new.name, 'Unassigned',
       now(), auth.uid(), previous_name, 'unassignment');
  else
    insert into public.crm_assignment_events
      (lead_id, assigned_profile_id, previous_assigned_profile_id, lead_name, assigned_to,
       assigned_at, actor_id, previous_assigned_to, event_kind)
    values
      (new.id, target_profile_id, previous_profile_id, new.name, target_name,
       coalesce(new.assigned_at, now()), auth.uid(), previous_name,
       case when previous_name is null then 'assignment' else 'transfer' end);
  end if;

  return new;
end;
$function$;

drop policy if exists crm_assignment_read on public.crm_assignment_events;
create policy crm_assignment_read
  on public.crm_assignment_events for select to authenticated
  using (
    (select public.current_user_role()) in ('admin', 'manager')
    or assigned_profile_id = (select auth.uid())
    or previous_assigned_profile_id = (select auth.uid())
  );

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
  if actor_role is null or actor_role not in ('admin', 'manager', 'employee') then
    raise exception using errcode = '42501', message = 'You are not allowed to view activity.';
  end if;
  if p_scope is null or p_scope not in ('mine', 'all')
     or (actor_role = 'employee' and p_scope <> 'mine') then
    raise exception using errcode = '42501', message = 'Employees can only view their own assignment updates.';
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
      coalesce(nullif(btrim(e.lead_name), ''), nullif(btrim(l.name), ''), 'Unavailable lead')::text as lead_name,
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
    where (actor_role in ('admin', 'manager') and (p_scope = 'all' or e.actor_id = auth.uid()))
       or (actor_role = 'employee' and (
         e.assigned_profile_id = auth.uid()
         or e.previous_assigned_profile_id = auth.uid()
       ))
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
