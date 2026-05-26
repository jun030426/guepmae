/*
 * property-photos Storage 버킷 정책
 *
 * 버킷 생성 자체는 Supabase Dashboard 에서 수동으로:
 *   Storage → New bucket → name: "property-photos" → Public bucket 체크 → Create
 *
 * 이 SQL 은 storage.objects 의 RLS 정책만 추가:
 *   - SELECT: 누구나 (public bucket이라서 어차피 readable)
 *   - INSERT: agent/admin role 만
 *   - UPDATE/DELETE: agent/admin role 만
 */

-- 누구나 읽기
drop policy if exists "Public can read property photos" on storage.objects;
create policy "Public can read property photos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'property-photos');

-- 중개사/관리자만 업로드
drop policy if exists "Agents can upload property photos" on storage.objects;
create policy "Agents can upload property photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('agent', 'admin')
  )
);

-- 중개사/관리자만 수정/삭제
drop policy if exists "Agents can update property photos" on storage.objects;
create policy "Agents can update property photos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('agent', 'admin')
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
    where id = auth.uid() and role in ('agent', 'admin')
  )
);
