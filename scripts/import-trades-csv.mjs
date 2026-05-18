/*
 * import-trades-csv.mjs
 *
 * 국토부 실거래가 공개시스템에서 다운로드한 아파트 매매 CSV(CP949)를
 * 읽어서 src/data/marketData.json, src/data/complexLookup.json 으로 변환합니다.
 *
 * 실행:
 *   node scripts/import-trades-csv.mjs scripts/data/raw-trades.csv
 *
 * 인자 없이 실행하면 scripts/data/ 폴더에서 첫 번째 .csv 파일을 자동으로 찾습니다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaultDataDir = path.join(__dirname, 'data');
const outputDir = path.join(projectRoot, 'src', 'data');

/* ---------- 1. CSV 파일 위치 결정 ---------- */
function resolveCsvPath() {
  const arg = process.argv[2];
  if (arg) {
    const resolved = path.resolve(projectRoot, arg);
    if (!fs.existsSync(resolved)) {
      throw new Error(`CSV 파일을 찾을 수 없습니다: ${resolved}`);
    }
    return resolved;
  }
  if (!fs.existsSync(defaultDataDir)) {
    throw new Error(
      `scripts/data 폴더가 없습니다. CSV 파일을 scripts/data/ 안에 넣거나 경로를 인자로 전달하세요.`,
    );
  }
  const candidates = fs.readdirSync(defaultDataDir).filter((name) => name.toLowerCase().endsWith('.csv'));
  if (candidates.length === 0) {
    throw new Error(
      `scripts/data/ 안에 .csv 파일이 없습니다. 국토부에서 받은 CSV를 거기에 넣어주세요.`,
    );
  }
  return path.join(defaultDataDir, candidates[0]);
}

