-- Keep New/Fresh counts aligned with the exact rolling 24-hour workflow.
-- fresh_pending_since records intake time and is not reset by reassignment;
-- assigned_fresh_since is retained only as a legacy fallback.

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
        and coalesce(l.fresh_pending_since, l.assigned_fresh_since) > now() - interval '24 hours'
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

create or replace function public.crm_team_bucket_groups()
returns table(assigned_to text, bucket text, lead_count bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with categorized as (
    select l.assigned_to, case
      when l.workflow_bucket = 'fresh'
        and coalesce(l.fresh_pending_since, l.assigned_fresh_since) > now() - interval '24 hours' then 'new'
      when l.workflow_bucket = 'closed' then 'lost'
      when l.workflow_bucket = 'followup' and public.crm_is_followup_work_status(l.status) then 'followup'
      when l.workflow_bucket = 'followup' then null
      else l.workflow_bucket
    end bucket
    from public.leads l
  )
  select assigned_to, bucket, count(*)
  from categorized
  where bucket is not null
  group by assigned_to, bucket
  order by assigned_to, bucket;
$function$;

revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;

create or replace function public.crm_lead_bucket_summary(p_assigned_to text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  viewer_role text := coalesce((select public.current_user_role())::text, '');
  viewer_id uuid := auth.uid();
  viewer_name text;
  fresh_cutoff timestamptz := now() - interval '24 hours';
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view lead buckets';
  end if;
  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;

  with scoped as materialized (
    select l.workflow_bucket, l.fresh_pending_since, l.assigned_fresh_since, l.status
    from public.leads l
    where p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to))
  ),
  status_counts as (
    select case
      when status is null or lower(btrim(status)) in ('', '-', '--', 'new', 'new lead') then 'New'
      when lower(btrim(status)) in ('follow-up', 'follow up', 'contacted') then 'Follow-Up'
      when lower(btrim(status)) = 'dnp' then 'DNP'
      when lower(btrim(status)) in ('dnp2', 'dnp 2') then 'DNP2'
      when lower(btrim(status)) in ('dnp3', 'dnp 3') then 'DNP3'
      when lower(btrim(status)) in ('rnr', 'not reachable') then 'RNR'
      when lower(btrim(status)) = 'not interested' then 'Not Interested'
      when lower(btrim(status)) in ('didn''t enquired') then 'Didn''t Enquired'
      when lower(btrim(status)) = 'budget issue' then 'Budget Issue'
      when lower(btrim(status)) = 'location issue' then 'Location Issue'
      when lower(btrim(status)) = 'non surgical' then 'Non Surgical'
      when lower(btrim(status)) in ('opd booked', 'consultation booked') then 'OPD Booked'
      when lower(btrim(status)) in ('opd done', 'consultation attended') then 'OPD Done'
      when lower(btrim(status)) in ('ipd done', 'won', 'surgery completed') then 'IPD Done'
      when lower(btrim(status)) = 'ipd booked' then 'IPD Booked'
      when lower(btrim(status)) in ('dropped', 'lost') then 'Dropped'
      when lower(btrim(status)) = 'invalid number' then 'Invalid Number'
      when lower(btrim(status)) in ('callback', 'call back', 'call back later') then 'CallBack'
      when lower(btrim(status)) = 'wrong number' then 'Wrong Number'
      else btrim(status)
    end label, count(*) amount
    from scoped
    group by 1
  ),
  pipeline as (
    select count(*) total,
      count(*) filter (where workflow_bucket = 'fresh'
        and coalesce(fresh_pending_since, assigned_fresh_since) <= fresh_cutoff) fresh,
      min(coalesce(fresh_pending_since, assigned_fresh_since) + interval '24 hours')
        filter (where workflow_bucket = 'fresh'
          and coalesce(fresh_pending_since, assigned_fresh_since) > fresh_cutoff) next_fresh_at,
      count(*) filter (where workflow_bucket = 'followup' and public.crm_is_followup_work_status(status)) follow_up,
      count(*) filter (where workflow_bucket = 'opdBooked') opd_booked,
      count(*) filter (where workflow_bucket = 'opdDone') opd_done,
      count(*) filter (where workflow_bucket = 'ipdBooked') ipd_booked,
      count(*) filter (where workflow_bucket = 'ipdDone') ipd_done,
      count(*) filter (where workflow_bucket = 'closed') lost
    from scoped
  )
  select jsonb_build_object(
    'total', pipeline.total, 'fresh', pipeline.fresh, 'nextFreshAt', pipeline.next_fresh_at,
    'followUp', pipeline.follow_up,
    'opdBooked', pipeline.opd_booked, 'opdDone', pipeline.opd_done,
    'ipdBooked', pipeline.ipd_booked, 'ipdDone', pipeline.ipd_done, 'lost', pipeline.lost,
    'statuses', coalesce((select jsonb_object_agg(label, amount) from status_counts), '{}'::jsonb)
  ) into result from pipeline;
  return result;
