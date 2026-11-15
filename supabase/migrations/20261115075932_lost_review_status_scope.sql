-- Keep all disposition statuses in their own counts, but limit the Lost
-- workflow/review queue to actual dropped outcomes and Not Interested.

create or replace function public.crm_team_bucket_groups()
returns table(assigned_to text, bucket text, lead_count bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with today as (
    select
      ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata') as starts_at,
      (((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata') as ends_at
  ),
  categorized as (
    select l.assigned_to, case
      when l.workflow_bucket = 'fresh'
        and coalesce(l.fresh_pending_since, l.created_at) >= d.starts_at
        and coalesce(l.fresh_pending_since, l.created_at) < d.ends_at then 'fresh'
      when l.workflow_bucket = 'fresh'
        and coalesce(l.fresh_pending_since, l.created_at) < d.starts_at then 'new'
      when l.workflow_bucket = 'closed'
        and lower(btrim(coalesce(l.status, ''))) in ('dropped', 'lost', 'not interested') then 'lost'
      when l.workflow_bucket = 'closed' then null
      when l.workflow_bucket = 'followup' and public.crm_is_followup_work_status(l.status) then 'followup'
      when l.workflow_bucket = 'followup' then null
      else l.workflow_bucket
    end as bucket
    from public.leads l cross join today d
  )
  select categorized.assigned_to, categorized.bucket, count(*)
  from categorized
  where categorized.bucket is not null
  group by categorized.assigned_to, categorized.bucket
  order by categorized.assigned_to, categorized.bucket;
$function$;

revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;

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
    and lower(btrim(coalesce(l.status, ''))) in ('dropped', 'lost', 'not interested')
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

delete from public.crm_lead_deletion_reviews r
using public.leads l
where l.id = r.lead_id
  and r.decision = 'pending'
  and lower(btrim(coalesce(l.status, ''))) not in ('dropped', 'lost', 'not interested');

select crm_private.daily_lost_lead_reviews();
