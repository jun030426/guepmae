/*
 * complex_prices 에 건축연도(built_year) 컬럼 추가.
 * 매물 등록 시 단지 선택하면 건축연도를 자동으로 채우기 위함.
 *
 * 적용 후: scripts/build-complex-prices.mjs 로 재생성한 CSV(built_year 포함)를
 *   truncate public.complex_prices; 후 Table Editor 로 재업로드.
 */

alter table public.complex_prices
  add column if not exists built_year integer;
