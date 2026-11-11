-- Add a visible remark timestamp, keep lost-lead reminders until an admin acts,
-- and let admins review one team member's complete activity history.

alter table public.leads
  add column if not exists remarks_updated_at timestamptz;

update public.leads l
set remarks_updated_at = coalesce(
  (
    select max(a.created_at)
    from public.lead_activities a
    where a.lead_id = l.id
      and a.description ilike '%remarks%updated%'
  ),
  l.created_at
)
where l.remarks_updated_at is null
  and nullif(btrim(coalesce(l.remarks, '')), '') is not null
  and btrim(l.remarks) not in ('-', '--');

create or replace function public.crm_set_lead_remarks_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.remarks, '')), '') is not null
       and btrim(new.remarks) not in ('-', '--') then
      new.remarks_updated_at := coalesce(new.remarks_updated_at, new.created_at, now());
    else
      new.remarks_updated_at := null;
    end if;
  elsif new.remarks is distinct from old.remarks then
    new.remarks_updated_at := clock_timestamp();
  else
    new.remarks_updated_at := old.remarks_updated_at;
  end if;
  return new;
end;
$function$;

revoke all on function public.crm_set_lead_remarks_updated_at() from public, anon, authenticated;
drop trigger if exists crm_set_lead_remarks_updated_at on public.leads;
create trigger crm_set_lead_remarks_updated_at
before insert or update of remarks on public.leads
for each row execute function public.crm_set_lead_remarks_updated_at();

-- Keep the source disposition in immutable intake fields, while every new
-- database row starts in the actual New disposition and workflow bucket.
create or replace function crm_private.capture_lead_intake_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    new.intake_status := old.intake_status;
    return new;
  end if;

  new.intake_status := coalesce(
    nullif(btrim(new.imported_status), ''),
    nullif(btrim(new.status), ''),
    'New'
  );
  new.status := 'New';
  return new;
end;
$function$;

-- Any actual disposition change starts a fresh seven-day review window and
-- clears the old reminder. Remarks/details alone leave the review untouched.
create or replace function crm_private.track_agent_lead_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  actor_name text;
  assigned_name text;
  authorized_actor boolean := false;
  assignment_fresh_reset boolean := false;
begin
  assigned_name := nullif(btrim(coalesce(new.assigned_to, '')), '');
  if lower(coalesce(assigned_name, '')) in ('-', 'unassigned') then assigned_name := null; end if;

  if tg_op = 'INSERT' then
    new.fresh_pending_since := coalesce(new.fresh_pending_since, now());
    if assigned_name is not null then
      new.assigned_at := coalesce(new.assigned_at, now());
      new.assigned_fresh_since := coalesce(new.assigned_fresh_since, new.assigned_at, now());
    else
      new.assigned_fresh_since := null;
    end if;
    if public.crm_is_closed_lead_status(new.status) then
      new.closed_status_since := null;
    end if;
    return new;
  end if;

  if lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    if assigned_name is null then
      new.assigned_fresh_since := null;
      new.assigned_at := null;
    else
      new.assigned_at := now();
      new.assigned_fresh_since := now();
    end if;
  end if;

  if new.status is distinct from old.status and auth.uid() is not null then
    select p.role::text, p.name into actor_role, actor_name
    from public.profiles p where p.id = auth.uid();
    authorized_actor := actor_role in ('admin', 'manager') or
      (actor_role = 'employee' and lower(btrim(coalesce(actor_name, ''))) = lower(coalesce(assigned_name, '')));
    assignment_fresh_reset := case
      when nullif(current_setting('crm.assignment_as_fresh', true), '') is not null
        then current_setting('crm.assignment_as_fresh', true) = 'true'
      else new.status = 'New'
        and new.first_agent_touch_at is null
        and new.assigned_fresh_since is distinct from old.assigned_fresh_since
    end;

    if authorized_actor and not assignment_fresh_reset then
      new.first_agent_touch_at := coalesce(new.first_agent_touch_at, now());
      new.fresh_pending_since := null;
    end if;
  end if;

  if public.crm_is_closed_lead_status(new.status) then
    if new.first_agent_touch_at is null then
      new.closed_status_since := null;
    elsif new.status is distinct from old.status
       or not public.crm_is_closed_lead_status(old.status)
       or old.first_agent_touch_at is null then
      new.closed_status_since := now();
    else
      new.closed_status_since := coalesce(old.closed_status_since, new.closed_status_since, now());
    end if;
  else
    new.closed_status_since := null;
  end if;
  return new;
end;
$function$;

create or replace function crm_private.cancel_or_refresh_deletion_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_id uuid;
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status)
     or new.closed_status_since is null then
    delete from public.crm_lead_deletion_reviews where lead_id = new.id;
  elsif tg_op = 'UPDATE'
        and lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    select p.id into profile_id from public.profiles p
    where lower(btrim(p.name)) = lower(btrim(new.assigned_to)) limit 1;
    update public.crm_lead_deletion_reviews
    set assigned_profile_id = profile_id, assigned_to = coalesce(new.assigned_to, '')
    where lead_id = new.id and decision = 'pending';
  end if;
  if tg_op = 'UPDATE' and public.crm_is_closed_lead_status(new.status) then
    update public.crm_lead_deletion_reviews set closed_status = new.status
    where lead_id = new.id and decision = 'pending';
  end if;
  return new;
