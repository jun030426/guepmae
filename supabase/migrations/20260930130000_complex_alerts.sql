/*
 * complex_alerts — 관심 단지 급매 알림 구독.
 *
 * "이 단지(선택: 이 평형)에 검증된 급매가 새로 올라오면 알려달라"는 신청을 저장한다.
 * 파일럿 지표 "알림 신청 수"의 원천. 발송은 별도 단계(메일 서비스 키 필요) — 이 테이블은 구독만.
 *
 * 권한:
 *   insert  누구나(비로그인 포함) — 활성 상태로만
 *   select  본인 이메일(로그인) 또는 운영진(admin/owner). 비로그인은 읽지 못한다
 *   해지    unsubscribe_alert(token) 함수로만 (비로그인도 가능, 토큰을 아는 사람만)
 * confirmed_at 은 발송 시작 시 이중 확인(double opt-in)에 쓴다 — 타인 이메일 도용 신청 방지.
 * 설계: docs/superpowers/specs/2026-09-29-complex-alerts-design.md
 */

create table if not exists public.complex_alerts (
  id bigint generated always as identity primary key,
  email text not null check (char_length(email) between 5 and 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  complex text not null check (char_length(complex) between 1 and 100),
  gu text not null check (char_length(gu) between 1 and 60),
  area_m2 integer check (area_m2 is null or area_m2 between 10 and 400),
  min_discount numeric(4, 1) not null default 5 check (min_discount between 5 and 40),
  source_property_id text,
  status text not null default 'active' check (status in ('active', 'unsubscribed')),
  unsubscribe_token uuid not null default gen_random_uuid(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

-- 같은 이메일·단지·구·평형의 활성 구독은 하나만
create unique index if not exists complex_alerts_unique_active
  on public.complex_alerts (lower(email), complex, gu, coalesce(area_m2, 0))
  where status = 'active';

create unique index if not exists complex_alerts_token_idx
  on public.complex_alerts (unsubscribe_token);

-- 발송 대상 조회용 (단지·구 → 활성 구독)
create index if not exists complex_alerts_lookup_idx
  on public.complex_alerts (complex, gu)
  where status = 'active';

alter table public.complex_alerts enable row level security;

grant insert on public.complex_alerts to anon, authenticated;
grant select on public.complex_alerts to authenticated;

drop policy if exists "Anyone can subscribe to complex alerts" on public.complex_alerts;
create policy "Anyone can subscribe to complex alerts"
on public.complex_alerts
for insert
to anon, authenticated
with check (status = 'active' and unsubscribed_at is null and confirmed_at is null);

drop policy if exists "Users can read own complex alerts" on public.complex_alerts;
create policy "Users can read own complex alerts"
on public.complex_alerts
for select
to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "Staff can read all complex alerts" on public.complex_alerts;
create policy "Staff can read all complex alerts"
on public.complex_alerts
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin'::public.app_role, 'owner'::public.app_role)
  )
);

-- 해지: 토큰을 아는 사람만. RLS 를 우회해야 하므로 security definer.
create or replace function public.unsubscribe_alert(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.complex_alerts
  set status = 'unsubscribed', unsubscribed_at = now()
  where unsubscribe_token = p_token and status = 'active';
  return found;
end;
$$;

revoke all on function public.unsubscribe_alert(uuid) from public;
grant execute on function public.unsubscribe_alert(uuid) to anon, authenticated;
