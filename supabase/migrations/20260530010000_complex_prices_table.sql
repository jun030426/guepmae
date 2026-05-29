/*
 * complex_prices — 단지 + 구/시/군 + 평형대 단위 실거래 중앙값.
 *
 * 데이터 출처: 국토교통부 아파트 매매 실거래가 (공공데이터 재활용)
 * 용도: 매물 등록 시 단지+평형으로 기준 실거래가(할인율 계산 기준) 자동 산출.
 *       단지를 못 찾으면 price_trends(구 시세)로 재생산 fallback.
 *
 * 적재: scripts/build-complex-prices.mjs → scripts/output/complex_prices.csv 를
 *       Supabase Table Editor "Import data from CSV" 로 업로드.
 *       갱신 시 먼저 `truncate public.complex_prices;` 후 재업로드.
 */

-- 단지명 부분검색(ILIKE) 자동완성용 트라이그램 인덱스
create extension if not exists pg_trgm;

create table if not exists public.complex_prices (
  id bigint generated always as identity primary key,
  complex text not null,           -- 단지명
  sigungu text not null,           -- 대표 시군구(동 단위, 표시용)
  gu text not null,                -- 구/시/군 (price_trends.gu 와 동일 포맷)
  area_bucket text not null,       -- 평형대
  median_price bigint not null,    -- 실거래 중앙값(원)
  sample_size integer not null default 0,
  latest_year_month text,          -- 최근 거래월 'YYYY-MM'
  unique (complex, gu, area_bucket)
);

-- 단지 선택 후 (complex + gu + area_bucket) 정확 조회용
create index if not exists complex_prices_lookup_idx
  on public.complex_prices (complex, gu, area_bucket);

-- 단지명 자동완성(ILIKE '%검색어%')용 트라이그램 인덱스
create index if not exists complex_prices_name_trgm
  on public.complex_prices using gin (complex gin_trgm_ops);

alter table public.complex_prices enable row level security;

drop policy if exists "Anyone can read complex prices" on public.complex_prices;
create policy "Anyone can read complex prices"
on public.complex_prices
for select
to anon, authenticated
using (true);
