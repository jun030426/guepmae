/*
 * build-crawl-targets.mjs
 *
 * complex_prices.csv 에서 수도권(서울·경기·인천) 단지 중
 * 실거래 표본이 두꺼운 곳만 추려 수집 대상 목록을 만든다.
 *
 * 표본이 얇은 단지는 import-listings.py 의 MIN_SAMPLE(3) 에서 탈락하므로
 * 미리 걸러 요청 수를 줄인다.
 *
 *   → scripts/output/crawl_targets.csv
 *
 * 실행: node scripts/build-crawl-targets.mjs [minSample]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const CAPITAL = /^(서울특별시|경기도|인천광역시)/;
export const MIN_SAMPLE = 20;

export function pickCapitalTargets(csvText, minSample = MIN_SAMPLE) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const byComplex = new Map();
  for (const rec of records) {
    const gu = String(rec.gu ?? '').trim();
    if (!CAPITAL.test(gu)) continue;
    const complex = String(rec.complex ?? '').trim();
    if (!complex) continue;
    const key = `${gu}|${complex}`;
    let entry = byComplex.get(key);
    if (!entry) {
      entry = { gu, complex, max_sample: 0, areas: new Set() };
      byComplex.set(key, entry);
    }
    const sample = Number(rec.sample_size) || 0;
    if (sample > entry.max_sample) entry.max_sample = sample;
    const area = Number(rec.area_m2);
    if (Number.isFinite(area)) entry.areas.add(area);
  }
  return [...byComplex.values()]
    .filter((e) => e.max_sample >= minSample)
    .map((e) => ({ ...e, areas: [...e.areas].sort((a, b) => a - b) }))
    .sort((a, b) => b.max_sample - a.max_sample);
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const minSample = Number(process.argv[2]) || MIN_SAMPLE;
  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_prices.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`${csvPath} 가 없습니다. node scripts/build-complex-prices.mjs 를 먼저 실행하세요.`);
  }
  const targets = pickCapitalTargets(fs.readFileSync(csvPath, 'utf8'), minSample);

  const lines = ['gu,complex,max_sample,areas'];
  for (const t of targets) {
    lines.push([csvCell(t.gu), csvCell(t.complex), t.max_sample, csvCell(t.areas.join('|'))].join(','));
  }
  const outDir = path.join(projectRoot, 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'crawl_targets.csv');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  const byGu = new Map();
  for (const t of targets) byGu.set(t.gu, (byGu.get(t.gu) ?? 0) + 1);
  console.log(`[targets] sample_size >= ${minSample} · 수도권 ${targets.length}단지 / ${byGu.size}개 구`);
  console.log(`[targets] 출력: ${path.relative(projectRoot, outPath)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
