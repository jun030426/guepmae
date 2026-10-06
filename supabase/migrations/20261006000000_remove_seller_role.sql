/*
 * 매도인(seller) 역할 흔적 정리.
 *
 * 앱의 권한은 4단계(user · agent · admin · owner)다. seller 는 초기(2026-05) 매도인 인증 가입의 흔적으로,
 * 20260515020000 부터 가입 시 항상 user 로 만들어져 새로 생길 수 없지만, 가입 트리거·컬럼·테이블이 남아 있었다.
 *
 * 1) 혹시 남은 seller 프로필은 user 로 바꾼다
 * 2) 가입 트리거(handle_new_user)에서 seller 분기를 뺀다 — OAuth 이름·사진 처리는 그대로
 * 3) 매도인 인증 데이터가 하나도 없을 때만 seller_verifications 테이블 · profiles 의 seller_* 컬럼 · 상태 타입을 지운다
 *    (데이터가 있으면 지우지 않고 NOTICE 만 남긴다 — 내용을 확인한 뒤 따로 정리)
 * 4) app_role 타입의 'seller' 값은 Postgres 에서 뺄 수 없어(RLS 정책이 타입에 묶여 있음) 남기고,
 *    profiles.role 에 다시는 들어가지 못하게 제약을 건다
 *
 * Supabase SQL Editor 에서 이 파일 전체를 한 번에 실행해도 된다 (enum 값을 추가하지 않으므로 단계 분리 불필요).
 */

-- 1) 남은 seller → user
update public.profiles
set role = 'user'::public.app_role, updated_at = now()
where role = 'seller'::public.app_role;

-- 2) 가입 트리거: seller 분기 제거 (20260518000000 의 OAuth 메타데이터 처리 유지)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_full_name text;
  resolved_avatar_url text;
begin
  -- 이름: full_name → name → nickname 순으로 탐색 (이메일 가입은 full_name, OAuth는 name/nickname)
  resolved_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'nickname', ''),
    ''
  );

  -- 프로필 사진: avatar_url → picture → profile_image (Google은 picture, Kakao는 profile_image)
  resolved_avatar_url := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', ''),
    nullif(new.raw_user_meta_data ->> 'profile_image', '')
  );

  -- 공개 가입은 항상 일반회원. 중개사는 신청 → 운영 승인으로만 된다.
  insert into public.profiles (id, email, full_name, phone, role, favorite_region, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    resolved_full_name,
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    'user'::public.app_role,
    nullif(new.raw_user_meta_data ->> 'favorite_region', ''),
    resolved_avatar_url
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end,
    phone = coalesce(excluded.phone, public.profiles.phone),
    favorite_region = coalesce(excluded.favorite_region, public.profiles.favorite_region),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  return new;
end;
$$;

-- 가입 역할 정규화 함수는 더 이상 쓰지 않는다
drop function if exists public.normalize_public_signup_role(text);

-- 3) 매도인 인증 데이터가 없을 때만 테이블·컬럼·타입 제거
do $$
declare
  verification_rows bigint := 0;
  profile_rows bigint := 0;
begin
  if to_regclass('public.seller_verifications') is not null then
    execute 'select count(*) from public.seller_verifications' into verification_rows;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'seller_property_address'
  ) then
    execute $q$
      select count(*) from public.profiles
      where seller_property_address is not null
         or seller_verification_status <> 'not_required'::public.seller_verification_status
    $q$ into profile_rows;
  end if;

  if verification_rows > 0 or profile_rows > 0 then
    raise notice '매도인 인증 데이터가 남아 있어 지우지 않았습니다 (seller_verifications %건, profiles %건). 내용을 확인한 뒤 따로 정리하세요.',
      verification_rows, profile_rows;
    return;
  end if;

  drop table if exists public.seller_verifications;
  alter table public.profiles drop column if exists seller_property_address;
  alter table public.profiles drop column if exists seller_verification_status;
  drop type if exists public.seller_verification_status;
end $$;

-- 4) seller 가 다시 들어가지 못하게
alter table public.profiles drop constraint if exists profiles_role_not_seller;
alter table public.profiles
  add constraint profiles_role_not_seller check (role <> 'seller'::public.app_role);
