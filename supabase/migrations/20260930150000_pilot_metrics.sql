/*
 * 파일럿 지표 — 매물 조회·문의 버튼 집계(property_daily_stats) + 중개사 유료 의향 설문(agent_pricing_intents).
 *
 * 사업계획서의 파일럿 지표 "매물 문의 전환율"과 "유료여도 계속 쓰겠는가"의 원천.
 *
 * 방문자를 식별하지 않는다:
 *   - 받는 값은 매물 id 와 종류(view / inquiry_tel / inquiry_email) 뿐
 *   - 저장하는 것은 매물별 일별 합계. 개별 기록(누가·언제)은 남기지 않는다
 *   - 같은 날 중복은 브라우저가 거른다
 *
 * 권한:
 *   property_daily_stats  정책 없음 — 표를 직접 읽거나 쓸 수 없다. 아래 두 함수로만
 *     track_property_event  누구나(비로그인 포함). 있는 매물만, 운영진·담당 중개사 본인은 세지 않는다
 *     property_stats        로그인 사용자. 운영진은 전체, 중개사는 자기 매물만, 그 밖은 빈 결과
 *   agent_pricing_intents  본인 행만 쓰고 읽는다. 운영진은 전부 읽는다
 *
 * 설계: docs/superpowers/specs/2026-09-29-pilot-metrics-design.md
 */

-- ───────────────────────── 조회·문의 일별 합계 ─────────────────────────

create table if not exists public.property_daily_stats (
  property_id text not null check (char_length(property_id) between 1 and 64),
  day date not null,
  -- 집계 시점의 담당 중개사 계정(소문자). 매물이 지워져도 중개사별 합계가 남는다. 수집 매물은 null
  agent_email text,
  views integer not null default 0 check (views >= 0),
  inquiry_tel integer not null default 0 check (inquiry_tel >= 0),
  inquiry_email integer not null default 0 check (inquiry_email >= 0),
  primary key (property_id, day)
);

-- 매물 테이블에 외래키를 걸지 않는다 — 팔려서 지운 매물의 기록도 파일럿 지표다.

create index if not exists property_daily_stats_day_idx
  on public.property_daily_stats (day);

create index if not exists property_daily_stats_agent_idx
  on public.property_daily_stats (agent_email, day)
  where agent_email is not null;

alter table public.property_daily_stats enable row level security;
revoke all on public.property_daily_stats from anon, authenticated;

