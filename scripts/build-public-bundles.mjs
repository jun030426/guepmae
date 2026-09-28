/*
 * build-public-bundles.mjs
 *
 * scripts/output/complex_prices.csv + src/data/marketData.json 을
 * 프론트가 읽는 public/data/*.json 번들로 변환한다.
 *
 *   → public/data/complex_prices.json   (sample_size 내림차순 상위 4,000행)
 *   → public/data/market_snapshots.json (key/value 스냅샷 객체)
 *
 * 실행: node scripts/build-public-bundles.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const COMPLEX_LIMIT = 4000;
const NUMERIC = new Set(['area_m2', 'median_price', 'sample_size', 'built_year']);

export function topComplexRows(csvText, limit = COMPLEX_LIMIT) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const rows = records.map((rec) => {
    const out = {};
    for (const [key, raw] of Object.entries(rec)) {
      if (!NUMERIC.has(key)) { out[key] = raw; continue; }
      const trimmed = String(raw ?? '').trim();
      out[key] = trimmed === '' ? null : Number(trimmed);
    }
    return out;
  });
  rows.sort((a, b) => (b.sample_size ?? 0) - (a.sample_size ?? 0));
  return rows.slice(0, limit);
}

export function buildMarketSnapshots(marketData) {
  return {
    regional: marketData.regionalSnapshots ?? [],
    monthly: marketData.monthlyMarketTrend ?? [],
    area_type: marketData.areaTypeBreakdown ?? [],
    top_urgent: marketData.topUrgentComplexes ?? [],
    insights: marketData.marketInsights ?? [],
    metadata: marketData.dataSource ?? {},
  };
}

function main() {
  const publicData = path.join(projectRoot, 'public', 'data');
  fs.mkdirSync(publicData, { recursive: true });

  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_prices.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`${csvPath} 가 없습니다. node scripts/build-complex-prices.mjs 를 먼저 실행하세요.`);
  }
  const complexRows = topComplexRows(fs.readFileSync(csvPath, 'utf8'));
  const complexOut = path.join(publicData, 'complex_prices.json');
  fs.writeFileSync(complexOut, JSON.stringify(complexRows), 'utf8');
  const minSample = complexRows.length ? complexRows[complexRows.length - 1].sample_size : 0;
  console.log(`[bundles] complex_prices.json: ${complexRows.length}행 (최소 sample_size ${minSample})`);

  const marketPath = path.join(projectRoot, 'src', 'data', 'marketData.json');
  if (!fs.existsSync(marketPath)) {
    throw new Error(`${marketPath} 가 없습니다. node scripts/import-trades-csv.mjs 를 먼저 실행하세요.`);
  }
  const snapshots = buildMarketSnapshots(JSON.parse(fs.readFileSync(marketPath, 'utf8')));
  const snapshotOut = path.join(publicData, 'market_snapshots.json');
  fs.writeFileSync(snapshotOut, JSON.stringify(snapshots), 'utf8');
  const months = snapshots.metadata.months ?? [];
  console.log(`[bundles] market_snapshots.json: ${months.length}개월 (~${months[months.length - 1] ?? '?'}), lastUpdated ${snapshots.metadata.lastUpdated ?? '?'}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
