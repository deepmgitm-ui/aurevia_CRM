-- Treat every new CRM record as untouched until a person actually works it,
-- even when it has no assignee yet. Keep assigned_fresh_since as the separate
-- daily assignment clock used by employee dashboards.

alter table public.leads
  add column if not exists fresh_pending_since timestamptz;

drop index if exists public.leads_assigned_workflow_bucket_idx;
alter table public.leads drop column workflow_bucket;

create or replace function public.crm_lead_workflow_bucket(
  p_status text,
  p_assigned_fresh_since timestamptz,
  p_first_agent_touch_at timestamptz,
  p_fresh_pending_since timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_first_agent_touch_at is null
      and (p_fresh_pending_since is not null or p_assigned_fresh_since is not null) then 'fresh'
    when public.crm_is_closed_lead_status(p_status) then 'closed'
    when lower(btrim(coalesce(p_status, ''))) in ('opd booked', 'consultation booked') then 'opdBooked'
    when lower(btrim(coalesce(p_status, ''))) in ('opd done', 'consultation attended') then 'opdDone'
    when lower(btrim(coalesce(p_status, ''))) in ('ipd booked', 'surgery scheduled') then 'ipdBooked'
    when lower(btrim(coalesce(p_status, ''))) in ('ipd done', 'won', 'surgery completed') then 'ipdDone'
    else 'followup'
  end;
$function$;

revoke all on function public.crm_lead_workflow_bucket(text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.crm_lead_workflow_bucket(text, timestamptz, timestamptz, timestamptz) to authenticated, service_role;

-- Preserve the prior callable signature for any existing integrations.
create or replace function public.crm_lead_workflow_bucket(
  p_status text,
  p_assigned_fresh_since timestamptz,
  p_first_agent_touch_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select public.crm_lead_workflow_bucket(
    p_status, p_assigned_fresh_since, p_first_agent_touch_at, null::timestamptz
  );
$function$;

alter table public.leads add column workflow_bucket text generated always as (
  public.crm_lead_workflow_bucket(status, assigned_fresh_since, first_agent_touch_at, fresh_pending_since)
) stored;

create index leads_assigned_workflow_bucket_idx
  on public.leads (assigned_to, workflow_bucket);

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
  same_assignee boolean;
  changed_payload boolean;
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
      -- An imported terminal disposition is still unworked; start the
      -- 7-day lost review only after a person first acts on the lead.
      new.closed_status_since := null;
    end if;
    return new;
  end if;

  same_assignee := lower(btrim(coalesce(new.assigned_to, ''))) = lower(btrim(coalesce(old.assigned_to, '')));
  if not same_assignee then
    if assigned_name is null then
      new.assigned_fresh_since := null;
      new.assigned_at := null;
    else
      new.assigned_at := now();
      new.assigned_fresh_since := now();
    end if;
  end if;

  if public.crm_is_closed_lead_status(new.status) then
    if not public.crm_is_closed_lead_status(old.status) then
      new.closed_status_since := now();
    else
      new.closed_status_since := coalesce(old.closed_status_since, new.closed_status_since, now());
    end if;
  else
    new.closed_status_since := null;
  end if;

  if auth.uid() is not null and same_assignee then
    select p.role::text, p.name into actor_role, actor_name
    from public.profiles p where p.id = auth.uid();
    changed_payload := (to_jsonb(new) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'fresh_pending_since', 'closed_status_since', 'workflow_bucket', 'assignment_batch_id'
    ]) is distinct from (to_jsonb(old) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'fresh_pending_since', 'closed_status_since', 'workflow_bucket', 'assignment_batch_id'
    ]);
    if changed_payload
       and (actor_role in ('admin', 'manager') or
         (actor_role = 'employee' and lower(btrim(coalesce(actor_name, ''))) = lower(coalesce(assigned_name, ''))))
       and not (actor_role in ('admin', 'manager') and old.first_agent_touch_at is not null and new.first_agent_touch_at is null)
    then
      new.first_agent_touch_at := coalesce(new.first_agent_touch_at, now());
      new.fresh_pending_since := null;
    end if;
  end if;
  return new;
end;
$function$;

create or replace function crm_private.mark_agent_touch_from_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  actor_name text;
  assigned_name text;
begin
  if lower(btrim(coalesce(new.action_type, ''))) in ('automation', 'assignment', 'import', 'created') then
    return new;
  end if;

  select p.role::text, p.name into actor_role, actor_name
  from public.profiles p where p.id = new.user_id;
  if actor_role is null or actor_role not in ('admin', 'manager', 'employee') then return new; end if;

  if actor_role = 'employee' then
    select l.assigned_to into assigned_name from public.leads l where l.id = new.lead_id;
    if lower(btrim(coalesce(assigned_name, ''))) <> lower(btrim(coalesce(actor_name, ''))) then
      return new;
    end if;
  end if;

  update public.leads
  set first_agent_touch_at = coalesce(first_agent_touch_at, new.created_at, now()),
      fresh_pending_since = null
  where id = new.lead_id;
  return new;
end;
$function$;

create or replace function public.crm_daily_work_counts(p_day date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with requested_day as (
    select
      p_day::timestamp at time zone 'Asia/Kolkata' as starts_at,
      (p_day + 1)::timestamp at time zone 'Asia/Kolkata' as ends_at,
      p_day = (now() at time zone 'Asia/Kolkata')::date as is_today
  )
  select jsonb_build_object(
    'assigned', (
      select count(*)
      from public.leads l
      cross join requested_day d
      where case when d.is_today then
        l.workflow_bucket = 'fresh'
        and (
          (l.assigned_fresh_since >= d.starts_at and l.assigned_fresh_since < d.ends_at)
          or (
            l.fresh_pending_since >= d.starts_at and l.fresh_pending_since < d.ends_at
            and (l.assigned_to is null or lower(btrim(l.assigned_to)) in ('', '-', 'unassigned'))
          )
        )
        else l.assigned_at >= d.starts_at and l.assigned_at < d.ends_at
      end
    ),
    'opd', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind in ('opdBooked', 'opdDone')
        and status not in ('cancelled', 'no_show')
    ),
    'opdDone', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind in ('opdBooked', 'opdDone') and status = 'completed'
    ),
    'ipdDone', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind = 'ipdDone' and status = 'completed'
    ),
    'ipd', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind = 'ipdDone' and status not in ('cancelled', 'no_show')
    )
  );