end;
$function$;

-- The daily task now creates a review only once the full week has elapsed. It
-- never deletes leads: only the admin's explicit, backup-first action can do so.
create or replace function crm_private.daily_lost_lead_reviews()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not pg_try_advisory_xact_lock(22102026) then return; end if;

  insert into public.crm_lead_deletion_reviews (
    lead_id, assigned_profile_id, assigned_to, closed_status, closed_since, delete_after
  )
  select l.id, p.id, coalesce(l.assigned_to, ''), l.status, l.closed_status_since,
         l.closed_status_since + interval '7 days'
  from public.leads l
  left join public.profiles p on lower(btrim(p.name)) = lower(btrim(l.assigned_to))
  where l.closed_status_since <= now() - interval '7 days'
    and l.workflow_bucket = 'closed'
    and public.crm_is_closed_lead_status(l.status)
  on conflict (lead_id) do update set
    assigned_profile_id = excluded.assigned_profile_id,
    assigned_to = excluded.assigned_to,
    closed_status = excluded.closed_status,
    closed_since = excluded.closed_since,
    delete_after = greatest(
      excluded.delete_after,
      coalesce(public.crm_lead_deletion_reviews.snoozed_until, excluded.delete_after)
    ),
    decision = 'pending',
    decided_by = null,
    decided_at = null,
    snoozed_until = null
  where public.crm_lead_deletion_reviews.decision in ('pending', 'kept');
end;
$function$;

-- Backfill the queue once at deployment so already-overdue leads are visible
-- immediately, without waiting for the next daily pg_cron run.
select crm_private.daily_lost_lead_reviews();

-- Keep and snooze used to remove this reminder without changing the lead's
-- status. The review action now supports only explicit, backed-up deletion.
create or replace function public.crm_admin_resolve_deletion_review(
  p_review_id uuid,
  p_action text,
  p_snooze_days integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  review_row public.crm_lead_deletion_reviews;
  actor_name text;
begin
  if auth.uid() is null or (select public.current_user_role())::text <> 'admin' then
    raise exception 'Admin access required';
  end if;
  if p_action is distinct from 'delete' then
    raise exception 'A review remains active until the lead status changes or the lead is deleted';
  end if;
  select * into review_row
  from public.crm_lead_deletion_reviews r
  where r.id = p_review_id and r.decision = 'pending'
  for update;
  if not found then raise exception 'This review is no longer pending'; end if;

  select p.name into actor_name from public.profiles p where p.id = auth.uid();
  perform crm_private.snapshot_leads_for_permanent_delete(
    array[review_row.lead_id], 'Admin lost lead review delete', auth.uid(), coalesce(actor_name, 'Admin')
  );
  delete from public.leads where id = review_row.lead_id;
  if not found then raise exception 'Lead was already removed'; end if;
end;
$function$;
revoke all on function public.crm_admin_resolve_deletion_review(uuid, text, integer) from public, anon;
grant execute on function public.crm_admin_resolve_deletion_review(uuid, text, integer) to authenticated;

create or replace function public.crm_activity_feed_for_actor(
  p_actor_id uuid,
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
  if actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only admins can review an individual team member.';
  end if;
  if p_actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.role::text in ('admin', 'manager', 'employee')
  ) then
    raise exception using errcode = '22023', message = 'Choose an available team member.';
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
      coalesce(nullif(btrim(p.name), ''), 'Team member')::text as actor_name,
      coalesce(nullif(btrim(a.action_type), ''), 'Activity')::text as action_type,
      coalesce(nullif(a.description, ''), 'Activity recorded.')::text as description,
      a.created_at as occurred_at
    from public.lead_activities a
    left join public.leads l on l.id = a.lead_id
    left join public.profiles p on p.id = a.user_id
    where a.user_id = p_actor_id
  ), assignment_events as (
    select
      'assignment:' || e.id::text as event_key,
      e.lead_id,
      coalesce(nullif(btrim(e.lead_name), ''), nullif(btrim(l.name), ''), 'Unavailable lead')::text as lead_name,
      coalesce(nullif(btrim(l.phone), ''), '-')::text as lead_phone,
      e.actor_id,
      coalesce(nullif(btrim(p.name), ''), 'Team member')::text as actor_name,
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
    where e.actor_id = p_actor_id
  ), activity_rows as (
    select * from lead_events
    union all
    select * from assignment_events
  )
  select r.event_key, r.lead_id, r.lead_name, r.lead_phone, r.actor_id,
         r.actor_name, r.action_type, r.description, r.occurred_at
  from activity_rows r
  order by r.occurred_at desc, r.event_key desc
  limit p_limit offset p_offset;
end;
$function$;

revoke all on function public.crm_activity_feed_for_actor(uuid, integer, integer) from public, anon;
grant execute on function public.crm_activity_feed_for_actor(uuid, integer, integer) to authenticated;
