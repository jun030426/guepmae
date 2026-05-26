/*
 * profiles SELECT 정책 — owner 도 모든 프로필 읽기 가능하도록 추가.
 *
 * 옛 정책은 `current_user_role() = 'admin'` 만 체크해서 owner 로 로그인하면
 * 자기 프로필만 보임 → 운영 관리 페이지의 사용자 테이블이 비어 있는 문제.
 */

drop policy if exists "Users can read their own profile" on public.profiles;

create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = id
  or public.current_user_role() in ('admin'::public.app_role, 'owner'::public.app_role)
);
