/*
 * build-complex-prices.mjs
 *
 * scripts/data/ 의 국토부 실거래가 CSV(여러 지역, CP949)를 모두 병합하여
 * "단지 + 구/시/군 + 평형대" 단위 실거래 중앙값 테이블 CSV 를 생성합니다.
 *   → scripts/output/complex_prices.csv  (Supabase complex_prices 테이블 import 용)
 *
 * 용도: 매물 등록 시 단지+평형으로 기준 실거래가(할인율 계산 기준) 자동 산출.
 *       단지를 못 찾으면 price_trends(구 시세)로 재생산 fallback.
 *
 * ※ complexLookup.json 은 단지명을 지역 구분 없이 합치므로(동명 단지 충돌) 쓰지 않고,
 *   raw CSV 에서 단지+구 기준으로 직접 집계한다.
 *
 * 실행: node scripts/build-complex-prices.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(__dirname, 'data');
const outputDir = path.join(__dirname, 'output');

function readNationalCsv(csvPath) {
  const buffer = fs.readFileSync(csvPath);
  let text;
  try {
    text = iconv.decode(buffer, 'cp949');
  } catch {
    text = buffer.toString('utf8');
  }
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return /시군구/.test(trimmed) && /(거래금액|단지명|전용면적)/.test(trimmed);
  });
  if (headerIndex === -1) throw new Error(`CSV 헤더 행을 찾지 못했습니다: ${csvPath}`);
  return lines.slice(headerIndex).join('\n');
}

function pickColumn(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return undefined;
}

function parseDealAmount(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9-]/g, '');
  if (!cleaned) return null;
  const manWon = Number(cleaned);
  return Number.isFinite(manWon) ? manWon * 10000 : null;
}

function parseArea(raw) {
  if (!raw) return null;
  const value = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(value) ? value : null;
}

function parseYearMonth(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9]/g, '');
  return cleaned.length === 6 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}` : null;
}

function toGu(sigungu) {
  const tokens = sigungu.trim().split(/\s+/);
  while (tokens.length > 1 && /(동|읍|면|리|가)$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function getAreaBucket(area) {
  if (area == null) return '미상';
  if (area <= 60) return '60㎡ 이하';
  if (area <= 85) return '60–85㎡';
  if (area <= 102) return '85–102㎡';
  if (area <= 135) return '102–135㎡';
  return '135㎡ 초과';
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

function csvCell(value) {
  if (value == null) return '';
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function main() {
  const files = fs.readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.csv'));
  if (files.length === 0) throw new Error('scripts/data/ 안에 .csv 파일이 없습니다.');
  console.log(`[complex] 입력 파일 ${files.length}개`);

  const groups = new Map(); // complex|gu|bucket -> { complex, gu, sigungu(대표), bucket, amounts[], latest }

  for (const file of files) {
    const body = readNationalCsv(path.join(dataDir, file));
    const rows = parse(body, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    for (const row of rows) {
      const sigungu = pickColumn(row, ['시군구']);
      const complex = pickColumn(row, ['단지명']);
      const amount = parseDealAmount(pickColumn(row, ['거래금액(만원)', '거래금액']));
      const ym = parseYearMonth(pickColumn(row, ['계약년월']));
      const cancel = pickColumn(row, ['해제사유발생일']);
      if (!sigungu || !complex || amount == null) continue;
      if (cancel && cancel !== '-') continue;
      const area = parseArea(pickColumn(row, ['전용면적(㎡)', '전용면적']));
      if (area == null) continue; // 정밀 면적 그룹핑에 전용면적 필수
      const areaM2 = Math.floor(area); // 84.97㎡ → "84타입" (한국 평형 타입 명명과 일치)
      const bucket = getAreaBucket(area); // fallback·표시용 5구간
      const gu = toGu(sigungu);
      const builtYear = Number(pickColumn(row, ['건축년도', '준공년도'])) || null;
      const key = `${complex}|${gu}|${areaM2}`;
      if (!groups.has(key)) {
        groups.set(key, { complex, gu, sigungu, areaM2, bucket, amounts: [], earliest: '', latest: '', builtYears: new Map() });
      }
      const g = groups.get(key);
      g.amounts.push(amount);
      if (ym) {
        if (g.latest === '' || ym > g.latest) g.latest = ym;
        if (g.earliest === '' || ym < g.earliest) g.earliest = ym;
      }
      if (builtYear) g.builtYears.set(builtYear, (g.builtYears.get(builtYear) || 0) + 1);
    }
    console.log(`[complex] ${file} 처리`);
  }

  // 그룹별 최빈 건축연도
  const modeBuiltYear = (counts) => {
    let best = null;
    let bestCount = 0;
    for (const [year, count] of counts) {
      if (count > bestCount) {
        best = year;
        bestCount = count;
      }
    }
    return best;
  };

  const header = ['complex', 'sigungu', 'gu', 'area_m2', 'area_bucket', 'median_price', 'sample_size', 'earliest_year_month', 'latest_year_month', 'built_year'];
  const out = [header.join(',')];
  for (const g of groups.values()) {
    out.push([
      csvCell(g.complex),
      csvCell(g.sigungu),
      csvCell(g.gu),
      g.areaM2,
      csvCell(g.bucket),
      median(g.amounts),
      g.amounts.length,
      csvCell(g.earliest),
      csvCell(g.latest),
      modeBuiltYear(g.builtYears) ?? '',
    ].join(','));
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'complex_prices.csv');
  fs.writeFileSync(outPath, out.join('\n'), 'utf8');

  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log('—'.repeat(40));
  console.log(`[complex] 단지+구+평형 그룹 ${groups.size.toLocaleString('ko-KR')}개`);
  console.log(`[complex] 출력: ${path.relative(projectRoot, outPath)} (${sizeMb}MB)`);
}

main();
