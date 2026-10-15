-- Apply before deploying the new frontend. Only property-write may persist
-- client changes; service-role import jobs remain a trusted administrative path.
begin;

alter table public.properties
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists complex_name text,
  add column if not exists complex_gu text,
  add column if not exists unit_count integer,
  add column if not exists revision bigint not null default 1;
create index if not exists properties_created_by_idx on public.properties(created_by);

-- Historical agent.email was client-controlled. Never use it to grant ownership.
-- Legacy rows without created_by are staff-managed until independently verified.
update public.properties set
  complex_name = coalesce(complex_name, price_basis ->> 'complexName'),
  complex_gu = coalesce(complex_gu, price_basis ->> 'gu');

-- Existing profile policies also use this helper. A suspended administrator
-- must not be able to remove their suspension through another privileged user.
create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and suspended = false
$$;
revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;

alter table public.properties enable row level security;
-- Replace ALL property policies, including permissive policies created manually.
do $$ declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'properties'
  loop execute format('drop policy %I on public.properties', p.policyname); end loop;
end $$;
revoke all on public.properties from public, anon, authenticated;
-- Table-level REVOKE does not remove old column-level privileges.
do $$ declare c record;
begin
  for c in select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'properties'
  loop
    execute format('revoke all (%I) on public.properties from public, anon, authenticated', c.column_name);
  end loop;
end $$;
grant select on public.properties to anon, authenticated;
grant delete on public.properties to authenticated;
grant all on public.properties to service_role;

create policy properties_public_read on public.properties for select
to anon, authenticated using (verified = true);
create policy properties_management_read on public.properties for select
to authenticated using (
  (select public.current_user_role())::text in ('admin', 'owner')
  or ((select public.current_user_role())::text = 'agent' and created_by = (select auth.uid()))
);
create policy properties_management_delete on public.properties for delete
to authenticated using (
  (select public.current_user_role())::text in ('admin', 'owner')
  or ((select public.current_user_role())::text = 'agent' and created_by = (select auth.uid()))
);
-- Deliberately no browser INSERT / UPDATE policy or grant.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.bump_property_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.bump_property_revision() from public, anon, authenticated;
create trigger bump_property_revision before update on public.properties
for each row execute function private.bump_property_revision();

-- Only the server can call this function. Recheck role/ownership while holding
-- row locks, so approval cannot publish a different revision and suspension
-- cannot race a write. No SECURITY DEFINER privilege escalation is needed.
create or replace function public.commit_property_change(
  p_actor uuid, p_action text, p_id text, p_expected_revision bigint, p_row jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  current_row public.properties%rowtype;
  next_row public.properties%rowtype;
begin
  select * into actor from public.profiles where id = p_actor for share;
  if not found or actor.suspended or actor.role::text not in ('agent', 'admin', 'owner') then
    raise exception '매물을 관리할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_action not in ('create', 'edit', 'verify') or p_action is null then
    raise exception '잘못된 작업입니다.' using errcode = '22023';
  end if;
  if p_action = 'verify' and actor.role::text not in ('admin', 'owner') then
    raise exception '운영진만 승인할 수 있습니다.' using errcode = '42501';
  end if;
  if p_action <> 'create' then
    select * into current_row from public.properties where id = p_id for update;
    if not found then raise exception '매물을 찾을 수 없습니다.' using errcode = 'P0002'; end if;
    if actor.role::text = 'agent' and current_row.created_by is distinct from p_actor then
      raise exception '자신의 매물만 수정할 수 있습니다.' using errcode = '42501';
    end if;
    if current_row.revision is distinct from p_expected_revision then
      raise exception '매물이 변경되었습니다. 새로고침 후 다시 확인해주세요.' using errcode = '40001';
    end if;
  end if;
  next_row := jsonb_populate_record(current_row, coalesce(p_row, '{}'::jsonb));
  next_row.id := p_id;
  next_row.created_by := case when p_action = 'create' then p_actor else current_row.created_by end;
  next_row.verified := p_action = 'verify' and coalesce((p_row ->> 'verified')::boolean, false);
  next_row.last_verified_at := case when next_row.verified then current_date else null end;
  if next_row.price is null or next_row.price <= 0 or next_row.area is null or next_row.area <= 0 then
    raise exception '가격과 면적은 양수여야 합니다.' using errcode = '22023';
  end if;
  if p_action = 'create' then
    next_row.created_at := now();
    next_row.updated_at := now();
    next_row.revision := 1;
    next_row.urgent_score := 0;
    next_row.agent := coalesce(next_row.agent, '{}'::jsonb);
    next_row.lifestyle := coalesce(next_row.lifestyle, '{}'::jsonb);
    next_row.price_history := coalesce(next_row.price_history, '[]'::jsonb);
    next_row.media := coalesce(next_row.media, '[]'::jsonb);
    insert into public.properties select next_row.* returning * into current_row;
  else
    update public.properties set
      title = next_row.title, price = next_row.price, floor = next_row.floor,
      direction = next_row.direction, occupancy_status = next_row.occupancy_status,
      rooms = next_row.rooms, bathrooms = next_row.bathrooms, parking = next_row.parking,
      description = next_row.description, media = next_row.media,
      actual_transaction_price = next_row.actual_transaction_price,
      discount_rate = next_row.discount_rate, price_basis = next_row.price_basis,
      verified = next_row.verified, last_verified_at = next_row.last_verified_at
    where id = p_id returning * into current_row;
  end if;
  return jsonb_build_object('id', current_row.id, 'revision', current_row.revision, 'verified', current_row.verified);
end $$;
revoke all on function public.commit_property_change(uuid, text, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_property_change(uuid, text, text, bigint, jsonb) to service_role;

-- Existing permissive Storage policies allow any agent to overwrite any photo.
-- New paths start with auth.uid(); restrictive policies constrain all old grants.
create policy property_media_insert_guard on storage.objects as restrictive for insert to authenticated
with check (bucket_id not in ('property-photos', 'property-360', 'property-3d') or (
  (select public.current_user_role())::text in ('agent', 'admin', 'owner')
  and ((select public.current_user_role())::text in ('admin', 'owner') or split_part(name, '/', 1) = (select auth.uid())::text)
));
create policy property_media_update_guard on storage.objects as restrictive for update to authenticated
using (bucket_id not in ('property-photos', 'property-360', 'property-3d') or (
  (select public.current_user_role())::text in ('agent', 'admin', 'owner')
  and ((select public.current_user_role())::text in ('admin', 'owner') or (split_part(name, '/', 1) = (select auth.uid())::text
    and not exists (select 1 from public.properties p where p.id = split_part(name, '/', 2) and p.verified)))
))
with check (bucket_id not in ('property-photos', 'property-360', 'property-3d') or (
  (select public.current_user_role())::text in ('agent', 'admin', 'owner')
  and ((select public.current_user_role())::text in ('admin', 'owner') or (split_part(name, '/', 1) = (select auth.uid())::text
    and not exists (select 1 from public.properties p where p.id = split_part(name, '/', 2) and p.verified)))
));
create policy property_media_delete_guard on storage.objects as restrictive for delete to authenticated
using (bucket_id not in ('property-photos', 'property-360', 'property-3d') or (
  (select public.current_user_role())::text in ('agent', 'admin', 'owner')
  and ((select public.current_user_role())::text in ('admin', 'owner') or (split_part(name, '/', 1) = (select auth.uid())::text
    and not exists (select 1 from public.properties p where p.id = split_part(name, '/', 2) and p.verified)))
));
commit;
