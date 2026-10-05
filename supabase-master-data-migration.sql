-- Aurevia CRM — master data (admin-editable picklists).
-- Idempotent: every statement can be re-run safely.
--
-- WHY: dropdown options (lead statuses, treatments, sources, cities, ...) were
-- hardcoded in the client. An admin can now change them at runtime in
-- Settings -> Master Data instead of waiting for a code deploy. If this table
-- is missing or empty, the app falls back to the seed in lib/master-data.ts,
-- so nothing ever renders a broken/empty select.
--
-- ---------------------------------------------------------------------------
-- crm_option_lists: one row per list key, holding an ordered string array.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_option_lists (
  key text primary key,
  options text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.crm_option_lists enable row level security;

-- Everyone signed in can READ the lists (they feed every dropdown).
drop policy if exists crm_option_lists_select_all on public.crm_option_lists;
create policy crm_option_lists_select_all
on public.crm_option_lists for select
to authenticated
using (true);

-- Only admins/managers can WRITE them (Settings screen enforces the same).
drop policy if exists crm_option_lists_write_admin_manager on public.crm_option_lists;
create policy crm_option_lists_write_admin_manager
on public.crm_option_lists for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

-- ---------------------------------------------------------------------------
-- Seed: the same values the app previously hardcoded (see lib/master-data.ts
-- MASTER_DATA_SEED). `on conflict do nothing` keeps admin edits intact on
-- re-runs — the migration only fills lists that do not exist yet.
-- ---------------------------------------------------------------------------
insert into public.crm_option_lists (key, options) values
  ('statuses', array[
    'New', 'Follow Up', 'Contacted', 'DNP', 'DNP 3', 'RNR',
    'Not Interested', 'Budget Issue', 'Location Issue', 'Non Surgical',
    'Consultation Booked', 'Consultation Attended', 'Surgery Completed',
    'OPD Booked', 'OPD Done', 'IPD Done',
    'Invalid Number', 'Lost', 'Won'
  ]),
  ('treatments', array['LASIK', 'Cataract', 'ICL', 'Retina', 'Spectacles', 'Other']),
  ('sources', array[
    'Meta Ads', 'Online Enquiry', 'Agent Referral', 'Doctor Referral',
    'Walk-in', 'Corporate Tie-up', 'Social Media', 'Manual', 'Excel/CSV'
  ]),
  ('cities', array['Mumbai', 'Pune', 'Delhi', 'Nagpur', 'Thane', 'Nashik']),
  ('temperatures', array['Hot', 'Warm', 'Cold'])
on conflict (key) do nothing;

comment on table public.crm_option_lists is
  'Admin-editable dropdown options (statuses, treatments, sources, cities, temperatures).';

-- ---------------------------------------------------------------------------
-- OPD / IPD appointment dates.
--
-- THREE columns, not one: each status owns its own date, so booking a patient
-- for OPD and then booking their IPD surgery keeps BOTH dates. A single
-- "appointment_date" column would silently overwrite the first date the moment
-- the status moved from OPD Booked to IPD Done, and the calendar would lose
-- the booking day.
--
-- Nullable on purpose (unlike the legacy '-' convention): a missing date and
-- an empty string should not be different things in new code.
--
-- Re-runnable. Safe to apply to an existing database.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists opd_booked_date text null,
  add column if not exists opd_done_date text null,
  add column if not exists ipd_done_date text null;

comment on column public.leads.opd_booked_date is
  'Day the OPD appointment was booked (set when status = OPD Booked).';
comment on column public.leads.opd_done_date is
  'Day the OPD happened (set when status = OPD Done).';
comment on column public.leads.ipd_done_date is
  'Day of admission / surgery (set when status = IPD Done).';

-- The calendar now reads these three columns instead of leads.follow_up_date.
-- A partial index keeps the month view cheap: it only scans leads that HAVE an
-- appointment date.
create index if not exists leads_opd_booked_date_idx
  on public.leads (opd_booked_date)
  where opd_booked_date is not null;
create index if not exists leads_opd_done_date_idx
  on public.leads (opd_done_date)
  where opd_done_date is not null;
create index if not exists leads_ipd_done_date_idx
  on public.leads (ipd_done_date)
  where ipd_done_date is not null;

-- ---------------------------------------------------------------------------
-- 'Lost' is retired from the picker.
--
-- Existing leads are moved to 'Dropped' rather than deleted, so the history
-- (and every report that counted them) survives. 'Not Interested' is NOT the
-- same thing and is deliberately left alone — it is still a live option and
-- the clinic uses it to mean "asked, said no", which is different from a deal
-- that went cold.
--
-- Both values are matched case-insensitively; leading/trailing spaces in
-- imported spreadsheets are ignored.
-- ---------------------------------------------------------------------------
update public.leads
set status = 'Dropped'
where btrim(status) ilike 'lost';

-- 'Won' stops being a storable status: it is now a computed tag shown whenever
-- the status is OPD Done / IPD Done / Surgery Completed. Fold the old rows so
-- no lead is left carrying a value the UI can never explain.
update public.leads
set status = 'Surgery Completed'
where btrim(status) ilike 'won';

comment on column public.leads.status is
  'Pipeline status. "Won" is NOT stored here — it is derived from OPD Done / IPD Done / Surgery Completed.';