end;
$function$;

revoke all on function public.crm_lead_bucket_summary(text) from public, anon;
grant execute on function public.crm_lead_bucket_summary(text) to authenticated;

-- Do not leak the Send as Fresh transaction flag into later lead updates on the
-- same pooled connection. A stale false value prevents an explicit Fresh
-- transfer from being recognized by the workflow trigger.
do $migration$
declare
  function_definition text;
  update_marker text := 'returning l.* into updated_lead;';
begin
  select pg_get_functiondef(
    'public.crm_update_lead_details_admin(uuid,jsonb,timestamptz,boolean)'::regprocedure
  ) into function_definition;
  if strpos(function_definition, update_marker) = 0 then
    raise exception 'Could not locate the admin lead update point to clear the assignment flag';
  end if;
  function_definition := replace(
    function_definition,
    update_marker,
    update_marker || E'\n  perform set_config(''crm.assignment_as_fresh'', '''', true);'
  );
  execute function_definition;
end;
$migration$;

-- Every batch transfer sets and clears the workflow flag around its lead update.
-- This also protects callers that reuse a pooled connection after an admin edit.
create or replace function public.crm_transfer_assignment_batch(
  p_batch_id uuid,
  p_target_name text,
  p_as_fresh boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_role text;
  target_name text;
  assignment_at timestamptz := now();
  transferred integer;
  batch_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Sign in before transferring an assignment batch.';
  end if;
  select p.role::text into actor_role
  from public.profiles p where p.id = (select auth.uid());
  if actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only admins can transfer assignment batches.';
  end if;

  target_name := nullif(btrim(coalesce(p_target_name, '')), '');
  if target_name is null or lower(target_name) in ('-', 'unassigned') then
    raise exception using errcode = '22023', message = 'Select a valid team member.';
  end if;
  if not exists (select 1 from public.profiles p where p.name = target_name) then
    raise exception using errcode = '22023', message = 'That team member is unavailable for assignment.';
  end if;
  perform b.id from public.crm_assignment_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment batch not found.';
  end if;

  perform set_config('crm.assignment_as_fresh', coalesce(p_as_fresh, false)::text, true);
  if p_as_fresh is true then
    update public.leads l
    set assigned_to = target_name, status = 'New', follow_up_date = '-',
        assigned_at = assignment_at, assigned_fresh_since = assignment_at,
        first_agent_touch_at = null
    where l.assignment_batch_id = p_batch_id and l.assigned_to is distinct from target_name;
  else
    update public.leads l
    set assigned_to = target_name, assigned_at = assignment_at
    where l.assignment_batch_id = p_batch_id and l.assigned_to is distinct from target_name;
  end if;
  get diagnostics transferred = row_count;
  perform set_config('crm.assignment_as_fresh', '', true);

  if transferred > 0 then
    update public.crm_assignment_batches set target_names = array[target_name]
    where id = p_batch_id;
    get diagnostics batch_rows = row_count;
    if batch_rows <> 1 then
      raise exception using errcode = '40001', message = 'The assignment batch could not be updated. No leads were transferred.';
    end if;
  end if;
  return transferred;
end;
$function$;

revoke all on function public.crm_transfer_assignment_batch(uuid, text, boolean) from public, anon;
grant execute on function public.crm_transfer_assignment_batch(uuid, text, boolean) to authenticated;
