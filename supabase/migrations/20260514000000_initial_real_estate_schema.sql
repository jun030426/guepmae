create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.properties (
  id text primary key,
  title text not null,
  address text not null,
  coordinates jsonb,
  region text not null,
  property_type text not null,
  price bigint not null,
  actual_transaction_price bigint,
  discount_rate numeric(5, 2) not null default 0,
  urgent_score integer not null default 0,
  area numeric(8, 2),
  supply_area numeric(8, 2),
  floor text,
  built_year integer,
  image_label text,
  verified boolean not null default false,
  last_verified_at date,
  recent_transaction_date date,
  description text,
  parking text,
  maintenance_fee bigint,
  move_in_date text,
  rooms integer,
  bathrooms integer,
  agent jsonb not null default '{}'::jsonb,
  lifestyle jsonb not null default '{}'::jsonb,
  price_history jsonb not null default '[]'::jsonb,
  media jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_properties_updated_at on public.properties;
create trigger set_properties_updated_at
before update on public.properties
for each row
execute function public.set_updated_at();

create index if not exists properties_verified_idx on public.properties (verified);
create index if not exists properties_discount_rate_idx on public.properties (discount_rate desc);
create index if not exists properties_region_idx on public.properties (region);

alter table public.properties enable row level security;

grant select on public.properties to anon, authenticated;

drop policy if exists "Public can read verified properties" on public.properties;
create policy "Public can read verified properties"
on public.properties
for select
to anon, authenticated
using (verified = true);

create table if not exists public.property_submissions (
  id uuid primary key default gen_random_uuid(),
  property_type text not null,
  address text not null,
  complex_name text,
  area numeric(8, 2),
  desired_price bigint,
  recent_transaction_price bigint,
  floor text,
  built_year integer,
  move_in_date text,
  reason text,
  discount_rate numeric(5, 2) not null default 0,
  price_gap bigint not null default 0,
  urgent_score integer not null default 0,
  is_urgent boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'reviewing', 'approved', 'rejected')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_property_submissions_updated_at on public.property_submissions;
create trigger set_property_submissions_updated_at
before update on public.property_submissions
for each row
execute function public.set_updated_at();

create index if not exists property_submissions_status_idx on public.property_submissions (status);
create index if not exists property_submissions_created_at_idx on public.property_submissions (created_at desc);

alter table public.property_submissions enable row level security;

grant insert on public.property_submissions to anon, authenticated;

drop policy if exists "Anyone can create property submissions" on public.property_submissions;
create policy "Anyone can create property submissions"
on public.property_submissions
for insert
to anon, authenticated
with check (true);
