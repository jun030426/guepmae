/*
 * 매물 등록 권한에 owner 추가 (properties INSERT + property-photos Storage).
 *
 * 기존 정책들이 role in ('agent','admin') 만 허용 →
 * 대표자(owner) 로 로그인해 매물 등록 시 RLS 가 막아서
 * "new row violates row-level security policy" 발생.
 * (UPDATE/DELETE 는 20260520090000 에서 이미 owner 추가됨, INSERT/사진업로드만 누락이었음)
 */

-- properties INSERT
drop policy if exists "Agents can insert properties" on public.properties;
create policy "Agents or Owner can insert properties"
on public.properties
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);

-- property-photos Storage INSERT
drop policy if exists "Agents can upload property photos" on storage.objects;
create policy "Agents or Owner can upload property photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);

-- property-photos Storage UPDATE
drop policy if exists "Agents can update property photos" on storage.objects;
create policy "Agents or Owner can update property photos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);

-- property-photos Storage DELETE
drop policy if exists "Agents can delete property photos" on storage.objects;
create policy "Agents or Owner can delete property photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);
