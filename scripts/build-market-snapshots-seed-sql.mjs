/*
 * build-market-snapshots-seed-sql.mjs
 *
 * src/data/marketData.json의 동일한 집계를 사용하여
 * Supabase market_snapshots 테이블에 upsert 할 SQL 을 만든다.
 *
 * 결과: supabase/seed/market_snapshots_seed.sql
 *
 * 실행:  node scripts/build-market-snapshots-seed-sql.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMarketSnapshots } from './build-public-bundles.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const marketDataPath = path.join(projectRoot, 'src', 'data', 'marketData.json');
const outputPath = path.join(projectRoot, 'supabase', 'seed', 'market_snapshots_seed.sql');

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

  const rows = Object.entries(buildMarketSnapshots(marketData));

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
    `-- ${rows.length}개 키 upsert (동일한 집계 버전)`,
    'begin;',
    ...rows.map(([key, data]) => buildUpsert(key, data)),
    'commit;',
    '',
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${rows.length} upserts to ${path.relative(projectRoot, outputPath)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
