import { createHash } from 'node:crypto';
import { median, normalizeDealing, shiftMonth, MIN_SAMPLE, MIN_DISC } from '../../src/utils/priceBasis.js';
import { MARKET_AGGREGATION_VERSION, REPORT_WINDOW_MONTHS, selectTopComplexes } from '../../src/utils/marketReportModel.js';

export const areaBucket = (area) => area <= 60 ? '60㎡ 이하' : area <= 85 ? '60–85㎡' : area <= 102 ? '85–102㎡' : area <= 135 ? '102–135㎡' : '135㎡ 초과';
const cleanText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const validMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
const mean = (values) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
const round = (value, digits = 1) => value == null ? null : Number(value.toFixed(digits));
const meanWon = (values) => Math.round(mean(values) || 0);

// API CSVs may lack aptSeq/jibun. In that case use full legal-dong location,
// name AND construction year, and record the weaker identity in metadata.
// Never merge by apartment name or broad area bucket alone.
export function complexKey(row) {
  return JSON.stringify([cleanText(row.sigungu), cleanText(row.complex),
    row.complexCode ? `id:${cleanText(row.complexCode)}` : row.lot ? `lot:${cleanText(row.lot)}` : `built:${row.buildYear || 'unknown'}`]);
}
export function peerKey(row) { return JSON.stringify([complexKey(row), Number(row.area)]); }

export function buildPeerMedians(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = peerKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.dealAmount);
  }
  return new Map([...groups].filter(([, amounts]) => amounts.length >= MIN_SAMPLE).map(([key, amounts]) => [key, median(amounts)]));
}

function stats(rows) {
  const amounts = rows.map((r) => r.dealAmount);
  const discounts = rows.map((r) => r.discount).filter((d) => d != null);
  const urgentCount = discounts.filter((d) => d >= MIN_DISC).length;
  return {
    averageDealPrice: meanWon(amounts), medianDealPrice: median(amounts),
    averageDiscount: round(mean(discounts)), medianDiscount: round(median(discounts)),
    transactionVolume: rows.length, comparableVolume: discounts.length,
    unclassifiedVolume: rows.length - discounts.length, urgentCount,
    // Preserve the existing denominator (all eligible transactions), explicitly
    // exposing how many lacked enough peers rather than calling those non-urgent.
    urgentRatio: rows.length ? urgentCount / rows.length : 0,
  };
}
function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}
function monthsBetween(start, end) {
  const months = [];
  for (let ym = start; ym <= end; ym = shiftMonth(ym, 1)) months.push(ym);
  return months;
}
function validRow(row) {
  return row && cleanText(row.region) && cleanText(row.sigungu) && cleanText(row.complex)
    && Number.isFinite(row.area) && row.area > 0 && Number.isFinite(row.dealAmount) && row.dealAmount > 0 && validMonth(row.yearMonth);
}

