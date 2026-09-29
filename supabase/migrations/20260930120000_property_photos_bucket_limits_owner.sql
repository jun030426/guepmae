/*
 * property-photos — 매물 사진 버킷 정비.
 *
 * 1) 버킷이 없으면 만들고(예전엔 대시보드 수동 생성), 있으면 한도·형식을 정한다: 공개 읽기, 10MB, jpeg/png/webp.
 *    앱은 업로드 전에 긴 변 1600px JPEG 로 줄여 올린다(src/utils/photoImage.js).
 * 2) 업로드/수정/삭제 정책에 owner 역할을 포함한다 — 기존 정책은 agent/admin 만이라 대표 계정이 사진을 못 올렸다.
 *
 * 배경: 매물 사진을 data URL 로 매물 행(jsonb)에 넣던 방식을 Storage 참조로 바꿈 (2026-09-29).
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-photos', 'property-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read property photos" on storage.objects;
create policy "Public can read property photos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'property-photos');

drop policy if exists "Agents can upload property photos" on storage.objects;
create policy "Agents can upload property photos"
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

drop policy if exists "Agents can update property photos" on storage.objects;
create policy "Agents can update property photos"
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

drop policy if exists "Agents can delete property photos" on storage.objects;
create policy "Agents can delete property photos"
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
