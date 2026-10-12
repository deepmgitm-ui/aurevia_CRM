-- Additive CRM upgrade: scoped aggregates, appointments, call and assignment history.
create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;
create or replace function public.crm_date(value text) returns date language plpgsql immutable set search_path='' as $$
declare d date;parts text[];begin
 value:=btrim(value);
 parts:=regexp_match(value,'^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$');
 if parts is not null then d:=make_date(parts[1]::int,parts[2]::int,parts[3]::int);
 else
 parts:=regexp_match(value,'^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$');
 if parts is null then return null;end if;
 d:=make_date(case when length(parts[3])=2 then 2000+parts[3]::int else parts[3]::int end,parts[2]::int,parts[1]::int);
 end if;return d;
exception when others then return null; end $$;
revoke all on function public.crm_date(text) from public,anon;
grant execute on function public.crm_date(text) to authenticated;
alter table public.leads add column if not exists lead_day date generated always as (coalesce(public.crm_date(lead_date),(created_at at time zone 'Asia/Kolkata')::date)) stored;
alter table public.leads add column if not exists follow_up_day date generated always as (public.crm_date(follow_up_date)) stored;
alter table public.leads add column if not exists follow_up_at timestamptz;
alter table public.lead_activities add column if not exists call_outcome text;
create index if not exists crm_lead_day_idx on public.leads(lead_day,id);
create index if not exists crm_followup_idx on public.leads(follow_up_day,id) where follow_up_day is not null;
create index if not exists crm_activities_actor_date_idx on public.lead_activities(user_id,created_at) where lower(action_type)='call';

create table if not exists public.crm_assignment_events(
 id bigint generated always as identity primary key, lead_id uuid references public.leads(id) on delete set null,
 assigned_profile_id uuid references public.profiles(id) on delete set null, assigned_to text not null,
 assigned_at timestamptz not null, actor_id uuid references public.profiles(id) on delete set null
);
create index if not exists crm_assignment_date_idx on public.crm_assignment_events(assigned_at,assigned_profile_id);
alter table public.crm_assignment_events enable row level security;
create policy crm_assignment_read on public.crm_assignment_events for select to authenticated using (
 public.current_user_role() in ('admin','manager') or assigned_profile_id=(select auth.uid()));
grant select on public.crm_assignment_events to authenticated;
revoke all on public.crm_assignment_events from anon;
create or replace function crm_private.track_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if btrim(coalesce(new.assigned_to,'')) not in ('','-') and (tg_op='INSERT' or new.assigned_to is distinct from old.assigned_to) then
 insert into public.crm_assignment_events(lead_id,assigned_profile_id,assigned_to,assigned_at,actor_id)
 values(new.id,(select id from public.profiles where lower(btrim(name))=lower(btrim(new.assigned_to)) limit 1),new.assigned_to,coalesce(new.assigned_at,now()),auth.uid());
 end if; return new;
end $$;
revoke all on function crm_private.track_assignment() from public,anon,authenticated;
create trigger crm_assignment_after after insert or update of assigned_to on public.leads for each row execute function crm_private.track_assignment();
insert into public.crm_assignment_events(lead_id,assigned_profile_id,assigned_to,assigned_at)
select l.id,p.id,l.assigned_to,l.assigned_at from public.leads l left join public.profiles p on lower(btrim(p.name))=lower(btrim(l.assigned_to))
where l.assigned_at is not null and btrim(coalesce(l.assigned_to,'')) not in ('','-');

