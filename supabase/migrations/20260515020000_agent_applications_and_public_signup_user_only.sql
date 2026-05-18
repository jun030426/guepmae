create or replace function public.normalize_public_signup_role(requested_role text)
returns public.app_role
language sql
immutable
as $$
  select 'user'::public.app_role;
$$;

create table if not exists public.agent_applications (
  id uuid primary key default gen_random_uuid(),
  office_name text not null,
  office_registration_number text not null,
  office_address text,
  representative_name text not null,
  representative_phone text not null,
  contact_email text not null,
  contact_phone text,
  document_paths jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'reviewing', 'approved', 'rejected')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_agent_applications_updated_at on public.agent_applications;
create trigger set_agent_applications_updated_at
before update on public.agent_applications
for each row
execute function public.set_updated_at();

create index if not exists agent_applications_status_idx on public.agent_applications (status);
create index if not exists agent_applications_created_at_idx on public.agent_applications (created_at desc);

alter table public.agent_applications enable row level security;

grant insert on public.agent_applications to anon, authenticated;
grant select, update on public.agent_applications to authenticated;

drop policy if exists "Anyone can create agent applications" on public.agent_applications;
create policy "Anyone can create agent applications"
on public.agent_applications
for insert
to anon, authenticated
with check (true);

drop policy if exists "Admins can read agent applications" on public.agent_applications;
create policy "Admins can read agent applications"
on public.agent_applications
for select
to authenticated
using (public.current_user_role() = 'admin'::public.app_role);

drop policy if exists "Admins can update agent applications" on public.agent_applications;
create policy "Admins can update agent applications"
on public.agent_applications
for update
to authenticated
using (public.current_user_role() = 'admin'::public.app_role)
with check (public.current_user_role() = 'admin'::public.app_role);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-application-documents',
  'agent-application-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can upload pending agent application documents" on storage.objects;
create policy "Public can upload pending agent application documents"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'agent-application-documents'
  and (storage.foldername(name))[1] = 'pending'
);

drop policy if exists "Admins can read agent application documents" on storage.objects;
create policy "Admins can read agent application documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'agent-application-documents'
  and public.current_user_role() = 'admin'::public.app_role
);
