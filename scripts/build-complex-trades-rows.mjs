/*
 * build-complex-trades-rows.mjs
 *
 * scripts/output/complex_trades.csv (개별 실거래, build-complex-trades.mjs 산출) 를
 * "단지 + 구 + 전용면적" 한 행에 거래 배열을 담은 JSON 으로 묶는다.
 *
 *   → scripts/output/complex_trades_rows.json   전체(약 83k 행) — load-bundles-to-supabase.mjs complex_trades 적재용
 *   → public/data/complex_trades.json           public/data/complex_prices.json 과 같은 (단지, 구, 면적) 키만 — 로컬 데모 번들
 *
 * 행: { complex, gu, area_m2, sample_size, latest_year_month, max_floor, trades: [[ym, day, price, floor, dealing], ...] }
 *   dealing: 'b' 중개 / 'd' 직거래 / '' 미상. 앱은 src/utils/priceBasis.js 의 판정 규칙(기간·층·직거래 제외)에 쓴다.
 *
 * 실행: node scripts/build-complex-trades-rows.mjs
 * 설계: docs/superpowers/specs/2026-09-29-price-basis-judgment-design.md §6
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export function compactDealing(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'd' || s === 'direct' || /직거래/.test(s)) return 'd';
  if (s === 'b' || s === 'brokered' || /중개/.test(s)) return 'b';
  return '';
}

// complex_trades.csv 는 콤마가 든 단지명("대동1,2차")을 큰따옴표로 감싼다 — recompute-price-basis.mjs 와 같은 파서
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function rowKey(complex, gu, areaM2) {
  return `${complex}|${gu}|${areaM2}`;
}

/** CSV 한 줄을 그룹 Map 에 누적. header: complex,gu,area_m2,year_month,day,floor,price[,dealing] */
export function ingestLine(line, groups) {
  if (!line) return;
  const fields = parseCsvLine(line);
  if (fields.length < 7) return;
  const [complex, gu, areaStr, ym, day, floorStr, priceStr, dealingRaw] = fields;
  const areaM2 = Number.parseInt(areaStr, 10);
  const price = Number.parseInt(priceStr, 10);
  if (!complex || !gu || !Number.isFinite(areaM2) || !Number.isFinite(price) || !/^\d{4}-\d{2}$/.test(ym)) return;
  const floorNum = Number.parseInt(floorStr, 10);
  const floor = Number.isFinite(floorNum) ? floorNum : null;
  const key = rowKey(complex, gu, areaM2);
  if (!groups.has(key)) {
    groups.set(key, { complex, gu, area_m2: areaM2, sample_size: 0, latest_year_month: '', max_floor: null, trades: [] });
  }
  const g = groups.get(key);
  g.trades.push([ym, String(day ?? ''), price, floor, compactDealing(dealingRaw)]);
  g.sample_size += 1;
  if (ym > g.latest_year_month) g.latest_year_month = ym;
  if (floor != null && (g.max_floor == null || floor > g.max_floor)) g.max_floor = floor;
}

function finalizeGroups(groups) {
  const rows = [...groups.values()];
  for (const row of rows) {
    // 계약월 → 일(숫자) 순 정렬 — 재실행해도 같은 출력
    row.trades.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : Number(a[1]) - Number(b[1])));
  }
  rows.sort((a, b) => (a.gu < b.gu ? -1 : a.gu > b.gu ? 1 : a.complex < b.complex ? -1 : a.complex > b.complex ? 1 : a.area_m2 - b.area_m2));
  return rows;
}

/** 테스트/픽스처용 — 인라인 CSV 문자열 전체를 묶는다 (실행 경로는 스트리밍). */
export function groupTradeRows(csvText) {
  const groups = new Map();
  const lines = String(csvText ?? '').split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) ingestLine(lines[i], groups);
  return finalizeGroups(groups);
}

/** 번들 대상: complex_prices.json(상위 4,000행) 과 같은 (단지, 구, 면적) 키만 */
export function selectBundleRows(rows, complexPriceRows) {
  const keys = new Set((complexPriceRows ?? []).map((r) => rowKey(r.complex, r.gu, Number(r.area_m2))));
  return rows.filter((r) => keys.has(rowKey(r.complex, r.gu, r.area_m2)));
}

async function groupFromFile(csvPath) {
  const groups = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true;
  let lines = 0;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    ingestLine(line, groups);
    lines += 1;
    if (lines % 200000 === 0) process.stdout.write(`  ${lines.toLocaleString('ko-KR')}행\r`);
  }
  return finalizeGroups(groups);
}

async function main() {
  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_trades.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`${csvPath} 가 없습니다. node scripts/build-complex-trades.mjs 를 먼저 실행하세요.`);
  }
  console.log('[trades-rows] complex_trades.csv 읽는 중…');
  const rows = await groupFromFile(csvPath);
  const total = rows.reduce((sum, r) => sum + r.sample_size, 0);

  const outputDir = path.join(projectRoot, 'scripts', 'output');
  const allOut = path.join(outputDir, 'complex_trades_rows.json');
  fs.writeFileSync(allOut, JSON.stringify(rows), 'utf8');
  console.log(`[trades-rows] ${path.relative(projectRoot, allOut)}: ${rows.length.toLocaleString('ko-KR')}행 / 거래 ${total.toLocaleString('ko-KR')}건 (${(fs.statSync(allOut).size / 1024 / 1024).toFixed(1)}MB)`);

  const pricesPath = path.join(projectRoot, 'public', 'data', 'complex_prices.json');
  if (!fs.existsSync(pricesPath)) {
    console.warn('[trades-rows] public/data/complex_prices.json 이 없어 번들은 만들지 않습니다 (build-public-bundles.mjs 먼저).');
    return;
  }
  const bundleRows = selectBundleRows(rows, JSON.parse(fs.readFileSync(pricesPath, 'utf8')));
  const bundleOut = path.join(projectRoot, 'public', 'data', 'complex_trades.json');
  fs.writeFileSync(bundleOut, JSON.stringify(bundleRows), 'utf8');
  console.log(`[trades-rows] ${path.relative(projectRoot, bundleOut)}: ${bundleRows.length.toLocaleString('ko-KR')}행 (${(fs.statSync(bundleOut).size / 1024 / 1024).toFixed(1)}MB)`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
