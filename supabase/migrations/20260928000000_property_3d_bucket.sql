/*
 * property-3d — 매물 3D 모델(.glb/.gltf) 저장 버킷.
 *
 * 공개 읽기(상세 페이지 3D 투어), 업로드/수정/삭제는 agent/admin/owner 만.
 * 파일 한도 50MB. glb 는 브라우저에 따라 application/octet-stream 으로 올라와 함께 허용.
 * 앱은 media jsonb 에 { type: '3d', src, label } 로 참조를 저장한다.
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-3d',
  'property-3d',
  true,
  52428800, -- 50MB
  array['model/gltf-binary', 'model/gltf+json', 'application/octet-stream']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read property 3d models" on storage.objects;
create policy "Public can read property 3d models"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'property-3d');

drop policy if exists "Agents can upload property 3d models" on storage.objects;
create policy "Agents can upload property 3d models"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-3d'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);

drop policy if exists "Agents can update property 3d models" on storage.objects;
create policy "Agents can update property 3d models"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-3d'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);

drop policy if exists "Agents can delete property 3d models" on storage.objects;
create policy "Agents can delete property 3d models"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-3d'
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
  )
);