/* ---------- 2. CP949 → UTF-8 + 메타 헤더 제거 ---------- */
function readNationalCsv(csvPath) {
  const buffer = fs.readFileSync(csvPath);
  // 국토부 기본 다운로드는 CP949. UTF-8로 받은 경우도 fallback 처리.
  let text;
  try {
    text = iconv.decode(buffer, 'cp949');
  } catch {
    text = buffer.toString('utf8');
  }

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
function parseRows(csvBody) {
  return parse(csvBody, {
    columns: true,
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
  if (cleaned.length === 6) {
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
    .replace(/특별시$|광역시$|특별자치시$|특별자치도$/, '')
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

function normalizeRow(row) {
  const sigungu = pickColumn(row, ['시군구', '시군구명', '시도']);
  const dong = pickColumn(row, ['단지명', '아파트', '아파트명']);
  const area = parseArea(pickColumn(row, ['전용면적(㎡)', '전용면적', '면적']));
  const dealAmount = parseDealAmount(pickColumn(row, ['거래금액(만원)', '거래금액', '금액']));
  const yearMonth = parseYearMonth(pickColumn(row, ['계약년월', '계약년월일', '거래년월']));
  const buildYear = Number(pickColumn(row, ['건축년도', '준공년도']) ?? '') || null;
  const floor = pickColumn(row, ['층']) ?? '';

  if (!sigungu || !dong || dealAmount == null) return null;

  return {
    region: getRegionLevel1(sigungu),
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

/* ---------- 5. 집계 ---------- */
function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function average(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function calculateDiscount(dealAmount, peerMedian) {
  if (!peerMedian || !dealAmount) return null;
  return ((peerMedian - dealAmount) / peerMedian) * 100;
}

function buildPeerMedians(rows) {
  // 단지 + 면적 bucket 별 median을 peer 기준으로 사용
  const groups = new Map();
  rows.forEach((row) => {
    if (!row) return;
    const key = `${row.complex}__${row.areaBucket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.dealAmount);
  });
  const result = new Map();
  groups.forEach((amounts, key) => {
    if (amounts.length >= 3) {
      // 표본이 충분할 때만 peer median 사용 (3건 이상)
      result.set(key, median(amounts));
    }
  });
  return result;
}

function aggregate(rows) {
  const cleanRows = rows.filter(Boolean);
  const peerMedians = buildPeerMedians(cleanRows);
  const URGENT_THRESHOLD = 5; // 5% 이상 할인 = 급매

  // 각 거래마다 할인율 계산
  const enrichedRows = cleanRows.map((row) => {
    const key = `${row.complex}__${row.areaBucket}`;
    const peer = peerMedians.get(key);
    const discount = calculateDiscount(row.dealAmount, peer);
    return { ...row, peerMedian: peer ?? null, discount };
  });

  /* 5-1. 시도별 스냅샷 */
  const regionMap = new Map();
  enrichedRows.forEach((row) => {
    if (!row.region) return;
    if (!regionMap.has(row.region)) {
      regionMap.set(row.region, {
        region: row.region,
        amounts: [],
        discounts: [],
        urgentCount: 0,
        transactionVolume: 0,
      });
    }
    const stat = regionMap.get(row.region);
    stat.amounts.push(row.dealAmount);
    stat.transactionVolume += 1;
    if (row.discount != null) {
      stat.discounts.push(row.discount);
      if (row.discount >= URGENT_THRESHOLD) stat.urgentCount += 1;
    }
  });

  const regionalSnapshots = Array.from(regionMap.values())
    .map((stat) => ({
      region: stat.region,
      averageDealPrice: Math.round(average(stat.amounts) ?? 0),
      averageDiscount: stat.discounts.length ? Number(average(stat.discounts).toFixed(1)) : 0,
      transactionVolume: stat.transactionVolume,
      urgentRatio: stat.transactionVolume ? Number((stat.urgentCount / stat.transactionVolume).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.transactionVolume - a.transactionVolume);

  /* 5-2. 월별 추이 (한 달 데이터지만 일별로는 너무 잘게 쪼개지므로 yearMonth 단위 합계 1행) */
  const monthMap = new Map();
  enrichedRows.forEach((row) => {
    if (!row.yearMonth) return;
    if (!monthMap.has(row.yearMonth)) {
      monthMap.set(row.yearMonth, { yearMonth: row.yearMonth, amounts: [], urgentCount: 0, count: 0, discounts: [] });
    }
    const stat = monthMap.get(row.yearMonth);
    stat.amounts.push(row.dealAmount);
    stat.count += 1;
    if (row.discount != null) {
      stat.discounts.push(row.discount);
      if (row.discount >= URGENT_THRESHOLD) stat.urgentCount += 1;
    }
  });
  const monthlyMarketTrend = Array.from(monthMap.values())
    .map((stat) => ({
      month: stat.yearMonth,
      averageDealPrice: Math.round(average(stat.amounts) ?? 0),
      averageDiscount: stat.discounts.length ? Number(average(stat.discounts).toFixed(1)) : 0,
      urgentCount: stat.urgentCount,
      transactionVolume: stat.count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  /* 5-3. 면적대별 */
  const areaMap = new Map();
  enrichedRows.forEach((row) => {
    const bucket = row.areaBucket;
    if (!areaMap.has(bucket)) areaMap.set(bucket, { bucket, amounts: [], discounts: [] });
    const stat = areaMap.get(bucket);
    stat.amounts.push(row.dealAmount);
    if (row.discount != null) stat.discounts.push(row.discount);
  });
  const bucketOrder = ['60㎡ 이하', '60–85㎡', '85–102㎡', '102–135㎡', '135㎡ 초과', '미상'];
  const areaTypeBreakdown = bucketOrder
    .filter((bucket) => areaMap.has(bucket))
    .map((bucket) => {
      const stat = areaMap.get(bucket);
      return {
        bucket,
        averageDealPrice: Math.round(average(stat.amounts) ?? 0),
        averageDiscount: stat.discounts.length ? Number(average(stat.discounts).toFixed(1)) : 0,
        transactionVolume: stat.amounts.length,
      };
    });

  /* 5-4. 급매 집중 단지 Top 10 — 표본 30건 이상 + 급매 거래 비율 높은 순 */
  const complexMap = new Map();
  enrichedRows.forEach((row) => {
    if (!row.complex) return;
    const key = row.complex;
    if (!complexMap.has(key)) {
      complexMap.set(key, {
        complex: row.complex,
        region: row.sigungu,
        amounts: [],
        urgentCount: 0,
        sampleSize: 0,
        discounts: [],
      });
    }
    const stat = complexMap.get(key);
    stat.amounts.push(row.dealAmount);
    stat.sampleSize += 1;
    if (row.discount != null) {
      stat.discounts.push(row.discount);
      if (row.discount >= URGENT_THRESHOLD) stat.urgentCount += 1;
    }
  });
  const topUrgentComplexes = Array.from(complexMap.values())
    .filter((stat) => stat.sampleSize >= 5 && stat.urgentCount >= 1)
    .map((stat) => ({
      complex: stat.complex,
      region: stat.region,
      dealCount: stat.urgentCount,
      sampleSize: stat.sampleSize,
      averageDiscount: stat.discounts.length ? Number(average(stat.discounts).toFixed(1)) : 0,
      urgentRatio: Number((stat.urgentCount / stat.sampleSize).toFixed(2)),
    }))
    .sort((a, b) => b.averageDiscount - a.averageDiscount)
    .slice(0, 10)
    .map((item, index) => ({ rank: index + 1, ...item }));

  /* 5-5. 인사이트 카드 — 의미 있는 지표만 */
  const totalVolume = cleanRows.length;
  const urgentRows = enrichedRows.filter((row) => row.discount != null && row.discount >= URGENT_THRESHOLD);
  const overallUrgentCount = urgentRows.length;
  const urgentAvgDiscount = urgentRows.length ? Number(average(urgentRows.map((row) => row.discount)).toFixed(1)) : 0;
  const urgentMedianDiscount = urgentRows.length ? Number(median(urgentRows.map((row) => row.discount)).toFixed(1)) : 0;
  const overallAvgPrice = Math.round(average(cleanRows.map((row) => row.dealAmount)) ?? 0);
  const urgentRatio = totalVolume ? (overallUrgentCount / totalVolume) * 100 : 0;

  const marketInsights = [
    {
      label: '급매 비율',
      value: `${urgentRatio.toFixed(1)}%`,
      direction: 'up',
      delta: `${overallUrgentCount.toLocaleString('ko-KR')}건 / ${totalVolume.toLocaleString('ko-KR')}건`,
      note: '단지·면적 median 대비 5%↑ 할인',
    },
    {
      label: '급매 평균 할인율',
      value: `${urgentAvgDiscount.toFixed(1)}%`,
      direction: 'up',
      delta: `중앙값 ${urgentMedianDiscount.toFixed(1)}%`,
      note: '급매 거래만 집계',
    },
    {
      label: '평균 거래가',
      value: formatKoreanWon(overallAvgPrice),
      direction: 'up',
      delta: '전체 거래 단순 평균',
      note: '단지별 가중 없음',
    },
    {
      label: '집계 거래량',
      value: `${totalVolume.toLocaleString('ko-KR')}건`,
      direction: 'up',
      delta: monthlyMarketTrend[0]?.month ?? '단일 기간',
      note: '국토부 실거래 데이터',
    },
  ];

  return {
    regionalSnapshots,
    monthlyMarketTrend,
    areaTypeBreakdown,
    topUrgentComplexes,
    marketInsights,
    dataSource: {
      name: '국토교통부 실거래가 공개시스템',
      endpoint: 'CSV 일괄 다운로드',
      lastUpdated: new Date().toISOString().slice(0, 10),
      disclosureLag: '계약일 기준 약 2주 후 공개',
      totalRows: totalVolume,
      months: monthlyMarketTrend.map((stat) => stat.month),
    },
  };
}

function formatKoreanWon(amount) {
  if (!amount) return '—';
  const eok = Math.floor(amount / 100000000);
  const man = Math.floor((amount % 100000000) / 10000);
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString('ko-KR')}만`;
  if (eok > 0) return `${eok}억`;
  if (man > 0) return `${man.toLocaleString('ko-KR')}만`;
  return `${amount}원`;
}

/* ---------- 6. complex lookup (매물 등록 검증용 별도 파일) ---------- */
function buildComplexLookup(rows) {
  const cleanRows = rows.filter(Boolean);
  const map = new Map();
  cleanRows.forEach((row) => {
    if (!row.complex) return;
    const key = `${row.complex}__${row.areaBucket}`;
    if (!map.has(key)) {
      map.set(key, {
        complex: row.complex,
        region: row.sigungu,
        areaBucket: row.areaBucket,
        amounts: [],
        latestYearMonth: row.yearMonth,
      });
    }
    const stat = map.get(key);
    stat.amounts.push(row.dealAmount);
    if (row.yearMonth && row.yearMonth > (stat.latestYearMonth ?? '')) {
      stat.latestYearMonth = row.yearMonth;
    }
  });
  return Array.from(map.values()).map((stat) => ({
    complex: stat.complex,
    region: stat.region,
    areaBucket: stat.areaBucket,
    sampleSize: stat.amounts.length,
    medianDealPrice: median(stat.amounts),
    averageDealPrice: Math.round(average(stat.amounts) ?? 0),
    latestYearMonth: stat.latestYearMonth,
  }));
}

/* ---------- main ---------- */
async function main() {
  const csvPath = resolveCsvPath();
  console.log(`[import] 입력 파일: ${path.relative(projectRoot, csvPath)}`);

  const csvBody = readNationalCsv(csvPath);
  const rows = parseRows(csvBody);
  console.log(`[import] CSV 파싱 완료: ${rows.length.toLocaleString('ko-KR')}행`);

  const normalizedRows = rows.map(normalizeRow).filter(Boolean);
  console.log(`[import] 정규화 완료: ${normalizedRows.length.toLocaleString('ko-KR')}건 (필수 컬럼 누락 제외)`);

  const aggregated = aggregate(normalizedRows);
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

main().catch((error) => {
  console.error('[import] 실행 실패:', error.message);
  process.exit(1);
});
