/*
 * properties 테이블의 UPDATE/DELETE 권한을 admin 으로만 제한.
 *
 * 기존: agent + admin 둘 다 UPDATE 가능 → 중개사가 다른 매물의 verified 도 바꿀 수 있는 위험
 * 변경: INSERT 는 agent + admin / UPDATE/DELETE 는 admin 만
 */

-- 기존 UPDATE 정책 (agent 포함) 제거하고 admin 전용으로 교체
drop policy if exists "Agents can update properties" on public.properties;
create policy "Admin can update properties"
on public.properties
for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
);

-- DELETE 정책 추가 (admin 만, 반려 처리용)
drop policy if exists "Admin can delete properties" on public.properties;
create policy "Admin can delete properties"
on public.properties
for delete
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
);

grant delete on public.properties to authenticated;
