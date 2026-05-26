/*
 * owner 역할 추가 + suspended (계정 정지) 컬럼 + 권한 계층 RLS.
 *
 * ⚠️ 이 마이그레이션은 Supabase SQL Editor 에서 *2단계*로 나눠 실행해야 합니다.
 *    Postgres는 enum value 추가와 사용을 같은 트랜잭션에서 할 수 없음.
 *
 * 1단계 (먼저 실행):
 *   alter type public.app_role add value if not exists 'owner';
 *
 * 2단계 (1단계 commit 후 별도 쿼리로 실행): 이 파일의 나머지 SQL.
 */

-- 1단계 — owner 값 추가
alter type public.app_role add value if not exists 'owner';

-- ⬇⬇⬇ 여기서 한 번 끊고, Supabase SQL Editor 에서 새 쿼리로 아래를 실행하세요 ⬇⬇⬇

-- 2단계 — suspended 컬럼 + 권한 정책 + 대표자 임명
alter table public.profiles add column if not exists suspended boolean not null default false;

-- 대표자 임명 (guepmae@gmail.com)
update public.profiles set role = 'owner'::public.app_role where email = 'guepmae@gmail.com';

-- 기존 admin 전용 UPDATE 정책 제거 후 owner/admin 분리해서 재생성
drop policy if exists "Admins can update profiles" on public.profiles;
drop policy if exists "Owner can update profiles" on public.profiles;
drop policy if exists "Admin can update user agent profiles" on public.profiles;

-- 대표자: 자신 제외 모든 사용자 권한 변경 + suspended 토글
create policy "Owner can update profiles"
on public.profiles
for update
to authenticated
using (
  id != auth.uid()
  and public.current_user_role() = 'owner'::public.app_role
)
with check (
  id != auth.uid()
  and public.current_user_role() = 'owner'::public.app_role
);

-- 관리자: user/agent 만 (admin/owner 못 건드림) → user/agent 로만 변경 가능
create policy "Admin can update user agent profiles"
on public.profiles
for update
to authenticated
using (
  id != auth.uid()
  and role in ('user'::public.app_role, 'agent'::public.app_role)
  and public.current_user_role() = 'admin'::public.app_role
)
with check (
  id != auth.uid()
  and role in ('user'::public.app_role, 'agent'::public.app_role)
  and public.current_user_role() = 'admin'::public.app_role
);