create table if not exists public.crm_appointments(
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.leads(id) on delete cascade,
 kind text not null check(kind in ('opdBooked','opdDone','ipdDone')),
 status text not null default 'booked' check(status in ('booked','confirmed','arrived','completed','cancelled','no_show')),
 starts_on date not null,starts_at time,notes text not null default '',legacy_column text,
 created_by uuid references public.profiles(id) on delete set null,performed_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(legacy_column is null or legacy_column in ('opd_booked_date','opd_done_date','ipd_done_date'))
);
create unique index crm_appointment_legacy_idx on public.crm_appointments(lead_id,legacy_column) where legacy_column is not null;
create index crm_appointment_date_idx on public.crm_appointments(starts_on,lead_id);
create table public.crm_appointment_events(
 id bigint generated always as identity primary key,appointment_id uuid references public.crm_appointments(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,actor_id uuid references public.profiles(id) on delete set null,
 previous_date date,new_date date,previous_status text,new_status text,created_at timestamptz not null default now()
);
create index crm_appointment_events_actor_idx on public.crm_appointment_events(actor_id,created_at);
alter table public.crm_appointments enable row level security;
alter table public.crm_appointment_events enable row level security;
create policy crm_appointment_read on public.crm_appointments for select to authenticated using(exists(select 1 from public.leads l where l.id=lead_id));
create policy crm_appointment_insert on public.crm_appointments for insert to authenticated with check(public.current_user_role()='admin');
create policy crm_appointment_update on public.crm_appointments for update to authenticated using(exists(select 1 from public.leads l where l.id=lead_id)) with check(exists(select 1 from public.leads l where l.id=lead_id));
create policy crm_appointment_event_read on public.crm_appointment_events for select to authenticated using(exists(select 1 from public.leads l where l.id=lead_id));
grant select,insert,update on public.crm_appointments to authenticated;
grant select on public.crm_appointment_events to authenticated;
revoke all on public.crm_appointments,public.crm_appointment_events from anon;
create or replace function crm_private.appointment_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if auth.uid() is not null and coalesce(public.current_user_role()::text,'')<>'admin' and pg_trigger_depth()=1 and
   (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'Only admins can change appointment details'; end if;
  new.updated_at:=clock_timestamp();
 end if;
 if new.status='completed' and new.starts_on>(now() at time zone 'Asia/Kolkata')::date then raise exception 'A future appointment cannot be completed';end if;
 if new.status='completed' and (tg_op='INSERT' or old.status is distinct from 'completed') then new.performed_by:=auth.uid(); end if;
 return new;
end $$;
revoke all on function crm_private.appointment_guard() from public,anon,authenticated;
create trigger crm_appointment_guard before insert or update on public.crm_appointments for each row execute function crm_private.appointment_guard();
create or replace function crm_private.appointment_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then insert into public.crm_appointment_events(appointment_id,lead_id,actor_id,new_date,new_status) values(new.id,new.lead_id,auth.uid(),new.starts_on,new.status);
 elsif (new.starts_on,new.status,new.starts_at) is distinct from (old.starts_on,old.status,old.starts_at) then
 insert into public.crm_appointment_events(appointment_id,lead_id,actor_id,previous_date,new_date,previous_status,new_status) values(new.id,new.lead_id,auth.uid(),old.starts_on,new.starts_on,old.status,new.status); end if; return new;
end $$;
revoke all on function crm_private.appointment_event() from public,anon,authenticated;
create trigger crm_appointment_event after insert or update on public.crm_appointments for each row execute function crm_private.appointment_event();
create or replace function crm_private.sync_legacy_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare col text;d date;k text;s text; begin
 foreach col in array array['opd_booked_date','opd_done_date','ipd_done_date'] loop
 d:=public.crm_date(to_jsonb(new)->>col);
 if d is null then continue; end if;
 if col='opd_done_date' then
  update public.crm_appointments set status='completed' where lead_id=new.id and starts_on=d and kind='opdBooked' and status in('booked','confirmed','arrived') and d<=(now() at time zone 'Asia/Kolkata')::date;
  if found or exists(select 1 from public.crm_appointments where lead_id=new.id and starts_on=d and kind in('opdBooked','opdDone') and status='completed') then continue;end if;
 end if;
 k:=case col when 'opd_booked_date' then 'opdBooked' when 'opd_done_date' then 'opdDone' else 'ipdDone' end;
 s:=case when col<>'opd_booked_date' and lower(coalesce(new.status,''))<>'ipd booked' and d<=(now() at time zone 'Asia/Kolkata')::date then 'completed' else 'booked' end;
 update public.crm_appointments set legacy_column=null where lead_id=new.id and legacy_column=col and starts_on<>d and status in('completed','cancelled','no_show');
 insert into public.crm_appointments(lead_id,kind,status,starts_on,legacy_column,created_by)
 values(new.id,k,s,d,col,auth.uid()) on conflict(lead_id,legacy_column) where legacy_column is not null
 do update set starts_on=excluded.starts_on where crm_appointments.starts_on is distinct from excluded.starts_on;
 end loop;return new;
end $$;
revoke all on function crm_private.sync_legacy_appointment() from public,anon,authenticated;
create trigger crm_legacy_appointment after insert or update of opd_booked_date,opd_done_date,ipd_done_date on public.leads for each row execute function crm_private.sync_legacy_appointment();
insert into public.crm_appointments(lead_id,kind,status,starts_on,legacy_column)
select id,v.kind,case when v.col<>'opd_booked_date' and lower(coalesce(status,''))<>'ipd booked' and public.crm_date(v.day)<=(now() at time zone 'Asia/Kolkata')::date then 'completed' else 'booked' end,public.crm_date(v.day),v.col
from public.leads cross join lateral(values('opdBooked','opd_booked_date',opd_booked_date),('opdDone','opd_done_date',opd_done_date),('ipdDone','ipd_done_date',ipd_done_date)) v(kind,col,day) where public.crm_date(v.day) is not null and not(v.kind='opdBooked' and coalesce(public.crm_date(opd_done_date)=public.crm_date(v.day),false));

create or replace function public.crm_treatment_text(disease text,remarks text) returns text language plpgsql immutable set search_path='' as $$
declare raw text:=btrim(coalesce(disease,''));from_notes boolean:=raw in('','-');begin
 if from_notes then raw:=btrim(coalesce(remarks,''));end if;
 if lower(raw) in('','other','na','n/a','none','nil','null','unknown','not applicable','-','--','.') then return '';end if;
 if lower(raw) ~ '(lasik|lasic|lasek|lazik|lasix|laser|femto|contoura|wavefront|\yprk\y|refractiv|\ysmile\y)' then return 'LASIK';end if;
 if lower(raw) ~ '(cataract|catract|catarct|cateract|motiyabind|motia|phaco|\yiol\y|intra ?ocular|\ylens\y|toric)' then return 'Cataract';end if;
 if lower(raw) ~ '(\yicl\y|\yicle\y|implant|phakic|collamer)' then return 'ICL';end if;
 if lower(raw) ~ '(retina|vitreous|macula|diabet)' then return 'Retina';end if;
 if lower(raw) ~ '(keratoconus|cross ?link)' then return 'Keratoconus';end if;
 if lower(raw) ~ '(squint|strabismus)' then return 'Squint';end if;
 if lower(raw) ~ '(glaucoma)' then return 'Glaucoma';end if;
 if lower(raw) ~ '(pterygium)' then return 'Pterygium';end if;
 if lower(raw) ~ '(\ydcr\y|dacryo|watering eye)' then return 'DCR';end if;
 if lower(raw) ~ '(ptosis|oculoplasty|chalazion|dermoid)' then return 'Oculoplasty';end if;
 if lower(raw) ~ '(spectacle|glasses|specs|eye power|\ypower\y)' then return 'Spectacles';end if;
 return case when from_notes then '' else raw end;end $$;
create or replace function public.crm_treatment_key(disease text,remarks text) returns text language sql immutable set search_path='' as $$ select case when public.crm_treatment_text(disease,remarks)='' then 'unrecorded' else coalesce(nullif(btrim(regexp_replace(lower(public.crm_treatment_text(disease,remarks)),'[^a-z0-9]+','-','g'),'-'),''),'other') end $$;
revoke all on function public.crm_treatment_text(text,text),public.crm_treatment_key(text,text) from public,anon;
grant execute on function public.crm_treatment_text(text,text),public.crm_treatment_key(text,text) to authenticated;
alter table public.leads add column treatment_key text generated always as(public.crm_treatment_key(disease,remarks)) stored;
create index crm_lead_treatment_idx on public.leads(treatment_key);

create or replace function public.crm_analytics_groups(p_from date,p_to date) returns table(
 id text,name text,city text,disease text,remarks text,source text,status text,temperature text,assigned_to text,lead_date text,created_at timestamptz,aggregate_count bigint
) language sql stable security invoker set search_path='' as $$
 select 'summary:'||md5(concat_ws('|',date_trunc('month',lead_day),l.city,public.crm_treatment_text(l.disease,l.remarks),l.source,l.status,l.temperature,l.assigned_to)),''::text,l.city,public.crm_treatment_text(l.disease,l.remarks),
 ''::text,l.source,l.status,l.temperature::text,l.assigned_to,
 greatest(date_trunc('month',lead_day)::date,p_from)::text, greatest(date_trunc('month',lead_day)::date,p_from)::timestamptz,count(*)
 from public.leads l where l.lead_day between p_from and p_to
 group by date_trunc('month',lead_day),l.city,public.crm_treatment_text(l.disease,l.remarks),l.source,l.status,l.temperature,l.assigned_to
 order by date_trunc('month',lead_day),l.city,public.crm_treatment_text(l.disease,l.remarks),l.source,l.status,l.temperature,l.assigned_to
$$;
create or replace function public.crm_lead_months() returns table(key text,count bigint) language sql stable security invoker set search_path='' as $$ select to_char(lead_day,'YYYY-MM'),count(*) from public.leads group by 1 order by 1 desc $$;
create or replace function public.crm_team_groups() returns table(assigned_to text,status text,temperature text,count bigint) language sql stable security invoker set search_path='' as $$ select assigned_to,status,temperature::text,count(*) from public.leads group by 1,2,3 order by 1,2,3 $$;
create or replace function public.crm_treatment_groups(p jsonb) returns table(disease text,remarks text,aggregate_count bigint) language sql stable security invoker set search_path='' as $$
 select public.crm_treatment_text(l.disease,l.remarks),''::text,count(*) from public.leads l where
 (coalesce(p->>'city','')='' or lower(btrim(l.city))=lower(p->>'city')) and
 (coalesce(p->>'source','')='' or lower(btrim(l.source))=lower(p->>'source')) and
 (coalesce(p->>'assigned','')='' or lower(btrim(l.assigned_to))=lower(p->>'assigned')) and
 (coalesce(p->>'status','')='' or case when lower(p->>'status') in('hot','warm','cold') then lower(l.temperature::text)=lower(p->>'status') else lower(btrim(l.status))=lower(p->>'status') end) and
 (coalesce(p->>'q','')='' or strpos(lower(coalesce(l.name,'')),lower(p->>'q'))>0 or strpos(lower(coalesce(l.phone,'')),lower(p->>'q'))>0 or strpos(lower(coalesce(l.disease,'')),lower(p->>'q'))>0) and
 (p->>'from_created' is null or l.created_at>=(p->>'from_created')::timestamptz) and
 (p->>'to_created' is null or l.created_at<(p->>'to_created')::timestamptz) and
 (p->>'from_day' is null or l.lead_day>=(p->>'from_day')::date) and (p->>'to_day' is null or l.lead_day<=(p->>'to_day')::date) and
 (not p ? 'statuses' or l.status in(select jsonb_array_elements_text(p->'statuses'))) and
 (coalesce(p->>'assignmentStatus','')='' or
 (p->>'assignmentStatus'='assigned')=exists(select 1 from public.profiles pr where lower(btrim(pr.name))=lower(btrim(l.assigned_to)))) and
 (coalesce(p->>'work','')='' or (p->>'work'='assigned' and l.assigned_at>=(p->>'day')::date::timestamp at time zone 'Asia/Kolkata' and l.assigned_at<((p->>'day')::date+1)::timestamp at time zone 'Asia/Kolkata') or
 exists(select 1 from public.crm_appointments a where a.lead_id=l.id and a.starts_on=(p->>'day')::date and a.status not in('cancelled','no_show') and
 case p->>'work' when 'opd' then a.kind in('opdBooked','opdDone') when 'opdDone' then a.kind in('opdBooked','opdDone') and a.status='completed' when 'ipd' then a.kind='ipdDone' when 'ipdDone' then a.kind='ipdDone' and a.status='completed' else false end))
 group by 1,2 order by 1,2
$$;
revoke all on function public.crm_analytics_groups(date,date),public.crm_lead_months(),public.crm_team_groups(),public.crm_treatment_groups(jsonb) from public,anon;
grant execute on function public.crm_analytics_groups(date,date),public.crm_lead_months(),public.crm_team_groups(),public.crm_treatment_groups(jsonb) to authenticated;

create or replace function public.crm_log_call(p_lead uuid,p_outcome text,p_notes text,p_next date default null,p_time time default null) returns public.lead_activities language plpgsql security invoker set search_path='' as $$
declare entry public.lead_activities; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_outcome not in('Connected','No Answer','Call Back Later','Switched Off','Not Reachable','Wrong Number','Not Interested') then raise exception 'Invalid call outcome'; end if;
 perform 1 from public.leads where id=p_lead for update; if not found then raise exception 'Lead is unavailable'; end if;
 if length(coalesce(p_notes,''))>5000 then raise exception 'Call notes are too long'; end if;
 if p_time is not null and p_next is null then raise exception 'Choose a callback date for the time'; end if;
 if p_next is not null then update public.leads set follow_up_date=p_next::text,follow_up_at=case when p_time is not null then (p_next+p_time) at time zone 'Asia/Kolkata' else null end where id=p_lead; else update public.leads set updated_at=clock_timestamp() where id=p_lead;end if;
 insert into public.lead_activities(lead_id,user_id,action_type,call_outcome,description)
 values(p_lead,auth.uid(),'Call',p_outcome,concat_ws(' — ','Outcome: '||p_outcome,nullif(p_notes,''),case when p_next is not null then 'Next follow-up: '||p_next::text||coalesce(' '||p_time::text,'') end)) returning * into entry;
 return entry;
end $$;
revoke all on function public.crm_log_call(uuid,text,text,date,time) from public,anon;
grant execute on function public.crm_log_call(uuid,text,text,date,time) to authenticated;

create or replace function public.crm_task_page(p_bucket text default 'all',p_search text default '',p_page int default 1) returns jsonb language sql stable security invoker set search_path='' as $$
 with scoped as(select * from public.leads where follow_up_day is not null and lower(btrim(status)) not in('lost','dropped','ipd done','surgery completed','won')),
 filtered as(select * from scoped where (p_search='' or strpos(lower(concat_ws(' ',name,phone,disease,assigned_to,source)),lower(p_search))>0)
 and case p_bucket when 'overdue' then follow_up_day<(now() at time zone 'Asia/Kolkata')::date when 'today' then follow_up_day=(now() at time zone 'Asia/Kolkata')::date when 'upcoming' then follow_up_day>(now() at time zone 'Asia/Kolkata')::date else true end),
 page as(select id,name,phone,disease,follow_up_date,follow_up_at,status,temperature,assigned_to,source,remarks from filtered order by follow_up_day,coalesce(follow_up_at,'infinity'::timestamptz),id limit 50 offset (greatest(1,least(p_page,100000))-1)*50)
 select jsonb_build_object('leads',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from filtered),
 'stats',(select jsonb_build_object('total',count(*),'overdue',count(*) filter(where follow_up_day<(now() at time zone 'Asia/Kolkata')::date),'today',count(*) filter(where follow_up_day=(now() at time zone 'Asia/Kolkata')::date),'upcoming',count(*) filter(where follow_up_day>(now() at time zone 'Asia/Kolkata')::date)) from scoped))
$$;
revoke all on function public.crm_task_page(text,text,int) from public,anon;
grant execute on function public.crm_task_page(text,text,int) to authenticated;

create index if not exists crm_owner_followup_idx on public.leads((lower(btrim(assigned_to))),follow_up_day);
