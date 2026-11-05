-- Workflow RPCs. All public entry points enforce caller identity and RLS.
alter table public.crm_appointments add column assigned_profile_id uuid references public.profiles(id) on delete set null;
update public.crm_appointments a set assigned_profile_id=p.id from public.leads l join public.profiles p on lower(btrim(p.name))=lower(btrim(l.assigned_to)) where a.lead_id=l.id;
alter table public.crm_appointment_events add column previous_kind text;
alter table public.crm_appointment_events add column new_kind text;
create or replace function crm_private.appointment_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
 update public.crm_appointments set assigned_profile_id=(select p.id from public.leads l join public.profiles p on lower(btrim(p.name))=lower(btrim(l.assigned_to)) where l.id=new.lead_id limit 1) where id=new.id and assigned_profile_id is null;
 insert into public.crm_appointment_events(appointment_id,lead_id,actor_id,new_date,new_status,new_kind) values(new.id,new.lead_id,auth.uid(),new.starts_on,new.status,new.kind);
 elsif (new.starts_on,new.status,new.starts_at,new.kind) is distinct from (old.starts_on,old.status,old.starts_at,old.kind) then
 insert into public.crm_appointment_events(appointment_id,lead_id,actor_id,previous_date,new_date,previous_status,new_status,previous_kind,new_kind) values(new.id,new.lead_id,auth.uid(),old.starts_on,new.starts_on,old.status,new.status,old.kind,new.kind);
 end if;return new;