create or replace function public.track_property_event(p_property_id text, p_event text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent text;
  v_role public.app_role;
  v_email text;
  v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_event is null or p_event not in ('view', 'inquiry_tel', 'inquiry_email') then
    return false;
  end if;

  -- 있는 매물만 센다 — 아무 id 나 받으면 행을 끝없이 늘릴 수 있다
  select nullif(lower(trim(agent ->> 'email')), '') into v_agent
  from public.properties
  where id = p_property_id;
  if not found then
    return false;
  end if;

  -- 운영진(검수)과 담당 중개사 본인(등록 확인)의 조회는 방문이 아니다
  if auth.uid() is not null then
    select role, lower(trim(email)) into v_role, v_email
    from public.profiles
    where id = auth.uid();
    if v_role in ('admin'::public.app_role, 'owner'::public.app_role) then
      return false;
    end if;
    if v_agent is not null and v_email = v_agent then
      return false;
    end if;
  end if;

  insert into public.property_daily_stats (property_id, day, agent_email, views, inquiry_tel, inquiry_email)
  values (
    p_property_id, v_day, v_agent,
    (p_event = 'view')::int, (p_event = 'inquiry_tel')::int, (p_event = 'inquiry_email')::int
  )
  on conflict (property_id, day) do update
  set views = public.property_daily_stats.views + excluded.views,
      inquiry_tel = public.property_daily_stats.inquiry_tel + excluded.inquiry_tel,
      inquiry_email = public.property_daily_stats.inquiry_email + excluded.inquiry_email,
      agent_email = coalesce(excluded.agent_email, public.property_daily_stats.agent_email);
  return true;
end;
$$;

revoke all on function public.track_property_event(text, text) from public;
grant execute on function public.track_property_event(text, text) to anon, authenticated;

-- 결과를 jsonb 하나로 돌려준다 — API 의 1,000행 제한에 걸리지 않게
create or replace function public.property_stats(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_email text;
  v_all boolean := false;
begin
  if auth.uid() is not null then
    select role, lower(trim(email)) into v_role, v_email
    from public.profiles
    where id = auth.uid();
  end if;

  if v_role in ('admin'::public.app_role, 'owner'::public.app_role) then
    v_all := true;
  elsif v_role = 'agent'::public.app_role and coalesce(v_email, '') <> '' then
    v_all := false;
  else
    return jsonb_build_object('scope', 'none', 'listings', '[]'::jsonb, 'daily', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'scope', case when v_all then 'all' else 'own' end,
    'listings', coalesce((
      select jsonb_agg(to_jsonb(t))
      from (
        select property_id,
               max(agent_email) as agent_email,
               sum(views)::int as views,
               sum(inquiry_tel)::int as inquiry_tel,
               sum(inquiry_email)::int as inquiry_email,
               min(day) as first_day,
               max(day) as last_day
        from public.property_daily_stats
        where (p_from is null or day >= p_from)
          and (p_to is null or day <= p_to)
          and (v_all or agent_email = v_email)
        group by property_id
      ) t
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.day)
      from (
        select day,
               sum(views)::int as views,
               sum(inquiry_tel + inquiry_email)::int as inquiries
        from public.property_daily_stats
        where (p_from is null or day >= p_from)
          and (p_to is null or day <= p_to)
          and (v_all or agent_email = v_email)
        group by day
      ) d
    ), '[]'::jsonb)
  );
end;
$$;

-- Supabase 는 public 스키마의 함수 실행 권한을 anon 에게 기본으로 준다 — public 에서만 회수하면 anon 에 남는다
revoke all on function public.property_stats(date, date) from public, anon;
grant execute on function public.property_stats(date, date) to authenticated;

-- ───────────────────────── 유료 의향 설문 ─────────────────────────

create table if not exists public.agent_pricing_intents (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null check (char_length(email) between 5 and 254),
  willing text not null check (willing in ('yes', 'depends', 'no')),
  -- 요금 구간을 바꾸면 src/utils/pilotMetrics.js 의 PRICE_BANDS 도 같이 바꾼다
  price_band text check (price_band is null or price_band in ('lt_10k', '10k_30k', '30k_50k', '50k_100k', 'gte_100k', 'unsure')),
  comment text check (comment is null or char_length(comment) <= 500),
  listing_count integer not null default 0 check (listing_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 안 쓰겠다는 답에는 요금이 없고, 쓰겠다는 답에는 요금이 있다
  constraint agent_pricing_intents_band_matches check ((willing = 'no') = (price_band is null))
);

drop trigger if exists set_agent_pricing_intents_updated_at on public.agent_pricing_intents;
create trigger set_agent_pricing_intents_updated_at
before update on public.agent_pricing_intents
for each row
execute function public.set_updated_at();

alter table public.agent_pricing_intents enable row level security;

revoke all on public.agent_pricing_intents from anon;
grant select, insert, update on public.agent_pricing_intents to authenticated;

drop policy if exists "Agents can read own pricing intent" on public.agent_pricing_intents;
create policy "Agents can read own pricing intent"
on public.agent_pricing_intents
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Staff can read all pricing intents" on public.agent_pricing_intents;
create policy "Staff can read all pricing intents"
on public.agent_pricing_intents
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin'::public.app_role, 'owner'::public.app_role)
  )
);

-- 중개사(이상)만 답한다. 이메일은 자기 계정의 것이어야 한다(남의 이름으로 답하지 못하게)
drop policy if exists "Agents can answer pricing intent" on public.agent_pricing_intents;
create policy "Agents can answer pricing intent"
on public.agent_pricing_intents
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('agent'::public.app_role, 'admin'::public.app_role, 'owner'::public.app_role)
      and lower(profiles.email) = lower(agent_pricing_intents.email)
  )
);

drop policy if exists "Agents can change own pricing intent" on public.agent_pricing_intents;
create policy "Agents can change own pricing intent"
on public.agent_pricing_intents
for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and lower(profiles.email) = lower(agent_pricing_intents.email)
  )
);
