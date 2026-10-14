-- Security-definer helpers run only with explicitly qualified objects and
-- built-ins, so an object in an exposed schema cannot shadow their lookups.
alter function public.current_user_role() set search_path = '';
alter function public.crm_scheduler_status() set search_path = '';
alter function public.set_updated_at() set search_path = pg_catalog;

do $$
declare
  target regprocedure;
begin
  target := to_regprocedure('public.admin_update_employee_profile(uuid,text,text,text,text,text,text,text,text)');
  if target is not null then
    execute format('alter function %s set search_path = %L', target, '');
  end if;

  target := to_regprocedure('public.update_my_employee_profile(text,text,text,text,text,text,text)');
  if target is not null then
    execute format('alter function %s set search_path = %L', target, '');
  end if;
end;
$$;
