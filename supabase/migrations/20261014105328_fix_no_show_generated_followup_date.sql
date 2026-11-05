-- follow_up_day is generated from follow_up_date; only write the source field.
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

revoke all on function public.crm_change_appointment_status(uuid,text) from public,anon;
grant execute on function public.crm_change_appointment_status(uuid,text) to authenticated;
