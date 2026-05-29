/*
 * price_trends — 구/시/군 + 평형대 단위 월별 실거래가 추이.
 *
 * 데이터 출처: 국토교통부 아파트 매매 실거래가 (공공데이터 재활용)
 *   - is_estimated = false : 실제 거래 중앙값
 *   - is_estimated = true  : 거래가 없어 주변(시도) 추세를 가중해 재생산한 추정치
 *
 * 적재: scripts/build-price-trends.mjs → scripts/output/price_trends.csv 를
 *       Supabase Table Editor "Import data from CSV" 로 업로드.
 *       데이터 갱신 시에는 먼저 `truncate public.price_trends;` 후 재업로드.
 *
 * 사용처: 매물 등록 시 (gu, area_bucket) 로 13개월 추이를 조회해 price_history 스냅샷.
 */

create table if not exists public.price_trends (
  id bigint generated always as identity primary key,
  region text not null,         -- 시도 (예: 서울특별시)
  gu text not null,             -- 구/시/군 (예: 서울특별시 강남구)
  area_bucket text not null,    -- 평형대 (예: 60–85㎡)
  year_month text not null,     -- 'YYYY-MM'
  price bigint not null,        -- 중앙값(원). 30억대까지라 int4 불가 → bigint
  sample_size integer not null default 0,
  is_estimated boolean not null default false,
  unique (gu, area_bucket, year_month)
);

-- 매물 등록 시 lookup: WHERE gu = ? AND area_bucket = ? ORDER BY year_month
create index if not exists price_trends_gu_bucket_idx
  on public.price_trends (gu, area_bucket, year_month);

alter table public.price_trends enable row level security;

-- 시장 통계라 읽기는 공개 (비로그인 포함)
drop policy if exists "Anyone can read price trends" on public.price_trends;
create policy "Anyone can read price trends"
on public.price_trends
for select
to anon, authenticated
using (true);
