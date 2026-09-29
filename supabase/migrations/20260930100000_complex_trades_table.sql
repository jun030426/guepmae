/*
 * complex_trades — 단지 + 구 + 전용면적 단위 개별 실거래 (최근 36개월, 압축 배열).
 *
 * 왜: 급매 판정 규칙(최근 12/24/36개월 창 · 층 구간 · 직거래 제외)은 중앙값이 아니라
 *     개별 거래가 있어야 한다. 하이브리드 앱은 매물 등록 시 (complex, gu) 로 이 테이블을 읽는다.
 * 행: trades = [[year_month, day, price(원), floor|null, dealing('b'|'d'|'')], ...]
 * 적재: node scripts/build-complex-trades-rows.mjs → node scripts/load-bundles-to-supabase.mjs complex_trades
 * 설계: docs/superpowers/specs/2026-09-29-price-basis-judgment-design.md §6
 */

create table if not exists public.complex_trades (
  complex text not null,
  gu text not null,
  area_m2 integer not null,
  sample_size integer not null default 0,
  latest_year_month text,
  max_floor integer,
  trades jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (complex, gu, area_m2)
);

-- 등록 화면은 (complex, gu) 로 면적 전부를 한 번에 읽는다
create index if not exists complex_trades_lookup_idx
  on public.complex_trades (complex, gu);

alter table public.complex_trades enable row level security;

drop policy if exists "Anyone can read complex trades" on public.complex_trades;
create policy "Anyone can read complex trades"
on public.complex_trades
for select
to anon, authenticated
using (true);
