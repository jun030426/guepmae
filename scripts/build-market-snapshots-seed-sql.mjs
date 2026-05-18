/*
 * build-market-snapshots-seed-sql.mjs
 *
 * src/data/marketData.json + 하드코딩된 monthlyUrgentTrend 를 합쳐서
 * Supabase market_snapshots 테이블에 upsert 할 SQL 을 만든다.
 *
 * 결과: supabase/seed/market_snapshots_seed.sql
 *
 * 실행:  node scripts/build-market-snapshots-seed-sql.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const marketDataPath = path.join(projectRoot, 'src', 'data', 'marketData.json');
const outputPath = path.join(projectRoot, 'supabase', 'seed', 'market_snapshots_seed.sql');

// 홈 AreaChart 에 표시되던 데이터 — 옛 properties.js 의 monthlyUrgentTrend
const HOME_TREND = [
  { month: '12월', averageDiscount: 5.6, urgentCount: 42, transactionVolume: 121 },
  { month: '1월', averageDiscount: 5.9, urgentCount: 47, transactionVolume: 118 },
  { month: '2월', averageDiscount: 6.4, urgentCount: 53, transactionVolume: 112 },
  { month: '3월', averageDiscount: 6.8, urgentCount: 61, transactionVolume: 109 },
  { month: '4월', averageDiscount: 7.3, urgentCount: 68, transactionVolume: 104 },
  { month: '5월', averageDiscount: 7.8, urgentCount: 76, transactionVolume: 99 },
];

function escapeJson(obj) {
  if (obj === null || obj === undefined) return `'null'::jsonb`;
  const json = JSON.stringify(obj).replace(/'/g, "''");
  return `'${json}'::jsonb`;
}

function buildUpsert(key, data) {
  return (
    `insert into public.market_snapshots (key, data) values ('${key}', ${escapeJson(data)})\n` +
    `on conflict (key) do update set data = excluded.data, updated_at = now();`
  );
}

function main() {
  const marketData = JSON.parse(fs.readFileSync(marketDataPath, 'utf8'));

  const rows = [
    ['regional', marketData.regionalSnapshots ?? []],
    ['monthly', marketData.monthlyMarketTrend ?? []],
    ['area_type', marketData.areaTypeBreakdown ?? []],
    ['top_urgent', marketData.topUrgentComplexes ?? []],
    ['insights', marketData.marketInsights ?? []],
    ['metadata', marketData.dataSource ?? {}],
    ['home_trend', HOME_TREND],
  ];

  const lines = [
    '-- market_snapshots 시드 SQL — scripts/build-market-snapshots-seed-sql.mjs 로 자동 생성',
    '-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run',
    '',
    '-- 테이블이 없으면 만듦 (이미 migration 으로 만들었으면 noop)',
    'create table if not exists public.market_snapshots (',
    '  key text primary key,',
    '  data jsonb not null,',
    '  updated_at timestamptz not null default now()',
    ');',
    'alter table public.market_snapshots enable row level security;',
    'grant select on public.market_snapshots to anon, authenticated;',
    'drop policy if exists "Public can read market snapshots" on public.market_snapshots;',
    'create policy "Public can read market snapshots"',
    '  on public.market_snapshots for select to anon, authenticated using (true);',
    '',
    `-- 7개 키 upsert (regional / monthly / area_type / top_urgent / insights / metadata / home_trend)`,
    'begin;',
    ...rows.map(([key, data]) => buildUpsert(key, data)),
    'commit;',
    '',
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${rows.length} upserts to ${path.relative(projectRoot, outputPath)}`);
}

main();
