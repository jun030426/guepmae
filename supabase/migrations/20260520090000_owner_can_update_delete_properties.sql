/*
 * properties UPDATE/DELETE 정책에 owner 추가.
 *
 * 옛 정책은 role = 'admin' 만 허용 → 대표자(owner) 로 로그인하면 매물 승인/반려 시
 * RLS 가 silent 하게 막아서 "0 rows updated" — 페이지 reload 하면 그대로 보임.
 */

drop policy if exists "Admin can update properties" on public.properties;
create policy "Admin or Owner can update properties"
on public.properties
for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin'::public.app_role, 'owner'::public.app_role)
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin'::public.app_role, 'owner'::public.app_role)
  )
);

drop policy if exists "Admin can delete properties" on public.properties;
create policy "Admin or Owner can delete properties"
on public.properties
for delete
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin'::public.app_role, 'owner'::public.app_role)
  )
);
