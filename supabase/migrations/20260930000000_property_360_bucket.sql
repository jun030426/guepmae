/*
 * property-360 — 매물 360 파노라마(합성 JPG) 저장 버킷.
 *
 * 공개 읽기(상세 페이지 360 투어), 업로드/수정/삭제는 agent/admin/owner 만.
 * 브라우저에서 4096×2048 JPEG(보통 1~2MB)로 줄여 올리므로 파일 한도는 8MB.
 * 앱은 media jsonb 에 { type: '360', id, src, label, order, yawOffset, links? } 로 참조만 저장한다.
 * 설계: docs/superpowers/specs/2026-09-29-360-tour-roadview-design.md
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-360',
  'property-360',
  true,
  8388608, -- 8MB
  array['image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read property 360 panoramas" on storage.objects;
create policy "Public can read property 360 panoramas"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'property-360');

drop policy if exists "Agents can upload property 360 panoramas" on storage.objects;
create policy "Agents can upload property 360 panoramas"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-360'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);

drop policy if exists "Agents can update property 360 panoramas" on storage.objects;
create policy "Agents can update property 360 panoramas"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-360'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);

drop policy if exists "Agents can delete property 360 panoramas" on storage.objects;
create policy "Agents can delete property 360 panoramas"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-360'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);
