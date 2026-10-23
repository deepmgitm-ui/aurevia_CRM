create table public.crm_star_of_month (
  month_start date primary key check (extract(day from month_start) = 1),
  profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.crm_star_of_month enable row level security;

create policy crm_star_of_month_read_authenticated
  on public.crm_star_of_month
  for select to authenticated
  using (true);

create policy crm_star_of_month_admin_manage
  on public.crm_star_of_month
  for all to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');

grant select, insert, update, delete on public.crm_star_of_month to authenticated;
revoke all on public.crm_star_of_month from anon;
