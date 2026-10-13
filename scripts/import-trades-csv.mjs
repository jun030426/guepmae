/*
 * import-trades-csv.mjs
 *
 * 국토부 실거래가 공개시스템에서 다운로드한 아파트 매매 CSV(CP949)를
 * 읽어서 src/data/marketData.json, src/data/complexLookup.json 으로 변환합니다.
 *
 * 실행:
 *   node scripts/import-trades-csv.mjs scripts/data/raw-trades.csv
 *
 * 인자 없이 실행하면 scripts/data/ 폴더의 모든 .csv 파일을 집계합니다.
 * --report-input: fetch-report-trades.py로 완전히 수집된 12개월 원본만 사용합니다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aggregate, buildComplexLookup } from './lib/marketAggregation.mjs';
export { aggregate, buildPeerMedians, buildComplexLookup } from './lib/marketAggregation.mjs';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaultDataDir = path.join(__dirname, 'data');
const outputDir = path.join(projectRoot, 'src', 'data');

/* ---------- 1. CSV 파일 위치 결정 (인자 1개 또는 scripts/data/ 의 모든 .csv) ---------- */
function resolveCsvPaths() {
  const arg = process.argv[2];
  if (arg === '--report-input') return [path.join(defaultDataDir, 'report', 'trades.csv')];
  if (arg) {
    const resolved = path.resolve(projectRoot, arg);
    if (!fs.existsSync(resolved)) {
      throw new Error(`CSV 파일을 찾을 수 없습니다: ${resolved}`);
    }
    return [resolved];
  }
  if (!fs.existsSync(defaultDataDir)) {
    throw new Error(
      `scripts/data 폴더가 없습니다. CSV 파일을 scripts/data/ 안에 넣거나 경로를 인자로 전달하세요.`,
    );
  }
  const candidates = fs
    .readdirSync(defaultDataDir)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .map((name) => path.join(defaultDataDir, name));
  if (candidates.length === 0) {
    throw new Error(
      `scripts/data/ 안에 .csv 파일이 없습니다. 국토부에서 받은 CSV를 거기에 넣어주세요.`,
    );
  }
  return candidates;
}

/* ---------- 2. CP949 → UTF-8 + 메타 헤더 제거 ---------- */
function readNationalCsv(csvPath) {
  return decodeCsvBody(fs.readFileSync(csvPath));
}

export function decodeCsvBody(buffer) {
  // iconv decoding does not throw on UTF-8 input. Detect the Korean header,
  // otherwise decode the national CSV's CP949 encoding.
  const utf8 = buffer.toString('utf8');
  const text = /시군구/.test(utf8) ? utf8 : iconv.decode(buffer, 'cp949');

  // 줄 단위로 잘라서 실제 데이터 헤더("NO,"로 시작 또는 "시군구"가 포함된 헤더 행) 위치 찾기
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return /시군구/.test(trimmed) && /(거래금액|단지명|전용면적)/.test(trimmed);
  });

  if (headerIndex === -1) {
    throw new Error('CSV 헤더 행을 찾지 못했습니다. 파일이 손상되었거나 형식이 다를 수 있습니다.');
  }

  const csvBody = lines.slice(headerIndex).join('\n');
  return csvBody;
}

