/*
 * properties 테이블에 agent/admin 만 INSERT 가능하도록 RLS 정책 추가.
 *
 * 기존: SELECT 만 anon/authenticated 에게 grant.
 * 추가: INSERT/UPDATE 는 profiles.role IN ('agent', 'admin') 인 사용자만 가능.
 *
 * Phase 1 등록 폼(/register-property) 이 사용. 중개사가 폼 제출 시 properties 에 직접 INSERT.
 */

grant insert, update on public.properties to authenticated;

-- INSERT: agent 또는 admin 만
drop policy if exists "Agents can insert properties" on public.properties;
create policy "Agents can insert properties"
on public.properties
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent', 'admin')
  )
);

-- UPDATE: agent/admin 만 (자기가 등록한 매물만 수정하게 하려면 더 좁히면 됨)
drop policy if exists "Agents can update properties" on public.properties;
create policy "Agents can update properties"
on public.properties
for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent', 'admin')
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent', 'admin')
  )
);
