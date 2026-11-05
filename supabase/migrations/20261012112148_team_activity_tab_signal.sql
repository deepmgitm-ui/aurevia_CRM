-- Multi-tab signals renew activity without increasing credited duration.
create or replace function crm_private.stamp_user_activity() returns trigger language plpgsql
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
  if elapsed<45 then
   -- An idle tab must not suppress another tab's fresh interaction signal.
   -- Preserve last_seen and both totals, so this never double-credits time.
   if new.activity_signal and (old.last_active is null or old.last_active<t-interval '45 seconds') then
    new.first_seen:=old.first_seen;new.last_seen:=old.last_seen;
    new.session_started_at:=old.session_started_at;
    new.online_seconds:=old.online_seconds;new.active_seconds:=old.active_seconds;
    new.last_active:=t;return new;
   end if;
   return null;
  end if;
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
