-- ---------------------------------------------------------------------------
-- Aurevia CRM — performance indexes (Phase 0)
--
-- Safe to run repeatedly. Every index below backs a query the app actually
-- issues: the paginated leads table, the dashboard aggregations, the KPI counts
-- and the "recent leads" age buckets. Without them Postgres does a sequential
-- scan on every page load (fine at 892 rows, painful at 50k).
--
-- Run in: Supabase dashboard → SQL Editor → paste → Run.
-- ---------------------------------------------------------------------------

-- Table lookups / filters used by the leads table and every dashboard query.
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_assigned_to_idx on public.leads (assigned_to);
create index if not exists leads_temperature_idx on public.leads (temperature);
create index if not exists leads_source_idx on public.leads (source);
create index if not exists leads_city_idx on public.leads (city);
create index if not exists leads_disease_idx on public.leads (disease);
create index if not exists leads_lead_date_idx on public.leads (lead_date);
create index if not exists leads_follow_up_date_idx on public.leads (follow_up_date);

-- Dashboard drill-downs: "LASIK + Surgery Completed + this week".
create index if not exists leads_status_assigned_idx on public.leads (status, assigned_to);

-- Newest-first lists and the "NEW lead" highlight all walk created_at; the
-- phone index powers the Meta webhook's 24-hour duplicate check + the search bar.
create index if not exists leads_status_created_idx on public.leads (status, created_at desc);
create index if not exists leads_assigned_created_idx on public.leads (assigned_to, created_at desc);
create index if not exists leads_phone_idx on public.leads (phone);

-- ---------------------------------------------------------------------------
-- Fuzzy search ("Search ALL leads: name, phone, treatment...")
-- pg_trgm turns the leading-wildcard ILIKE pattern into an index scan instead
-- of a full table scan. The extension ships with Supabase (no cost).
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists leads_name_trgm_idx on public.leads using gin (name gin_trgm_ops);
create index if not exists leads_phone_trgm_idx on public.leads using gin (phone gin_trgm_ops);
create index if not exists leads_disease_trgm_idx on public.leads using gin (disease gin_trgm_ops);
create index if not exists leads_remarks_trgm_idx on public.leads using gin (remarks gin_trgm_ops);
create index if not exists leads_city_trgm_idx on public.leads using gin (city gin_trgm_ops);

-- Lead activities timeline (lead detail page) — newest first per lead.
create index if not exists lead_activities_lead_id_idx on public.lead_activities (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Optional: a lightweight view so future dashboards can aggregate inside
-- Postgres instead of shipping every row to the server. Non-breaking.
-- ---------------------------------------------------------------------------
create or replace view public.lead_rollup as
select
  date_trunc('month', created_at)::date as month,
  coalesce(nullif(trim(disease), ''), '-') as treatment,
  coalesce(nullif(trim(city), ''), '-') as city,
  coalesce(nullif(trim(source), ''), 'Manual') as source,
  coalesce(nullif(trim(assigned_to), ''), '-') as assigned_to,
  status,
  count(*) as leads
from public.leads
group by 1, 2, 3, 4, 5, 6;
