-- One compact record per staff member per IST day, never one row per heartbeat.
create table public.crm_user_activity (
 user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 day date not null default ((now() at time zone 'Asia/Kolkata')::date),
 first_seen timestamptz not null default now(),
 last_seen timestamptz not null default now(),
 last_active timestamptz,
 session_started_at timestamptz not null default now(),
 online_seconds integer not null default 0 check(online_seconds between 0 and 86400),
 active_seconds integer not null default 0 check(active_seconds between 0 and online_seconds),
 activity_signal boolean not null default false,
 primary key(user_id,day)
);
alter table public.crm_user_activity enable row level security;
revoke all on public.crm_user_activity from public,anon,authenticated;
grant select on public.crm_user_activity to authenticated;
grant insert(activity_signal),update(activity_signal) on public.crm_user_activity to authenticated;
create policy crm_activity_read on public.crm_user_activity for select to authenticated
 using(user_id=(select auth.uid()) or public.current_user_role() in('admin','manager'));
create policy crm_activity_insert on public.crm_user_activity for insert to authenticated
 with check(user_id=(select auth.uid()) and day=(now() at time zone 'Asia/Kolkata')::date);
create policy crm_activity_update on public.crm_user_activity for update to authenticated
 using(user_id=(select auth.uid()) and day=(now() at time zone 'Asia/Kolkata')::date)
 with check(user_id=(select auth.uid()) and day=(now() at time zone 'Asia/Kolkata')::date);

-- Only the user's activity signal is writable. All clocks and totals come from
-- the database; row locking prevents concurrent tabs from doubling duration.
create function crm_private.stamp_user_activity() returns trigger language plpgsql
 set search_path='' as $$
declare t timestamptz:=clock_timestamp();elapsed integer;credited integer;
begin
 if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception 'Own activity only';end if;
 if new.day is distinct from (t at time zone 'Asia/Kolkata')::date then raise exception 'Current day only';end if;
 if tg_op='INSERT' then
  new.first_seen:=t;new.last_seen:=t;new.session_started_at:=t;
  new.online_seconds:=0;new.active_seconds:=0;
  new.last_active:=case when new.activity_signal then t end;
 else
  elapsed:=greatest(0,floor(extract(epoch from t-old.last_seen))::int);
  -- Suppress duplicate-tab writes and overly frequent requests.
  if elapsed<45 then return null;end if;
  new.first_seen:=old.first_seen;new.last_seen:=t;
  new.last_active:=case when new.activity_signal then t else old.last_active end;
  new.session_started_at:=case when elapsed>150 then t else old.session_started_at end;
  -- Never credit sleep, closed tabs, network gaps, or a missed long interval.
  credited:=case when elapsed<=90 then elapsed else 0 end;
  new.online_seconds:=least(86400,old.online_seconds+credited);
  new.active_seconds:=least(new.online_seconds,old.active_seconds+
   case when old.last_active is null then 0 else
   least(credited,greatest(0,floor(extract(epoch from (old.last_active+interval '5 minutes')-old.last_seen))::int)) end);
 end if;
 return new;
end $$;
revoke all on function crm_private.stamp_user_activity() from public,anon,authenticated;
create trigger crm_activity_stamp before insert or update on public.crm_user_activity
 for each row execute function crm_private.stamp_user_activity();

create function public.crm_activity_heartbeat(p_active boolean) returns void language plpgsql
 security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 insert into public.crm_user_activity(activity_signal) values(coalesce(p_active,false))
 on conflict(user_id,day) do update set activity_signal=excluded.activity_signal;
end $$;
revoke all on function public.crm_activity_heartbeat(boolean) from public,anon;
grant execute on function public.crm_activity_heartbeat(boolean) to authenticated;

create function public.crm_activity_roster(p_day date default ((now() at time zone 'Asia/Kolkata')::date))
returns table(user_id uuid,name text,role text,first_seen timestamptz,last_seen timestamptz,last_active timestamptz,session_started_at timestamptz,online_seconds integer,active_seconds integer,observed_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select p.id,p.name,p.role::text,a.first_seen,a.last_seen,a.last_active,a.session_started_at,
 coalesce(a.online_seconds,0),coalesce(a.active_seconds,0),now()
 from public.profiles p left join public.crm_user_activity a on a.user_id=p.id and a.day=p_day
 where p.id=auth.uid() or public.current_user_role() in('admin','manager') order by p.name,p.id
$$;
revoke all on function public.crm_activity_roster(date) from public,anon;
grant execute on function public.crm_activity_roster(date) to authenticated;
