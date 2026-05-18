do $$
begin
  create type public.app_role as enum ('user', 'seller', 'agent', 'admin');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.seller_verification_status as enum ('not_required', 'pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  role public.app_role not null default 'user',
  favorite_region text,
  seller_property_address text,
  seller_verification_status public.seller_verification_status not null default 'not_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create table if not exists public.seller_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  property_address text not null,
  document_path text not null,
  document_type text,
  status public.seller_verification_status not null default 'pending',
  reviewer_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_seller_verifications_updated_at on public.seller_verifications;
create trigger set_seller_verifications_updated_at
before update on public.seller_verifications
for each row
execute function public.set_updated_at();

create or replace function public.normalize_public_signup_role(requested_role text)
returns public.app_role
language sql
immutable
as $$
  select case
    when requested_role = 'seller' then 'seller'::public.app_role
    else 'user'::public.app_role
  end;
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.app_role;
  proof_path text;
  property_address text;
begin
  requested_role := public.normalize_public_signup_role(new.raw_user_meta_data ->> 'requested_role');
  proof_path := new.raw_user_meta_data ->> 'seller_proof_path';
  property_address := new.raw_user_meta_data ->> 'seller_property_address';

  insert into public.profiles (
    id,
    email,
    full_name,
    phone,
    role,
    favorite_region,
    seller_property_address,
    seller_verification_status
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    requested_role,
    nullif(new.raw_user_meta_data ->> 'favorite_region', ''),
    nullif(property_address, ''),
    case
      when requested_role = 'seller'::public.app_role and nullif(proof_path, '') is not null then 'pending'::public.seller_verification_status
      when requested_role = 'seller'::public.app_role then 'rejected'::public.seller_verification_status
      else 'not_required'::public.seller_verification_status
    end
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    favorite_region = excluded.favorite_region,
    seller_property_address = excluded.seller_property_address,
    updated_at = now();

  if requested_role = 'seller'::public.app_role and nullif(proof_path, '') is not null then
    insert into public.seller_verifications (
      user_id,
      property_address,
      document_path,
      document_type,
      status
    )
    values (
      new.id,
      coalesce(nullif(property_address, ''), '주소 확인 필요'),
      proof_path,
      nullif(new.raw_user_meta_data ->> 'seller_document_type', ''),
      'pending'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists seller_verifications_user_id_idx on public.seller_verifications (user_id);
create index if not exists seller_verifications_status_idx on public.seller_verifications (status);

alter table public.profiles enable row level security;
alter table public.seller_verifications enable row level security;

grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;
grant select, update on public.seller_verifications to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id or public.current_user_role() = 'admin'::public.app_role);

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles
for update
to authenticated
using (public.current_user_role() = 'admin'::public.app_role)
with check (public.current_user_role() = 'admin'::public.app_role);

drop policy if exists "Sellers can read their own verification" on public.seller_verifications;
create policy "Sellers can read their own verification"
on public.seller_verifications
for select
to authenticated
using ((select auth.uid()) = user_id or public.current_user_role() = 'admin'::public.app_role);

drop policy if exists "Admins can update seller verifications" on public.seller_verifications;
create policy "Admins can update seller verifications"
on public.seller_verifications
for update
to authenticated
using (public.current_user_role() = 'admin'::public.app_role)
with check (public.current_user_role() = 'admin'::public.app_role);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seller-verification-documents',
  'seller-verification-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can upload pending seller verification documents" on storage.objects;
create policy "Public can upload pending seller verification documents"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'seller-verification-documents'
  and (storage.foldername(name))[1] = 'pending'
);

drop policy if exists "Admins can read seller verification documents" on storage.objects;
create policy "Admins can read seller verification documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'seller-verification-documents'
  and public.current_user_role() = 'admin'::public.app_role
);
