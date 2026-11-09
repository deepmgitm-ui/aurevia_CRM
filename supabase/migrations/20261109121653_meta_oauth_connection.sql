create table if not exists public.crm_meta_connections (
  id text primary key check (id = 'primary'),
  credentials_ciphertext text not null,
  credentials_iv text not null,
  credentials_auth_tag text not null,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_meta_connections enable row level security;
revoke all on public.crm_meta_connections from public, anon, authenticated;
grant all on public.crm_meta_connections to service_role;