export function aggregate(rows, { asOf, generatedAt = new Date().toISOString() } = {}) {
  const excluded = { invalid: 0, canceled: 0, direct: 0, outsideWindow: 0 };
  const usable = [];
  for (const row of rows) {
    if (!validRow(row)) { excluded.invalid += 1; continue; }
    if (row.canceled) { excluded.canceled += 1; continue; }
    if (normalizeDealing(row.dealing) === 'd') { excluded.direct += 1; continue; }
    usable.push({ ...row, areaBucket: areaBucket(row.area) });
  }
  if (!usable.length) throw new Error('집계 가능한 실거래가 없습니다. 기존 산출물은 유지합니다.');
  const sourceMonths = [...new Set(usable.map((r) => r.yearMonth))].sort();
  const end = asOf || sourceMonths.at(-1);
  if (!validMonth(end)) throw new Error('잘못된 집계 기준 월입니다.');
  const start = shiftMonth(end, -(REPORT_WINDOW_MONTHS - 1));
  const inWindow = usable.filter((r) => r.yearMonth >= start && r.yearMonth <= end);
  excluded.outsideWindow = usable.length - inWindow.length;
  if (!inWindow.length) throw new Error('선택한 집계 기간에 실거래가 없습니다.');
  const peerMedians = buildPeerMedians(inWindow);
  const enriched = inWindow.map((row) => {
    const peerMedian = peerMedians.get(peerKey(row)) ?? null;
    return { ...row, peerMedian, discount: peerMedian == null ? null : ((peerMedian - row.dealAmount) / peerMedian) * 100 };
  });
  const regionalSnapshots = [...groupBy(enriched, (r) => r.region)]
    .map(([region, group]) => ({ region, ...stats(group) }))
    .sort((a, b) => b.transactionVolume - a.transactionVolume || a.region.localeCompare(b.region));
  const monthlyGroups = groupBy(enriched, (r) => r.yearMonth);
  // Include zero-volume months to keep calendar boundaries and comparisons exact.
  const months = monthsBetween(start, end);
  const monthlyMarketTrend = months.map((month) => ({ month, ...stats(monthlyGroups.get(month) || []) }));
  const areas = groupBy(enriched, (r) => r.areaBucket);
  const areaTypeBreakdown = ['60㎡ 이하', '60–85㎡', '85–102㎡', '102–135㎡', '135㎡ 초과']
    .filter((bucket) => areas.has(bucket)).map((bucket) => ({ bucket, ...stats(areas.get(bucket)) }));
  const topUrgentComplexes = selectTopComplexes([...groupBy(enriched, complexKey)]
    .map(([complexId, group]) => {
      const s = stats(group);
      return { complexId, complex: group[0].complex, region: group[0].sigungu, lot: group[0].lot || null,
        sampleSize: s.transactionVolume, comparableVolume: s.comparableVolume,
        dealCount: s.urgentCount, averageDiscount: s.averageDiscount, urgentRatio: s.urgentRatio };
    }).filter((row) => row.dealCount > 0));
  const overall = stats(enriched);
  const urgentDiscounts = enriched.filter((r) => r.discount >= MIN_DISC).map((r) => r.discount);
  const marketInsights = [
    { label: '급매 비율', value: `${round(overall.urgentRatio * 100)}%`, delta: `${overall.urgentCount.toLocaleString('ko-KR')}건 / ${overall.transactionVolume.toLocaleString('ko-KR')}건`, note: '동일 지역·단지·전용면적의 집계기간 중앙값 대비 5% 이상 할인' },
    { label: '급매 평균 할인율', value: urgentDiscounts.length ? `${round(mean(urgentDiscounts))}%` : '—', delta: urgentDiscounts.length ? `중앙값 ${round(median(urgentDiscounts))}%` : '해당 거래 없음', note: '급매로 분류된 거래만 집계' },
    { label: '평균 거래가', value: `${round(overall.averageDealPrice / 1e8, 2)}억`, delta: '집계기간 거래 단순 평균', note: '단지별 가중 없음' },
    { label: '집계 거래량', value: `${inWindow.length.toLocaleString('ko-KR')}건`, delta: `${start} ~ ${end}`, note: `판정 가능 ${overall.comparableVolume.toLocaleString('ko-KR')}건 · 표본 부족 ${overall.unclassifiedVolume.toLocaleString('ko-KR')}건` },
  ];
  const fullPeriod = {
    start: sourceMonths[0], end: sourceMonths.at(-1), months: monthsBetween(sourceMonths[0], sourceMonths.at(-1)).length,
    transactionVolume: usable.length,
    monthly: [...groupBy(usable, (r) => r.yearMonth)].map(([month, group]) => ({ month, transactionVolume: group.length })).sort((a, b) => a.month.localeCompare(b.month)),
  };
  const dataSource = {
    name: '국토교통부 실거래가 공개시스템', endpoint: 'CSV 집계',
    aggregationVersion: MARKET_AGGREGATION_VERSION,
    lastUpdated: generatedAt.slice(0, 10), generatedAt,
    disclosureLag: '신고 지연·해제 신고에 따라 수치는 변경될 수 있습니다.',
    reportPeriod: { start, end, months: REPORT_WINDOW_MONTHS }, months,
    totalRows: inWindow.length, sourceRows: rows.length,
    comparableRows: overall.comparableVolume, unclassifiedRows: overall.unclassifiedVolume,
    excluded, unknownDealingRows: inWindow.filter((r) => !normalizeDealing(r.dealing)).length,
    fallbackIdentityRows: inWindow.filter((r) => !r.complexCode && !r.lot).length,
    peerDefinition: { windowMonths: REPORT_WINDOW_MONTHS, minSample: MIN_SAMPLE, area: 'exact', threshold: MIN_DISC, floorAdjusted: false, includesTargetTrade: true },
  };
  const result = { regionalSnapshots, monthlyMarketTrend, areaTypeBreakdown, topUrgentComplexes, marketInsights, fullPeriod, dataSource };
  // Fingerprint the aggregation itself; rebuilding the same data later keeps it.
  dataSource.snapshotId = createHash('sha256').update(JSON.stringify({ ...result, dataSource: { ...dataSource, generatedAt: undefined, lastUpdated: undefined } })).digest('hex');
  return result;
}

export function buildComplexLookup(rows) {
  const eligible = rows.filter((r) => validRow(r) && !r.canceled && normalizeDealing(r.dealing) !== 'd');
  return [...groupBy(eligible, peerKey)].map(([key, group]) => ({
    key, complexId: complexKey(group[0]), complex: group[0].complex, region: group[0].sigungu,
    areaM2: group[0].area, areaBucket: areaBucket(group[0].area), sampleSize: group.length,
    medianDealPrice: median(group.map((r) => r.dealAmount)), averageDealPrice: meanWon(group.map((r) => r.dealAmount)),
    latestYearMonth: group.map((r) => r.yearMonth).sort().at(-1),
  }));
}