/* ---------- 3. CSV 파싱 ---------- */
export function parseRows(csvBody) {
  return parse(csvBody, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
}

/* ---------- 4. 필드 정규화 ---------- */
function pickColumn(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return undefined;
}

function parseDealAmount(raw) {
  if (!raw) return null;
  // "78,500" → 78500만원 → 785000000원
  const cleaned = String(raw).replace(/[^0-9-]/g, '');
  if (!cleaned) return null;
  const manWon = Number(cleaned);
  if (!Number.isFinite(manWon)) return null;
  return manWon * 10000;
}

function parseArea(raw) {
  if (!raw) return null;
  const value = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(value) ? value : null;
}

function parseYearMonth(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9]/g, '');
  if ((cleaned.length === 6 || cleaned.length === 8) && /^(0[1-9]|1[0-2])$/.test(cleaned.slice(4, 6))) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}`;
  }
  return null;
}

function getRegionLevel1(sigungu) {
  if (!sigungu) return null;
  const first = sigungu.trim().split(/\s+/)[0];
  if (!first) return null;
  // 줄임말로 통일 (서울특별시 → 서울, 경기도 → 경기)
  return first
    .replace(/통합특별시$|특별시$|광역시$|특별자치시$|특별자치도$/, '')
    .replace(/도$/, '')
    .trim();
}

function getAreaBucket(area) {
  if (area == null) return '미상';
  if (area <= 60) return '60㎡ 이하';
  if (area <= 85) return '60–85㎡';
  if (area <= 102) return '85–102㎡';
  if (area <= 135) return '102–135㎡';
  return '135㎡ 초과';
}

export function normalizeRow(row) {
  let sigungu = pickColumn(row, ['시군구', '시군구명', '시도']);
  const legalDong = pickColumn(row, ['법정동', '법정동명', '읍면동']);
  if (sigungu && legalDong && !sigungu.trim().endsWith(legalDong.trim())) sigungu = `${sigungu.trim()} ${legalDong.trim()}`;
  const dong = pickColumn(row, ['단지명', '아파트', '아파트명']);
  const area = parseArea(pickColumn(row, ['전용면적(㎡)', '전용면적', '면적']));
  const dealAmount = parseDealAmount(pickColumn(row, ['거래금액(만원)', '거래금액', '금액']));
  const yearMonth = parseYearMonth(pickColumn(row, ['계약년월', '계약년월일', '거래년월']));
  const buildYear = Number(pickColumn(row, ['건축년도', '준공년도']) ?? '') || null;
  const floor = pickColumn(row, ['층']) ?? '';

  if (!sigungu || !dong || dealAmount == null || dealAmount <= 0 || area == null || area <= 0 || !yearMonth) return null;
  const cancellation = String(pickColumn(row, ['해제사유발생일', '해제일', 'cdealDay']) ?? '').trim();
  const cancellationFlag = String(pickColumn(row, ['해제여부', 'cdealType']) ?? '').trim();
  const canceled = !['', '-', '0', '00000000', '0000-00-00'].includes(cancellation) || /^(Y|O|해제)$/i.test(cancellationFlag);

  return {
    region: getRegionLevel1(sigungu),
    complexCode: pickColumn(row, ['아파트일련번호', '단지코드', 'aptSeq']) ?? null,
    lot: pickColumn(row, ['번지', '지번', 'jibun']) ?? null,
    canceled,
    dealing: pickColumn(row, ['거래유형', 'dealingGbn']) ?? '',
    sigungu: sigungu.trim(),
    complex: dong.trim(),
    area,
    areaBucket: getAreaBucket(area),
    dealAmount,
    yearMonth,
    buildYear,
    floor,
  };
}

/* ---------- main ---------- */
async function main() {
  const csvPaths = resolveCsvPaths();
  console.log(`[import] 입력 파일 ${csvPaths.length}개`);

  let normalizedRows = [];
  for (const csvPath of csvPaths) {
    const csvBody = readNationalCsv(csvPath);
    const rows = parseRows(csvBody);
    const norm = rows.map(normalizeRow);
    normalizedRows = normalizedRows.concat(norm);
    console.log(`[import] ${path.basename(csvPath)}: ${norm.length.toLocaleString('ko-KR')}건`);
  }
  console.log(`[import] 정규화 완료(전체): ${normalizedRows.length.toLocaleString('ko-KR')}건`);

  let receipt = null;
  if (process.argv.includes('--report-input')) {
    receipt = JSON.parse(fs.readFileSync(path.join(defaultDataDir, 'report', 'collection.json'), 'utf8'));
    const digest = createHash('sha256').update(fs.readFileSync(csvPaths[0])).digest('hex');
    if (receipt.failures.length || receipt.missingRegionMonths?.length || receipt.sha256 !== digest || receipt.completedPairs !== receipt.expectedPairs || receipt.rows !== normalizedRows.length) {
      throw new Error('API 수집 완료 기록과 원본이 일치하지 않습니다. 다시 수집하세요.');
    }
  }
  const aggregated = aggregate(normalizedRows, { asOf: receipt?.end });
  if (receipt) aggregated.dataSource.collection = receipt;
  const complexLookup = buildComplexLookup(normalizedRows);

  fs.mkdirSync(outputDir, { recursive: true });
  const marketDataPath = path.join(outputDir, 'marketData.json');
  const complexLookupPath = path.join(outputDir, 'complexLookup.json');

  fs.writeFileSync(marketDataPath, JSON.stringify(aggregated, null, 2), 'utf8');
  fs.writeFileSync(complexLookupPath, JSON.stringify(complexLookup), 'utf8');

  console.log(`[import] 출력: ${path.relative(projectRoot, marketDataPath)} (집계 ${(fs.statSync(marketDataPath).size / 1024).toFixed(1)}KB)`);
  console.log(`[import] 출력: ${path.relative(projectRoot, complexLookupPath)} (단지 룩업 ${(fs.statSync(complexLookupPath).size / 1024).toFixed(1)}KB)`);
  console.log(`[import] 시도 ${aggregated.regionalSnapshots.length}개 / 단지 ${complexLookup.length}개 그룹`);
  aggregated.marketInsights.forEach((insight) => {
    console.log(`[import] ${insight.label}: ${insight.value} (${insight.delta})`);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error('[import] 실행 실패:', error.message);
  process.exit(1);
});
