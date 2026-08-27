/*
 * recompute-price-basis.mjs
 *
 * public/data/properties.json 의 매물 할인율 근거를 최신 complex_prices.csv 로 다시 계산한다.
 * 실거래를 갱신하면 6월 기준선으로 박제된 price_basis 가 새 중앙값과 어긋나기 때문이다.
 *
 * 재계산 후 할인율이 MIN_DISC 아래이거나 MAX_DISC 위면 "검증된 급매"가 아니므로 제외한다.
 *
 * 실행:
 *   node scripts/recompute-price-basis.mjs 강원            # 미리보기
 *   node scripts/recompute-price-basis.mjs 강원 --write    # public/data/properties.json 갱신
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// import-listings.py:19 와 같은 값
export const MIN_SAMPLE = 3;
export const MIN_DISC = 5.0;
export const MAX_DISC = 40.0;

export function normalizeComplex(name) {
  return String(name ?? '').replace(/\s+|아파트/g, '').trim();
}

// import-listings.py:norm2 와 같은 규칙 — 괄호 내용을 먼저 지운 뒤 normalizeComplex
export function normalizeComplex2(name) {
  return normalizeComplex(String(name ?? '').replace(/\(.*?\)/g, ''));
}

// import-listings.py 의 `cp[gu][norm(complex)] = {"orig", "n2", "rows": [...]}` 와 같은 모양.
// index: Map<gu, Map<normalizedComplexKey, {orig, n2, rows}>>
export function buildComplexIndex(csvText) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const index = new Map();
  for (const rec of records) {
    const gu = String(rec.gu ?? '').trim();
    const key = normalizeComplex(rec.complex);
    const row = {
      complex: rec.complex,
      area_m2: Number(rec.area_m2),
      median_price: Number(rec.median_price),
      sample_size: Number(rec.sample_size),
      earliest_year_month: rec.earliest_year_month,
      latest_year_month: rec.latest_year_month,
    };
    if (!index.has(gu)) index.set(gu, new Map());
    const g = index.get(gu);
    if (!g.has(key)) {
      g.set(key, { orig: rec.complex, n2: normalizeComplex2(rec.complex), rows: [] });
    }
    g.get(key).rows.push(row);
  }
  return index;
}

// import-listings.py:resolve_complex 와 동일한 3단계 매칭.
// 1) norm 완전일치  2) norm2 일치(후보 1개일 때만)  3) norm2 부분포함(후보 1개일 때만)
// 두 후보 이상이면 모호하므로 null — 이 가드가 없으면 엉뚱한 단지에 조용히 매칭된다.
export function resolveComplex(name, gu, index) {
  const g = index.get(String(gu ?? '').trim());
  if (!g) return null;

  const n = normalizeComplex(name);
  const n2 = normalizeComplex2(name);

  if (g.has(n)) return g.get(n).rows;

  const cand = [...g.values()].filter((v) => v.n2 === n2 && n2.length >= 3);
  if (cand.length === 1) return cand[0].rows;

  const sub = [...g.entries()].filter(
    ([key, v]) => key.length >= 3 && n2.length >= 3 && (n2.includes(key) || key.includes(n2))
  );
  return sub.length === 1 ? sub[0][1].rows : null;
}

function pickBaseline(rows, areaM2) {
  const usable = rows.filter((r) => r.sample_size >= MIN_SAMPLE);
  const exact = usable.find((r) => r.area_m2 === areaM2);
  if (exact) return { row: exact, approx: false };
  const near = usable
    .filter((r) => Math.abs(r.area_m2 - areaM2) <= 2)
    .sort((a, b) => b.sample_size - a.sample_size)[0];
  return near ? { row: near, approx: true } : null;
}

export function recomputeBasis(property, index, today) {
  // 매물 title 은 "<단지명> 전용NN㎡ ..." 형태라 " 전용" 앞이 단지명이다
  const complexName = String(property.title ?? '').split(' 전용')[0];
  const rows = resolveComplex(complexName, property.region, index);
  if (!rows) return null;

  const areaM2 = Number(property.area);
  const picked = pickBaseline(rows, areaM2);
  if (!picked) return null;

  const { row, approx } = picked;
  const price = Number(property.price);
  const discount = Math.round(((row.median_price - price) / row.median_price) * 1000) / 10;
  if (discount < MIN_DISC || discount > MAX_DISC) return null;

  return {
    actual_transaction_price: row.median_price,
    discount_rate: discount,
    price_basis: {
      ...(property.price_basis ?? {}),
      source: 'complex',
      baselinePrice: row.median_price,
      areaM2: row.area_m2,
      requestedAreaM2: areaM2,
      approxArea: approx,
      sampleSize: row.sample_size,
      periodStart: row.earliest_year_month,
      periodEnd: row.latest_year_month,
      confidence: row.sample_size >= 10 ? 'high' : 'medium',
      method: `동일 단지 ${row.area_m2}㎡ · ${row.earliest_year_month}~${row.latest_year_month} ${row.sample_size}건 중앙값`,
      computedAt: today,
    },
  };
}

function main() {
  const prefix = process.argv[2];
  const write = process.argv.includes('--write');
  if (!prefix) {
    console.error('사용: node scripts/recompute-price-basis.mjs <지역접두사> [--write]');
    process.exit(1);
  }

  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_prices.csv');
  const index = buildComplexIndex(fs.readFileSync(csvPath, 'utf8'));
  const bundlePath = path.join(projectRoot, 'public', 'data', 'properties.json');
  const all = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  let touched = 0;
  let dropped = 0;
  const kept = [];
  for (const property of all) {
    if (!String(property.region ?? '').startsWith(prefix)) { kept.push(property); continue; }
    const next = recomputeBasis(property, index, today);
    if (!next) {
      dropped += 1;
      console.log(`  제외 ${property.title} (${property.region}) — 기준 미달`);
      continue;
    }
    touched += 1;
    kept.push({ ...property, ...next, last_verified_at: today });
  }

  console.log('-'.repeat(40));
  console.log(`[재계산] ${prefix}: 갱신 ${touched}건 / 제외 ${dropped}건 / 전체 ${all.length} → ${kept.length}건`);
  if (!write) {
    console.log('[재계산] 미리보기입니다. 반영하려면 --write 를 붙이세요.');
    return;
  }
  fs.writeFileSync(bundlePath, JSON.stringify(kept), 'utf8');
  console.log('[재계산] 기록: public/data/properties.json');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