$function$;

revoke all on function public.crm_daily_work_counts(date) from public, anon;
grant execute on function public.crm_daily_work_counts(date) to authenticated;

-- Ignore imported Lost/closed labels until a user works the record. Once it
-- becomes a real closed workflow bucket, keep the existing 7-day backup/delete
-- behavior and snooze handling.
create or replace function crm_private.daily_lost_lead_reviews()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare due_lead_ids uuid[];
begin
  if not pg_try_advisory_xact_lock(22102026) then return; end if;

  insert into public.crm_lead_deletion_reviews (
    lead_id, assigned_profile_id, assigned_to, closed_status, closed_since, delete_after
  )
  select l.id, p.id, coalesce(l.assigned_to, ''), l.status, l.closed_status_since,
         l.closed_status_since + interval '7 days'
  from public.leads l
  left join public.profiles p on lower(btrim(p.name)) = lower(btrim(l.assigned_to))
  where l.closed_status_since is not null
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
    )
  where public.crm_lead_deletion_reviews.decision = 'pending';

  select coalesce(array_agg(due.lead_id), '{}'::uuid[]) into due_lead_ids
  from (
    select r.lead_id
    from public.crm_lead_deletion_reviews r
    join public.leads l on l.id = r.lead_id
    where r.decision = 'pending'
      and r.delete_after <= now()
      and (r.snoozed_until is null or r.snoozed_until <= now())
      and l.closed_status_since = r.closed_since
      and l.workflow_bucket = 'closed'
      and public.crm_is_closed_lead_status(l.status)
    order by r.delete_after, r.lead_id
    limit 100
    for update of r, l skip locked
  ) due;

  if cardinality(due_lead_ids) > 0 then
    perform crm_private.snapshot_leads_for_permanent_delete(
      due_lead_ids, 'Lost leads — 7-day auto-cleanup', null, 'Automatic cleanup'
    );
    delete from public.leads where id = any(due_lead_ids);
  end if;
end;
$function$;
revoke all on function crm_private.daily_lost_lead_reviews() from public, anon, authenticated;
