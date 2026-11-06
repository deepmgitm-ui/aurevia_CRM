-- Compute dashboard insights in Postgres so the app does not fetch and scan
-- thousands of lead rows on every dashboard request. SECURITY INVOKER keeps
-- the caller's existing leads RLS scope in force.
create or replace function public.crm_pipeline_insights(p_today date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  with visible as materialized (
    select status, source, assigned_to, follow_up_day from public.leads
  ),
  totals as (
    select count(*) as total,
           count(*) filter (where assigned_to is null or assigned_to in ('', '-')) as unassigned,
           count(*) filter (where follow_up_day < p_today) as overdue,
           count(*) filter (where follow_up_day = p_today) as due_today
    from visible
  ),
  status_groups as (
    select coalesce(status, '-') as label, count(*) as lead_count
    from visible group by coalesce(status, '-')
  ),
  source_groups as (
    select coalesce(source, '-') as label, count(*) as lead_count
    from visible group by coalesce(source, '-')
  )
  select jsonb_build_object(
    'total', totals.total,
    'unassigned', totals.unassigned,
    'overdueFollowUps', totals.overdue,
    'dueToday', totals.due_today,
    'bySource', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', lead_count)
                       order by lead_count desc, label) from source_groups
    ), '[]'::jsonb),
    'byStatus', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', lead_count)
                       order by lead_count desc, label) from status_groups
    ), '[]'::jsonb)
  ) into result from totals;
  return result;
end;
$$;

revoke all on function public.crm_pipeline_insights(date) from public, anon;
grant execute on function public.crm_pipeline_insights(date) to authenticated;
