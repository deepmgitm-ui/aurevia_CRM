-- Keep agents' daily workflow inside existing tables and server-side RPCs.
-- Stale is derived from lead updates and activity history; no reminder rows are stored.

create or replace function public.crm_task_page(p_bucket text default 'all',p_search text default '',p_page int default 1) returns jsonb language sql stable security invoker set search_path='' as $$
 with base as (
   select l.*,
     greatest(
       coalesce(l.updated_at,l.created_at),
       coalesce((select max(a.created_at) from public.lead_activities a where a.lead_id=l.id),l.created_at),
       coalesce(l.assigned_at,l.created_at)
     ) as last_touched_at
   from public.leads l
   where lower(btrim(l.status)) not in('lost','dropped','ipd done','surgery completed','won')
 ),
 scoped as(select * from base where follow_up_day is not null),
 filtered as(
   select * from base
   where (p_search='' or strpos(lower(concat_ws(' ',name,phone,disease,assigned_to,source)),lower(p_search))>0)
   and case p_bucket
     when 'stale' then last_touched_at < now()-interval '3 days'
     when 'overdue' then follow_up_day is not null and follow_up_day<(now() at time zone 'Asia/Kolkata')::date
     when 'today' then follow_up_day=(now() at time zone 'Asia/Kolkata')::date
     when 'upcoming' then follow_up_day>(now() at time zone 'Asia/Kolkata')::date
     else follow_up_day is not null
   end
 ),
 page as(
   select id,name,phone,disease,follow_up_date,follow_up_at,status,temperature,assigned_to,source,remarks,last_touched_at
   from filtered
   order by case when p_bucket='stale' then last_touched_at end,
     follow_up_day nulls last,coalesce(follow_up_at,'infinity'::timestamptz),id
   limit 50 offset (greatest(1,least(p_page,100000))-1)*50
 )
 select jsonb_build_object(
   'leads',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
   'total',(select count(*) from filtered),
   'stats',(select jsonb_build_object(
     'total',count(*),
     'overdue',count(*) filter(where follow_up_day<(now() at time zone 'Asia/Kolkata')::date),
     'today',count(*) filter(where follow_up_day=(now() at time zone 'Asia/Kolkata')::date),
     'upcoming',count(*) filter(where follow_up_day>(now() at time zone 'Asia/Kolkata')::date),
     'stale',(select count(*) from base where last_touched_at < now()-interval '3 days')
   ) from scoped)
 )
$$;

create or replace function public.crm_change_appointment_status(p_id uuid,p_status text) returns void language plpgsql set search_path='' as $$
declare
 a public.crm_appointments;
 clinic_today date := (now() at time zone 'Asia/Kolkata')::date;
 callback_day date;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if p_status not in('booked','confirmed','arrived','completed','cancelled','no_show') then raise exception 'Invalid appointment status';end if;
 select * into a from public.crm_appointments where id=p_id for update;
 if not found then raise exception 'Appointment unavailable';end if;
 if p_status='completed' and a.starts_on>clinic_today then raise exception 'A future appointment cannot be completed';end if;
 update public.crm_appointments set status=p_status where id=p_id;
 if p_status='completed' then
   update public.leads set status=case a.kind when 'ipdDone' then 'IPD Done' else 'OPD Done' end,
     opd_done_date=case when a.kind in('opdBooked','opdDone') then a.starts_on::text else opd_done_date end,
     ipd_done_date=case when a.kind='ipdDone' then a.starts_on::text else ipd_done_date end
   where id=a.lead_id;
 elsif p_status='no_show' and a.status is distinct from 'no_show' then
   update public.leads set
     follow_up_date=case when follow_up_day is null or follow_up_day<=clinic_today then (clinic_today+1)::text else follow_up_date end,
     follow_up_at=case when follow_up_day is null or follow_up_day<=clinic_today then null else follow_up_at end
   where id=a.lead_id
   returning follow_up_day into callback_day;
   insert into public.lead_activities(lead_id,user_id,action_type,description)
   values(a.lead_id,auth.uid(),'follow_up','Appointment marked no-show. Callback follow-up scheduled for '||coalesce(callback_day::text,(clinic_today+1)::text)||'.');
 end if;
end $$;

create or replace function public.crm_agent_daily_report(p_day date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; viewer_role text := coalesce(public.current_user_role()::text,'');begin
 if auth.uid() is null or viewer_role not in('admin','manager','employee') then raise exception 'Sign in to view your daily summary';end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from(
 select p.id,p.name,p.role,
 (select count(*) from public.crm_assignment_events e where e.assigned_profile_id=p.id and e.assigned_at>=p_day::timestamp at time zone 'Asia/Kolkata' and e.assigned_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') assigned,
 (select count(*) from public.lead_activities c where c.user_id=p.id and lower(c.action_type)='call' and c.created_at>=p_day::timestamp at time zone 'Asia/Kolkata' and c.created_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') calls,
 (select count(distinct lead_id) from public.lead_activities c where c.user_id=p.id and lower(c.action_type)='call' and c.created_at>=p_day::timestamp at time zone 'Asia/Kolkata' and c.created_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') patients_called,
 (select count(*) from public.lead_activities c where c.user_id=p.id and c.call_outcome='Connected' and c.created_at>=p_day::timestamp at time zone 'Asia/Kolkata' and c.created_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') connected,
 (select count(*) from public.leads l where lower(btrim(l.assigned_to))=lower(btrim(p.name)) and l.follow_up_day<=p_day and lower(btrim(l.status)) not in('lost','dropped','ipd done','surgery completed','won')) pending,
 (select count(distinct e.lead_id) from public.crm_appointment_events e where e.actor_id=p.id and e.new_date=p_day and e.new_status='completed' and e.previous_status is distinct from 'completed' and e.new_kind in('opdBooked','opdDone')) opd_done,
 (select count(distinct e.lead_id) from public.crm_appointment_events e where e.actor_id=p.id and e.new_date=p_day and e.new_status='completed' and e.previous_status is distinct from 'completed' and e.new_kind='ipdDone') ipd_done
 from public.profiles p
 where viewer_role in('admin','manager') or p.id=auth.uid()
 order by p.name) r;
 return result;
end $$;

revoke all on function public.crm_task_page(text,text,int),public.crm_change_appointment_status(uuid,text),public.crm_agent_daily_report(date) from public,anon;
grant execute on function public.crm_task_page(text,text,int),public.crm_change_appointment_status(uuid,text),public.crm_agent_daily_report(date) to authenticated;