end $$;
create or replace function public.crm_daily_work_counts(p_day date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('assigned',(select count(*) from public.leads where assigned_at>=p_day::timestamp at time zone 'Asia/Kolkata' and assigned_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata'),
 'opd',(select count(distinct lead_id) from public.crm_appointments where starts_on=p_day and kind in('opdBooked','opdDone') and status not in('cancelled','no_show')),
 'opdDone',(select count(distinct lead_id) from public.crm_appointments where starts_on=p_day and kind in('opdBooked','opdDone') and status='completed'),
 'ipdDone',(select count(distinct lead_id) from public.crm_appointments where starts_on=p_day and kind='ipdDone' and status='completed'),
 'ipd',(select count(distinct lead_id) from public.crm_appointments where starts_on=p_day and kind='ipdDone' and status not in('cancelled','no_show')))
$$;
create or replace function public.crm_daily_lead_ids(p_kind text,p_day date) returns table(id uuid) language sql stable security invoker set search_path='' as $$
 select distinct a.lead_id from public.crm_appointments a where starts_on=p_day and a.status not in('cancelled','no_show') and
 case p_kind when 'opd' then a.kind in('opdBooked','opdDone') when 'opdDone' then a.kind in('opdBooked','opdDone') and a.status='completed' when 'ipd' then a.kind='ipdDone' when 'ipdDone' then a.kind='ipdDone' and a.status='completed' else false end order by a.lead_id
$$;
create or replace function public.crm_status_values() returns jsonb language sql stable security invoker set search_path='' as $$ select coalesce(jsonb_agg(s),'[]'::jsonb) from(select distinct status s from public.leads order by status) t $$;

create or replace function public.crm_save_calendar_entry(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.leads;a public.crm_appointments;col text;k text;d date;s text;tm time;ph text;aid uuid;change_status boolean;
begin
 if auth.uid() is null or coalesce(public.current_user_role()::text,'')<>'admin' then raise exception 'Only admins can edit calendar appointments'; end if;
 k:=p->>'kind'; col:=case k when 'opdBooked' then 'opd_booked_date' when 'opdDone' then 'opd_done_date' when 'ipdDone' then 'ipd_done_date' end;
 if col is null then raise exception 'Invalid appointment type'; end if;
 d:=(p->>'date')::date;s:=coalesce(nullif(p->>'appointmentStatus',''),case k when 'opdDone' then 'completed' else 'booked' end);
 if s not in('booked','confirmed','arrived','completed','cancelled','no_show') then raise exception 'Invalid appointment status'; end if;
 if s='completed' and d>(now() at time zone 'Asia/Kolkata')::date then raise exception 'A future appointment cannot be completed'; end if;
 tm:=nullif(p->>'time','')::time;change_status:=coalesce((p->>'updateStatus')::boolean,false);
 ph:=right(regexp_replace(coalesce(p->>'phone',''),'\D','','g'),10); if ph='' then ph:='-';end if;
 if length(btrim(coalesce(p->>'name','')))=0 or length(p->>'name')>200 then raise exception 'Patient name required';end if;
 if ph<>'-' and length(ph)<>10 then raise exception 'Enter a valid phone';end if;
 if length(coalesce(p->>'remarks',''))>5000 or length(coalesce(p->>'appointmentNotes',''))>5000 or length(coalesce(p->>'city',''))>200 then raise exception 'Patient details are too long';end if;
 if ph<>'-' then perform pg_advisory_xact_lock(hashtextextended(ph,0));end if;
 if p->>'mode'='new' then
  if nullif(p->>'assignedTo','') is not null and not exists(select 1 from public.profiles where name=p->>'assignedTo') then raise exception 'Invalid agent';end if;
  insert into public.leads(name,phone,city,remarks,status,assigned_to,source,temperature,lead_date,source_batch_id,source_batch_label,source_batch_created_at)
  values(btrim(p->>'name'),ph,coalesce(nullif(btrim(p->>'city'),''),'-'),coalesce(nullif(btrim(p->>'remarks'),''),'-'),
  case when s='completed' then case k when 'ipdDone' then 'IPD Done' else 'OPD Done' end when k='ipdDone' then 'IPD Booked' else 'OPD Booked' end,
  coalesce(nullif(p->>'assignedTo',''),'-'),'Manual','Warm',to_char((now() at time zone 'Asia/Kolkata')::date,'DD/MM/YYYY'),gen_random_uuid(),'Calendar entry',now()) returning * into l;
 elsif p->>'mode'='existing' then
  select * into l from public.leads where id=(p->>'leadId')::uuid for update;
  if not found then raise exception 'Patient unavailable';end if;
  if l.updated_at is distinct from (p->>'expectedUpdatedAt')::timestamptz then raise exception 'Patient changed elsewhere. Reload before saving';end if;
 else raise exception 'Invalid entry mode';end if;
 if ph<>'-' and exists(select 1 from public.leads where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=ph and id<>l.id) then raise exception 'Phone already belongs to another patient';end if;
 if nullif(p->>'appointmentId','') is not null then
  select * into a from public.crm_appointments where id=(p->>'appointmentId')::uuid and lead_id=l.id for update;
  if not found then raise exception 'Appointment unavailable';end if;
  if a.updated_at is distinct from (p->>'expectedAppointmentUpdatedAt')::timestamptz then raise exception 'Appointment changed elsewhere. Reopen before saving';end if;
  aid:=a.id;
  update public.crm_appointments set legacy_column=null where lead_id=l.id and legacy_column=col and id<>aid;
  update public.crm_appointments set kind=k,status=s,starts_on=d,starts_at=tm,notes=coalesce(p->>'appointmentNotes',''),legacy_column=col where id=aid;
 else
  -- Keep the earlier visit intact; each new visit is a separate record.
  update public.crm_appointments set legacy_column=null where lead_id=l.id and legacy_column=col;
  insert into public.crm_appointments(lead_id,kind,status,starts_on,starts_at,notes,legacy_column,created_by)
  values(l.id,k,s,d,tm,coalesce(p->>'appointmentNotes',''),col,auth.uid()) returning id into aid;
 end if;
 update public.leads set name=btrim(p->>'name'),phone=ph,city=coalesce(nullif(btrim(p->>'city'),''),'-'),remarks=coalesce(nullif(btrim(p->>'remarks'),''),'-'),
 opd_booked_date=case when col='opd_booked_date' then d::text else opd_booked_date end,opd_done_date=case when col='opd_done_date' then d::text else opd_done_date end,ipd_done_date=case when col='ipd_done_date' then d::text else ipd_done_date end,
 status=case when change_status then case when s='completed' then case k when 'ipdDone' then 'IPD Done' else 'OPD Done' end when k='ipdDone' then 'IPD Booked' else 'OPD Booked' end else status end where id=l.id;
 insert into public.lead_activities(lead_id,user_id,action_type,description) values(l.id,auth.uid(),'note','Calendar appointment saved: '||d::text||' ('||s||')');
 return jsonb_build_object('id',l.id,'appointmentId',aid);
end $$;

create or replace function public.crm_agent_daily_report(p_day date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or coalesce(public.current_user_role()::text,'') not in('admin','manager') then raise exception 'Team report access required';end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from(
 select p.id,p.name,p.role,
 (select count(*) from public.crm_assignment_events e where e.assigned_profile_id=p.id and e.assigned_at>=p_day::timestamp at time zone 'Asia/Kolkata' and e.assigned_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') assigned,
 (select count(*) from public.lead_activities c where c.user_id=p.id and lower(c.action_type)='call' and c.created_at>=p_day::timestamp at time zone 'Asia/Kolkata' and c.created_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') calls,
 (select count(distinct lead_id) from public.lead_activities c where c.user_id=p.id and lower(c.action_type)='call' and c.created_at>=p_day::timestamp at time zone 'Asia/Kolkata' and c.created_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') patients_called,
 (select count(*) from public.lead_activities c where c.user_id=p.id and c.call_outcome='Connected' and c.created_at>=p_day::timestamp at time zone 'Asia/Kolkata' and c.created_at<(p_day+1)::timestamp at time zone 'Asia/Kolkata') connected,
 (select count(*) from public.leads l where lower(btrim(l.assigned_to))=lower(btrim(p.name)) and l.follow_up_day<=p_day and lower(btrim(l.status)) not in('lost','dropped','ipd done','surgery completed','won')) pending,
 (select count(distinct e.lead_id) from public.crm_appointment_events e where e.actor_id=p.id and e.new_date=p_day and e.new_status='completed' and e.previous_status is distinct from 'completed' and e.new_kind in('opdBooked','opdDone')) opd_done,
 (select count(distinct e.lead_id) from public.crm_appointment_events e where e.actor_id=p.id and e.new_date=p_day and e.new_status='completed' and e.previous_status is distinct from 'completed' and e.new_kind='ipdDone') ipd_done
 from public.profiles p order by p.name) r;return result;
end $$;
create or replace function public.crm_capacity() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin if auth.uid() is null or coalesce(public.current_user_role()::text,'')<>'admin' then raise exception 'Admin access required';end if;
 return jsonb_build_object('databaseBytes',pg_database_size(current_database()),'leads',(select count(*) from public.leads),'staff',(select count(*) from public.profiles),'leadBytes',pg_total_relation_size('public.leads'),'activityBytes',pg_total_relation_size('public.lead_activities'),'appointments',(select count(*) from public.crm_appointments));end $$;
revoke all on function public.crm_daily_work_counts(date),public.crm_daily_lead_ids(text,date),public.crm_status_values(),public.crm_save_calendar_entry(jsonb),public.crm_agent_daily_report(date),public.crm_capacity() from public,anon;
grant execute on function public.crm_daily_work_counts(date),public.crm_daily_lead_ids(text,date),public.crm_status_values(),public.crm_save_calendar_entry(jsonb),public.crm_agent_daily_report(date),public.crm_capacity() to authenticated;
-- Shared phone check covers manual entry, calendar, import and webhook writes.
create or replace function crm_private.guard_phone() returns trigger language plpgsql security definer set search_path='' as $$
declare ph text;begin
 ph:=right(regexp_replace(coalesce(new.phone,''),'\D','','g'),10);
 if length(ph)=10 and (tg_op='INSERT' or ph is distinct from right(regexp_replace(coalesce(old.phone,''),'\D','','g'),10)) then
 perform pg_advisory_xact_lock(hashtextextended(ph,0));
 if exists(select 1 from public.leads l where right(regexp_replace(coalesce(l.phone,''),'\D','','g'),10)=ph and l.id<>new.id) then raise exception using errcode='23505',message='Phone already exists. Search the existing lead or ask an administrator';end if;
 end if;return new;end $$;
revoke all on function crm_private.guard_phone() from public,anon,authenticated;
create trigger crm_phone_guard before insert or update of phone on public.leads for each row execute function crm_private.guard_phone();
create index crm_phone_identity_idx on public.leads((right(regexp_replace(coalesce(phone,''),'\D','','g'),10))) where length(regexp_replace(coalesce(phone,''),'\D','','g'))>=10;
create table public.crm_merge_history(id uuid primary key default gen_random_uuid(),target_id uuid,source_snapshot jsonb not null,target_snapshot jsonb not null,actor_id uuid references public.profiles(id),created_at timestamptz not null default now());
alter table public.crm_merge_history enable row level security;
create policy crm_merge_admin on public.crm_merge_history for all to authenticated using(public.current_user_role()='admin') with check(public.current_user_role()='admin' and actor_id=auth.uid());
grant select,insert on public.crm_merge_history to authenticated;revoke all on public.crm_merge_history from anon;
create or replace function public.crm_duplicate_groups(p_page int default 1) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or coalesce(public.current_user_role()::text,'')<>'admin' then raise exception 'Admin access required';end if;
 with groups as(select right(regexp_replace(coalesce(phone,''),'\D','','g'),10) phone_id,count(*) n from public.leads where length(regexp_replace(coalesce(phone,''),'\D','','g'))>=10 group by 1 having count(*)>1),
 page as(select * from groups order by n desc,phone_id limit 20 offset(greatest(1,p_page)-1)*20)
 select jsonb_build_object('total',(select count(*) from groups),'groups',coalesce((select jsonb_agg(jsonb_build_object('phone',g.phone_id,'count',g.n,'leads',(select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'status',l.status,'assignedTo',l.assigned_to,'updatedAt',l.updated_at)) from public.leads l where right(regexp_replace(coalesce(l.phone,''),'\D','','g'),10)=g.phone_id))) from page g),'[]'::jsonb)) into result;return result;
end $$;
create or replace function public.crm_merge_leads(p_target uuid,p_source uuid,p_target_version timestamptz,p_source_version timestamptz,p_phone text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.leads;s public.leads;backup uuid;begin
 if auth.uid() is null or coalesce(public.current_user_role()::text,'')<>'admin' then raise exception 'Only admins can merge';end if;
 if p_target=p_source then raise exception 'Choose two different leads';end if;
 perform 1 from public.leads where id in(p_target,p_source) order by id for update;
 select * into t from public.leads where id=p_target;select * into s from public.leads where id=p_source;
 if t.id is null or s.id is null or t.updated_at is distinct from p_target_version or s.updated_at is distinct from p_source_version then raise exception 'Records changed. Reload duplicate review';end if;
 if length(coalesce(p_phone,''))<>10 or right(regexp_replace(coalesce(t.phone,''),'\D','','g'),10)<>p_phone or right(regexp_replace(coalesce(s.phone,''),'\D','','g'),10)<>p_phone then raise exception 'Phone confirmation does not match';end if;
 insert into public.crm_merge_history(target_id,source_snapshot,target_snapshot,actor_id) values(t.id,to_jsonb(s),to_jsonb(t),auth.uid()) returning id into backup;
 update public.crm_appointment_events set lead_id=t.id where lead_id=s.id;
 update public.crm_appointments set legacy_column=null,lead_id=t.id where lead_id=s.id;
 update public.lead_activities set lead_id=t.id where lead_id=s.id;
 update public.crm_assignment_events set lead_id=t.id where lead_id=s.id;
 update public.leads set remarks=concat_ws(E'\n',nullif(t.remarks,'-'),'Merged record: '||s.name||' | source: '||coalesce(s.source,'-')||' | city: '||coalesce(s.city,'-')||' | treatment: '||coalesce(s.disease,'-'),nullif(s.remarks,'-')) where id=t.id;
 insert into public.lead_activities(lead_id,user_id,action_type,description) values(t.id,auth.uid(),'merge','Duplicate lead merged; appointments, activities and assignments preserved; recovery record '||backup::text);
 delete from public.leads where id=s.id;
 return jsonb_build_object('id',t.id,'backupId',backup);
end $$;
revoke all on function public.crm_duplicate_groups(int),public.crm_merge_leads(uuid,uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.crm_duplicate_groups(int),public.crm_merge_leads(uuid,uuid,timestamptz,timestamptz,text) to authenticated;

-- One daily database job; no Vercel function, service key or HTTP request.
create table public.crm_runtime_settings(id boolean primary key default true check(id),automatic_enabled boolean not null default true);
insert into public.crm_runtime_settings values(true,true);
alter table public.crm_runtime_settings enable row level security;
create policy crm_runtime_admin on public.crm_runtime_settings for all to authenticated using(public.current_user_role()='admin') with check(public.current_user_role()='admin');
grant select,update on public.crm_runtime_settings to authenticated;revoke all on public.crm_runtime_settings from anon;
create or replace function crm_private.daily_automation() returns void language plpgsql security definer set search_path='' as $$
declare r record;n int;actor uuid;d date:=(now() at time zone 'Asia/Kolkata')::date;agents text[];picked text;row record;cnt int;loads jsonb;begin
 if not pg_try_advisory_xact_lock(12102026) then return;end if;
 if not (select automatic_enabled from public.crm_runtime_settings where id) then return;end if;
 select id into actor from public.profiles where role='admin' order by id limit 1;if actor is null then return;end if;
 for r in select * from public.crm_automation_rules where enabled and (last_run_at is null or (last_run_at at time zone 'Asia/Kolkata')::date<d) order by key loop
 n:=0;
 if r.key in('welcome','nudge','overdue','celebrate') then
  for row in select * from public.leads where case r.key
   when 'welcome' then lower(status)='new' and follow_up_day is null
   when 'nudge' then temperature::text='Warm' and updated_at<now()-interval '7 days' and not exists(select 1 from public.lead_activities c where c.lead_id=leads.id and c.created_at>=now()-interval '7 days') and (follow_up_day is null or follow_up_day<=d) and lower(status) not in('lost','dropped','ipd done','surgery completed','won')
   when 'overdue' then temperature::text='Hot' and follow_up_day<d and lower(btrim(status)) not in('lost','dropped','ipd done','surgery completed','won')
   when 'celebrate' then lower(status) in('surgery completed','ipd done') and not exists(select 1 from public.lead_activities a where a.lead_id=leads.id and a.action_type='automation' and a.description='Daily automation: celebrate')
   else false end order by updated_at,id limit 500 for update skip locked loop
   update public.leads set follow_up_date=case when r.key='celebrate' then follow_up_date else (d+1)::text end,follow_up_at=case when r.key='celebrate' then follow_up_at else null end,
   temperature=(case when r.key in('celebrate','overdue') then 'Hot' else 'Warm' end)::public.lead_temp where id=row.id;
   if not exists(select 1 from public.lead_activities where lead_id=row.id and action_type='automation' and description='Daily automation: '||r.key) then insert into public.lead_activities(lead_id,user_id,action_type,description) values(row.id,actor,'automation','Daily automation: '||r.key);end if;n:=n+1;
  end loop;
 elsif r.key='balance' then
  select array_agg(name order by name) into agents from public.profiles where role='employee' and btrim(name)<>'';
  if coalesce(array_length(agents,1),0)>0 then
   select jsonb_object_agg(a, n) into loads from(select a,count(l.id) n from unnest(agents) a left join public.leads l on l.assigned_to=a group by a) x;
   for row in select id from public.leads where btrim(coalesce(assigned_to,'')) in('','-') and lower(status) not in('lost','dropped','opd done','ipd done','surgery completed','won') order by created_at,id limit 500 for update skip locked loop
    -- Choose the least-loaded employee each time, within this small locked batch.
    select key into picked from jsonb_each_text(loads) order by value::int,key limit 1;
    loads:=jsonb_set(loads,array[picked],to_jsonb((loads->>picked)::int+1));
    update public.leads set assigned_to=picked,assigned_at=now() where id=row.id;n:=n+1;
   end loop;
  end if;
 end if;
 update public.crm_automation_rules set last_run_at=now(),last_run_summary=n||' leads processed by daily job' where key=r.key;
 insert into public.crm_automation_runs(rule_key,run_by,run_by_name,affected,detail) values(r.key,actor,'Daily schedule',n,jsonb_build_object('scheduled',true));
 end loop;
 -- Operational receipts expire; patient history and recovery records are never pruned.
 delete from public.crm_automation_runs where created_at<now()-interval '90 days';
 if to_regclass('cron.job_run_details') is not null then execute 'delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname=''aurevia-daily-workflows'') and start_time<now()-interval ''14 days''';end if;
end $$;
revoke all on function crm_private.daily_automation() from public,anon,authenticated;
-- CRON_SETUP_BEGIN: isolated verification skips only the platform extension setup.
create extension if not exists pg_cron;
select cron.schedule('aurevia-daily-workflows','30 3 * * *','select crm_private.daily_automation()');
-- CRON_SETUP_END
-- Appointment state updates use the caller's lead scope and preserve visit history.
create or replace function public.crm_change_appointment_status(p_id uuid,p_status text) returns void language plpgsql security invoker set search_path='' as $$
declare a public.crm_appointments;begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if p_status not in('booked','confirmed','arrived','completed','cancelled','no_show') then raise exception 'Invalid appointment status';end if;
 select * into a from public.crm_appointments where id=p_id for update;if not found then raise exception 'Appointment unavailable';end if;
 if p_status='completed' and a.starts_on>(now() at time zone 'Asia/Kolkata')::date then raise exception 'A future appointment cannot be completed';end if;
 update public.crm_appointments set status=p_status where id=p_id;
 if p_status='completed' then
  update public.leads set status=case a.kind when 'ipdDone' then 'IPD Done' else 'OPD Done' end,
  opd_done_date=case when a.kind in('opdBooked','opdDone') then a.starts_on::text else opd_done_date end,
  ipd_done_date=case when a.kind='ipdDone' then a.starts_on::text else ipd_done_date end where id=a.lead_id;
 end if;end $$;
revoke all on function public.crm_change_appointment_status(uuid,text) from public,anon;
grant execute on function public.crm_change_appointment_status(uuid,text) to authenticated;
create or replace function crm_private.followup_clock() returns trigger language plpgsql set search_path='' as $$
begin if public.crm_date(new.follow_up_date) is distinct from public.crm_date(old.follow_up_date) and new.follow_up_at is not distinct from old.follow_up_at then new.follow_up_at:=null;end if;return new;end $$;
revoke all on function crm_private.followup_clock() from public,anon,authenticated;
create trigger crm_followup_clock before update of follow_up_date on public.leads for each row execute function crm_private.followup_clock();
-- Administrative job health only. No arbitrary job SQL or platform secrets returned.
create or replace function public.crm_scheduler_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or coalesce(public.current_user_role()::text,'')<>'admin' then raise exception 'Admin access required';end if;
 if to_regclass('cron.job_run_details') is null then return null;end if;
 execute 'select jsonb_build_object(''status'',status,''startedAt'',start_time,''message'',left(return_message,200)) from cron.job_run_details where jobid=(select jobid from cron.job where jobname=''aurevia-daily-workflows'') order by start_time desc limit 1' into result;return result;
end $$;
revoke all on function public.crm_scheduler_status() from public,anon;
grant execute on function public.crm_scheduler_status() to authenticated;

-- Merging may only move the lead reference; audit actor, dates and outcomes remain immutable.
grant update(lead_id) on public.crm_appointment_events,public.crm_assignment_events to authenticated;
create policy crm_appointment_event_merge on public.crm_appointment_events for update to authenticated using(public.current_user_role()='admin') with check(public.current_user_role()='admin');
create policy crm_assignment_event_merge on public.crm_assignment_events for update to authenticated using(public.current_user_role()='admin') with check(public.current_user_role()='admin');
