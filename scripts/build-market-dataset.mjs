import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse';
import { normalizeRow } from './import-trades-csv.mjs';
import { aggregate, areaBucket } from './lib/marketAggregation.mjs';
import { buildMarketSnapshots } from './build-public-bundles.mjs';
import { median, normalizeDealing, shiftMonth } from '../src/utils/priceBasis.js';

export function buildDataset(rows, receipt) {
  const groups = new Map(), trends = new Map(), reportRows = [];
  const excluded = { canceled: 0, direct: 0, unknownDealing: 0, invalid: 0 };
  const reportStart = shiftMonth(receipt.end, -11), trendStart = shiftMonth(receipt.end, -12);
  let rawCount = 0;
  for (const raw of rows) {
    rawCount++;
    const r = normalizeRow(raw);
    const gu = raw['시군구기준'];
    if (!r || !gu || !r.complexCode || r.yearMonth < receipt.start || r.yearMonth > receipt.end) { excluded.invalid++; continue; }
    if (r.yearMonth >= reportStart) reportRows.push(r);
    if (r.canceled) { excluded.canceled++; continue; }
    const dealing = normalizeDealing(r.dealing);
    if (dealing === 'd') { excluded.direct++; continue; }
    if (dealing !== 'b') { excluded.unknownDealing++; continue; }
    const id = JSON.stringify([gu, r.complexCode, Math.floor(r.area)]);
    if (!groups.has(id)) groups.set(id, { complex: r.complex, code: r.complexCode, gu, sigungu: r.sigungu, lot: r.lot,
      built_year: r.buildYear, area_m2: Math.floor(r.area), area_bucket: areaBucket(r.area), trades: [] });
    groups.get(id).trades.push([r.yearMonth, String(raw['일'] || ''), r.dealAmount, Number(r.floor) || null, 'b']);
    if (r.yearMonth >= trendStart) {
      const key = JSON.stringify([gu, areaBucket(r.area), r.yearMonth]);
      if (!trends.has(key)) trends.set(key, { region: gu.split(' ')[0], gu, area_bucket: areaBucket(r.area), year_month: r.yearMonth, amounts: [] });
      trends.get(key).amounts.push(r.dealAmount);
    }
  }
  if (rawCount !== receipt.rows || excluded.invalid || excluded.unknownDealing) throw new Error('Invalid/incomplete market source; publication refused');
  // Same-name apartments in one district must never share a price baseline.
  // Qualify collisions using the official location and apartment identifier.
  const names = new Map();
  for (const g of groups.values()) {
    const key = JSON.stringify([g.gu, g.complex]);
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(g.code);
  }
  const trades = [], prices = [];
  let qualified = 0;
  for (const g of groups.values()) {
    let complex = g.complex;
    if (names.get(JSON.stringify([g.gu, g.complex])).size > 1) {
      complex += ` (${g.sigungu.slice(g.gu.length).trim()} ${g.lot || g.code})`;
      // Official IDs also distinguish separate complexes on the same lot.
      complex += ` [${g.code}]`;
      qualified++;
    }
    g.trades.sort((a,b) => a[0].localeCompare(b[0]) || Number(a[1]) - Number(b[1]) || a[2] - b[2]);
    const amounts = g.trades.map(t => t[2]);
    trades.push({ complex, gu: g.gu, area_m2: g.area_m2, sample_size: g.trades.length,
      latest_year_month: g.trades.at(-1)[0], max_floor: Math.max(...g.trades.map(t => t[3] || 0)) || null,
      trades: g.trades, updated_at: receipt.collectedAt });
    prices.push({ complex, gu: g.gu, sigungu: g.sigungu, area_m2: g.area_m2, area_bucket: g.area_bucket,
      built_year: g.built_year, sample_size: amounts.length, median_price: median(amounts),
      earliest_year_month: g.trades[0][0], latest_year_month: g.trades.at(-1)[0] });
  }
  const priceTrends = [...trends.values()].map(({ amounts, ...r }) => ({ ...r, price: median(amounts), sample_size: amounts.length, is_estimated: false }));
  const market = aggregate(reportRows, { asOf: receipt.end, generatedAt: receipt.collectedAt });
  market.dataSource.collectionPeriod = { start: receipt.start, end: receipt.end, months: receipt.months };
  market.dataSource.collectionRows = trades.reduce((s,r) => s+r.sample_size, 0);
  market.dataSource.collectionDistricts = Object.keys(receipt.districts).length;
  market.dataSource.qualifiedComplexAreas = qualified;
  market.dataSource.collectionExcluded = excluded;
  return { complex_trades: trades, complex_prices: prices, price_trends: priceTrends,
    market_snapshots: Object.entries(buildMarketSnapshots(market)).map(([key, data]) => ({key, data})) };
}

export function validateReceipt(receipt, digest) {
  if (receipt.sha256 !== digest || receipt.months !== 36 || receipt.expectedPairs !== receipt.completedPairs
      || receipt.failures.length || receipt.missingRegionMonths.length || !receipt.rows
      || receipt.expectedPairs !== Object.keys(receipt.districts).length * 36) throw new Error('Incomplete or modified collection');
}

async function main() {
  const root = path.resolve('scripts/data/market');
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'collection.json'), 'utf8'));
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(path.join(root, 'trades.csv'))) hash.update(chunk);
  validateReceipt(receipt, hash.digest('hex'));
  const rows = [];
  for await (const row of fs.createReadStream(path.join(root, 'trades.csv')).pipe(parse({ columns: true, bom: true, skip_empty_lines: true, trim: true }))) rows.push(row);
  const dataset = buildDataset(rows, receipt);
  const output = path.resolve('scripts/output/market');
  fs.mkdirSync(output, { recursive: true });
  const manifest = { source: receipt, tables: {} };
  for (const [name, records] of Object.entries(dataset)) {
    const body = JSON.stringify(records);
    fs.writeFileSync(path.join(output, name + '.json'), body);
    manifest.tables[name] = { rows: records.length, sha256: createHash('sha256').update(body).digest('hex') };
    console.log(`${name}: ${records.length} rows`);
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
