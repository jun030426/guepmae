/*
 * OAuth (Google, Kakao 등) 가입을 위한 handle_new_user 트리거 업데이트.
 *
 * 기존 트리거는 이메일 가입만 가정하고 raw_user_meta_data->>'full_name' 만 읽었음.
 * OAuth 제공자별로 메타데이터 키가 다름:
 *   - Google: name, picture, email_verified, full_name (간혹)
 *   - Kakao: nickname, profile_image, name (간혹)
 *
 * coalesce로 여러 키 중 첫 번째로 잡히는 값을 사용.
 *
 * profiles에 avatar_url 컬럼이 없으면 추가하여 OAuth 프로필 사진 저장.
 */

-- profiles 테이블에 avatar_url 추가 (이미 있으면 무시)
alter table public.profiles add column if not exists avatar_url text;

-- 트리거 함수 업데이트: OAuth 메타데이터 키 변형 모두 대응
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.app_role;
  proof_path text;
  property_address text;
  resolved_full_name text;
  resolved_avatar_url text;
begin
  requested_role := public.normalize_public_signup_role(new.raw_user_meta_data ->> 'requested_role');
  proof_path := new.raw_user_meta_data ->> 'seller_proof_path';
  property_address := new.raw_user_meta_data ->> 'seller_property_address';

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

  insert into public.profiles (
    id,
    email,
    full_name,
    phone,
    role,
    favorite_region,
    seller_property_address,
    seller_verification_status,
    avatar_url
  )
  values (
    new.id,
    coalesce(new.email, ''),
    resolved_full_name,
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    requested_role,
    nullif(new.raw_user_meta_data ->> 'favorite_region', ''),
    nullif(property_address, ''),
    case
      when requested_role = 'seller'::public.app_role and nullif(proof_path, '') is not null then 'pending'::public.seller_verification_status
      when requested_role = 'seller'::public.app_role then 'rejected'::public.seller_verification_status
      else 'not_required'::public.seller_verification_status
    end,
    resolved_avatar_url
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end,
    phone = coalesce(excluded.phone, public.profiles.phone),
    favorite_region = coalesce(excluded.favorite_region, public.profiles.favorite_region),
    seller_property_address = coalesce(excluded.seller_property_address, public.profiles.seller_property_address),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  if requested_role = 'seller'::public.app_role and nullif(proof_path, '') is not null then
    insert into public.seller_verifications (
      user_id,
      property_address,
      document_path,
      document_type,
      status
    )
    values (
      new.id,
      coalesce(nullif(property_address, ''), '주소 확인 필요'),
      proof_path,
      nullif(new.raw_user_meta_data ->> 'seller_document_type', ''),
      'pending'
    );
  end if;

  return new;
end;
$$;
