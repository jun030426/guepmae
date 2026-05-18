/*
 * market_snapshots — /report 페이지가 사용하는 시장 통계 캐시.
 *
 * scripts/import-trades-csv.mjs 가 만든 marketData.json 의 각 섹션을
 * key/value 행으로 저장. /report 페이지가 한 번에 select 해서 사용.
 *
 * key 종류:
 *   - regional         (regionalSnapshots)
 *   - monthly          (monthlyMarketTrend)
 *   - area_type        (areaTypeBreakdown)
 *   - top_urgent       (topUrgentComplexes)
 *   - insights         (marketInsights)
 *   - metadata         (dataSource — generated_at, total_trades 등)
 *   - home_trend       (홈 페이지 AreaChart 용 monthlyUrgentTrend)
 *
 * 갱신 방법: scripts/build-market-snapshots-seed-sql.mjs 가 SQL 새로 만들고
 *           Supabase SQL Editor 에 붙여넣으면 upsert 됨.
 */

create table if not exists public.market_snapshots (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.market_snapshots enable row level security;

grant select on public.market_snapshots to anon, authenticated;

drop policy if exists "Public can read market snapshots" on public.market_snapshots;
create policy "Public can read market snapshots"
on public.market_snapshots
for select
to anon, authenticated
using (true);
