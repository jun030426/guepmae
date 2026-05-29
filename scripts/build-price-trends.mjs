/*
 * build-price-trends.mjs
 *
 * scripts/data/ 안의 국토부 아파트 매매 실거래가 CSV(여러 지역, CP949)를 모두 병합하여
 * "구/시 + 평형대 + 월" 단위 1년 실거래가 추이 테이블 CSV를 생성합니다.
 *   → scripts/output/price_trends.csv  (Supabase price_trends 테이블 import 용)
 *
 * [데이터 재활용 + 재생산]
 *   - 실제 거래가 있는 (구, 평형, 월) → 중앙값 (is_estimated=false)
 *   - 거래가 없는 달 → 주변(시도) 평형별 월간 추세를 해당 구 가격 수준으로 스케일해 재생산
 *       추정가 = 구·평형 실거래 중앙값 × (시도·평형 그 달 중앙값 ÷ 시도·평형 연간 중앙값)
 *       (is_estimated=true)
 *   - 해제(취소)된 거래(해제사유발생일 != '-')는 제외
 *
 * 실행: node scripts/build-price-trends.mjs
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

// 시군구 문자열에서 동/읍/면/리 단위를 떼어 "구/시" 단위 키로 만듦
//  "서울특별시 강남구 역삼동"        → "서울특별시 강남구"
//  "경기도 수원시 영통구 매탄동"      → "경기도 수원시 영통구"
//  "세종특별자치시 고운동"            → "세종특별자치시"
//  "경상북도 청도군 화양읍"           → "경상북도 청도군"
function toGu(sigungu) {
  const tokens = sigungu.trim().split(/\s+/);
  // 동/읍/면/리/가 단위를 시·군·구 레벨에 도달할 때까지 반복해서 제거
  //  (농촌은 "시도 시 면 리" 4단계라 한 번만 떼면 '면'이 남음)
  while (tokens.length > 1 && /(동|읍|면|리|가)$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function getSido(sigungu) {
  return sigungu.trim().split(/\s+/)[0];
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
  console.log(`[trends] 입력 파일 ${files.length}개`);

  const guCell = new Map(); // gu|bucket|month -> amounts[]
  const guGroup = new Map(); // gu|bucket -> { region, gu, bucket, amounts[], months:Set }
  const sidoCell = new Map(); // sido|bucket|month -> amounts[]
  const sidoGroup = new Map(); // sido|bucket -> amounts[]
  const monthSet = new Set();

  let totalRows = 0;
  let cancelled = 0;
  let used = 0;

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
      totalRows += 1;
      const sigungu = pickColumn(row, ['시군구']);
      const amount = parseDealAmount(pickColumn(row, ['거래금액(만원)', '거래금액']));
      const ym = parseYearMonth(pickColumn(row, ['계약년월']));
      const cancel = pickColumn(row, ['해제사유발생일']);
      if (!sigungu || amount == null || !ym) continue;
      if (cancel && cancel !== '-') {
        cancelled += 1;
        continue;
      }
      used += 1;
      const area = parseArea(pickColumn(row, ['전용면적(㎡)', '전용면적']));
      const bucket = getAreaBucket(area);
      const gu = toGu(sigungu);
      const sido = getSido(sigungu);
      monthSet.add(ym);

      const ck = `${gu}|${bucket}|${ym}`;
      if (!guCell.has(ck)) guCell.set(ck, []);
      guCell.get(ck).push(amount);

      const gk = `${gu}|${bucket}`;
      if (!guGroup.has(gk)) guGroup.set(gk, { region: sido, gu, bucket, amounts: [], months: new Set() });
      const g = guGroup.get(gk);
      g.amounts.push(amount);
      g.months.add(ym);

      const sck = `${sido}|${bucket}|${ym}`;
      if (!sidoCell.has(sck)) sidoCell.set(sck, []);
      sidoCell.get(sck).push(amount);

      const sgk = `${sido}|${bucket}`;
      if (!sidoGroup.has(sgk)) sidoGroup.set(sgk, []);
      sidoGroup.get(sgk).push(amount);
    }
    console.log(`[trends] ${file} 처리`);
  }

  const months = [...monthSet].sort();

  const header = ['region', 'gu', 'area_bucket', 'year_month', 'price', 'sample_size', 'is_estimated'];
  const out = [header.join(',')];
  let realCells = 0;
  let estCells = 0;

  for (const group of guGroup.values()) {
    const anchor = median(group.amounts); // 이 구·평형의 가격 수준
    const sidoOverall = median(sidoGroup.get(`${group.region}|${group.bucket}`) ?? []);

    for (const ym of months) {
      const realAmounts = guCell.get(`${group.gu}|${group.bucket}|${ym}`);
      if (realAmounts && realAmounts.length) {
        out.push([
          csvCell(group.region), csvCell(group.gu), csvCell(group.bucket), ym,
          median(realAmounts), realAmounts.length, 'false',
        ].join(','));
        realCells += 1;
      } else {
        // 재생산: 시도 평형 월별 추세를 구 가격수준으로 스케일
        const sidoMonth = median(sidoCell.get(`${group.region}|${group.bucket}|${ym}`) ?? []);
        let estimate;
        if (sidoMonth && sidoOverall) {
          estimate = Math.round(anchor * (sidoMonth / sidoOverall));
        } else {
          estimate = anchor; // 주변 추세도 없으면 구 수준 유지(평탄)
        }
        out.push([
          csvCell(group.region), csvCell(group.gu), csvCell(group.bucket), ym,
          estimate, 0, 'true',
        ].join(','));
        estCells += 1;
      }
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'price_trends.csv');
  fs.writeFileSync(outPath, out.join('\n'), 'utf8');

  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log('—'.repeat(44));
  console.log(`[trends] 기간: ${months[0]} ~ ${months[months.length - 1]} (${months.length}개월)`);
  console.log(`[trends] 원본 ${totalRows.toLocaleString('ko-KR')}건 / 해제 제외 ${cancelled.toLocaleString('ko-KR')}건 / 사용 ${used.toLocaleString('ko-KR')}건`);
  console.log(`[trends] 구+평형 그룹 ${guGroup.size.toLocaleString('ko-KR')}개 × ${months.length}개월`);
  console.log(`[trends] 실제 셀 ${realCells.toLocaleString('ko-KR')} + 재생산 셀 ${estCells.toLocaleString('ko-KR')} = ${(realCells + estCells).toLocaleString('ko-KR')}행`);
  console.log(`[trends] 출력: ${path.relative(projectRoot, outPath)} (${sizeMb}MB)`);
}

main();
