/*
 * complex_prices 면적 정밀화 — 평형대(5구간 coarse) → 전용면적 타입(area_m2) 단위.
 *
 * 왜: '60–85㎡' 한 칸에 59㎡와 84㎡가 섞여 중앙값이 부정확.
 *     '급매 −5%'의 기준가는 '동일 단지 + 동일 전용면적 타입' 중앙값이어야 정확.
 * area_m2 = floor(전용면적)  (84.97㎡ → 84 = "84타입", 한국 평형 명명과 일치)
 * area_bucket 은 표시·근접 fallback 용으로 컬럼 유지.
 * earliest/latest_year_month = 기준 거래 기간(감사·표시용).
 *
 * ⚠️ 적용 절차:
 *   1) 이 마이그레이션 실행
 *   2) `truncate public.complex_prices;`
 *   3) `node scripts/build-complex-prices.mjs` 로 재생성한 CSV 를
 *      Table Editor "Import data from CSV" 로 업로드 (area_m2 포함 새 헤더)
 */

alter table public.complex_prices
  add column if not exists area_m2 integer,
  add column if not exists earliest_year_month text;

-- 기존 평형대 기준 unique 제거 (제약 이름이 환경마다 달라 동적으로 모두 제거)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.complex_prices'::regclass and contype = 'u'
  loop
    execute format('alter table public.complex_prices drop constraint %I', c);
  end loop;
end $$;
drop index if exists complex_prices_lookup_idx;

-- 새 정밀 키: (단지, 구, 전용면적 타입). 근접 면적 범위조회도 이 인덱스로 커버.
create unique index if not exists complex_prices_area_uidx
  on public.complex_prices (complex, gu, area_m2);
