# Calendars and capacity

- Language Issue is the selectable status; old Language values remain in its
  status card and filter without rewriting leads.
- Employees can open the appointments calendar. The appointment query and RLS
  both restrict them to leads assigned to their profile. Calendar editing is
  still limited by the existing admin permissions.
- The Follow-up Calendar lists scheduled follow-up dates only for the signed-in
  user's assigned leads. Date changes invalidate the calendar route.
- Lead detail appointment dates use the same status-to-column map and save
  action as the Leads table. Follow-Up rows expose the existing follow-up date.
- Admin Settings measures database relations and all current project storage
  object sizes through `crm_capacity_breakdown`, with admin-only authorization.
  Its 6-person / 100-leads-per-day estimate is an illustration using 1–3 times
  the current lead, activity and assignment footprint per lead. Other tables,
  backups, file storage, organization-wide storage, traffic and quotas can
  shorten it; the Supabase usage dashboard is authoritative for plan usage.
- Migration `20261030124221_capacity_breakdown_and_storage.sql` adds an
  aggregate function and does not modify existing lead rows.
