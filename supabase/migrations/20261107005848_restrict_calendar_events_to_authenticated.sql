-- Calendar events belong to signed-in users only. Explicitly scope policies to
-- authenticated so anon cannot reach these policies even if table grants drift.
alter policy calendar_events_select_own on public.calendar_events
  to authenticated;

alter policy calendar_events_insert_own on public.calendar_events
  to authenticated;

alter policy calendar_events_update_own on public.calendar_events
  to authenticated;

alter policy calendar_events_delete_own on public.calendar_events
  to authenticated;
