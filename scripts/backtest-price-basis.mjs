#!/usr/bin/env node
/*
 * backtest-price-basis.mjs — 판정 규칙 백테스트.
 *
 * 과거 실거래 한 건을 "그 달에 그 가격으로 나온 매물"로 보고,
 *   1) 그 달보다 앞선 거래만으로 기준가를 구해(운영 함수 computePriceBasis 를 그대로 호출) 실제 거래가와 비교하고
 *   2) 급매로 판정된 거래가 이후 시세(그 달부터 H 개월, 같은 단지·면적·층 구간 중앙값)로 봐도 쌌는지 채점한다.
 * 규칙을 다시 구현하지 않는다 — 변형(층 보정 없음 등)도 운영 함수에 입력만 바꿔 넣는다.
 *
 * 입력: scripts/output/complex_trades_rows.json (build-complex-trades-rows.mjs 산출, 해제 거래는 이미 제외)
 *       없으면 public/data/complex_trades.json (거래 많은 상위 4,000행 — 표본이 치우친다)
 * 출력: scripts/output/backtest_report.json · scripts/output/backtest_report.md
 *
 * 실행:
 *   node scripts/backtest-price-basis.mjs
 *   node scripts/backtest-price-basis.mjs --sido 서울특별시
 *   node scripts/backtest-price-basis.mjs --min-history 24 --horizon 6
 *   node scripts/backtest-price-basis.mjs --md docs/BACKTEST.md      # 요약을 저장소 문서로도 남길 때
 *   node scripts/backtest-price-basis.mjs --input <rows.json> --out <폴더>
 *
 * 설계·지표 정의·한계: docs/superpowers/specs/2026-09-29-backtest-design.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  computePriceBasis,
  expandTradeRow,
  floorBandOf,
  median as medianPrice,
  shiftMonth,
  MAX_DISC,
  MIN_DISC,
  MIN_SAMPLE,
  WINDOWS,
} from '../src/utils/priceBasis.js';
import { renderMarkdown } from './backtest-report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const DEFAULTS = { minHistoryMonths: 24, horizonMonths: 6, minFutureSample: MIN_SAMPLE };
export const VARIANTS = ['current', 'no_floor', 'all_36', 'include_direct', 'calendar_anchor'];
export const DISCOUNT_BUCKETS = [
  { key: '0 미만', min: -Infinity, max: 0 },
  { key: '0~5', min: 0, max: 5 },
  { key: '5~10', min: 5, max: 10 },
  { key: '10~15', min: 10, max: 15 },
  { key: '15~20', min: 15, max: 20 },
  { key: '20~40', min: 20, max: 40.0001 },
  { key: '40 초과', min: 40.0001, max: Infinity },
];
export const THRESHOLDS = [3, 5, 7, 10, 15];
const OUTLIER_ERROR = 40;

// ───────────────────────── 기본 유틸 ─────────────────────────

/** 'YYYY-MM' → 달 번호 (비교·차이 계산용) */
export function monthIndex(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return y * 12 + (m - 1);
}

/** 달 번호 → 'YYYY-MM' */
export function monthOf(index) {
  const year = Math.floor(index / 12);
  return `${year}-${String(index - year * 12 + 1).padStart(2, '0')}`;
}

/** 통계용 중앙값 — 짝수 개면 가운데 두 값의 평균 (가격 중앙값의 내림 규칙과 다르다) */
export function medianOf(values) {
  const n = values.length;
  if (n === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (value) => (value == null ? null : Math.round(value * 10) / 10);
const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const quarterOf = (ym) => `${ym.slice(0, 4)} ${Math.ceil(Number(ym.slice(5, 7)) / 3)}분기`;

// ───────────────────────── 데이터 준비 ─────────────────────────

/**
 * complex_trades 행 → 단지(구 + 단지명) 단위 묶음. 거래는 계약월·일 순.
 * 반환 Map<key, { complex, gu, sido, trades, maxFloorByArea }>
 */
export function groupByComplex(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    if (!row?.complex || !row?.gu) continue;
    const key = `${row.gu}\t${row.complex}`;
    if (!groups.has(key)) {
      groups.set(key, { complex: row.complex, gu: row.gu, sido: String(row.gu).split(' ')[0], trades: [], maxFloorByArea: new Map() });
    }
    const group = groups.get(key);
    for (const trade of expandTradeRow(row)) {
      trade.month = monthIndex(trade.yearMonth);
      group.trades.push(trade);
      if (trade.floor != null) {
        const seen = group.maxFloorByArea.get(trade.areaM2);
        if (seen == null || trade.floor > seen) group.maxFloorByArea.set(trade.areaM2, trade.floor);
      }
    }
  }
  for (const group of groups.values()) {
    group.trades.sort((a, b) => a.month - b.month || Number(a.day) - Number(b.day));
  }
  return groups;
}

/** 전체 거래의 첫 달·마지막 달 */
export function dataRange(groups) {
  let from = null;
  let to = null;
  for (const group of groups.values()) {
    if (group.trades.length === 0) continue;
    const first = group.trades[0].yearMonth;
    const last = group.trades[group.trades.length - 1].yearMonth;
    if (from == null || first < from) from = first;
    if (to == null || last > to) to = last;
  }
  return from == null ? null : { from, to };
}

/** 검증 대상 월: 이력이 충분하고(앞), 이후 시세를 볼 수 있는(뒤) 달만 */
export function testRange(range, { minHistoryMonths = DEFAULTS.minHistoryMonths, horizonMonths = DEFAULTS.horizonMonths } = {}) {
  if (!range) return null;
  const first = shiftMonth(range.from, minHistoryMonths);
  const last = shiftMonth(range.to, -(horizonMonths - 1));
  return first <= last ? { first, last } : null;
}

// ───────────────────────── 한 건 채점 ─────────────────────────

function compact(basis, price) {
  if (basis.status !== 'ok') {
    // 비교 거래를 미리 걸러 넘기므로 0건이면 함수는 no_data 로 답한다. 여기까지 왔다면 단지에 앞선 거래는
    // 있었던 것이므로 표본 부족이다 (앞선 거래가 아예 없는 단지는 호출 전에 no_data 로 처리한다)
    return { status: 'held', reason: 'low_sample' };
  }
  return {
    status: 'ok',
    baseline: basis.baselinePrice,
    discount: basis.discountRate,
    error: ((price - basis.baselinePrice) / basis.baselinePrice) * 100,
    windowMonths: basis.windowMonths,
    sampleSize: basis.sampleSize,
    floorBand: basis.floorBand,
    floorAdjusted: basis.floorAdjusted,
    approxArea: basis.approxArea,
  };
}

/**
 * 이후 시세: 그 달부터 H 개월, 같은 면적, 직거래 제외, 자신 제외.
 * 층을 아는 매물은 **같은 층 구간 거래만** 본다 — 모자라면 전체 층으로 넓히지 않고 채점에서 뺀다.
 * (저층 매물을 전체 층 중앙값과 비교하면 제값이어도 "실제로 쌌다"가 된다. 채점 기준은 같은 것끼리만 비교한다.)
 */
function outcomeFor(group, index, start, { horizonMonths, minFutureSample }) {
  const { trades } = group;
  const subject = trades[index];
  const end = subject.month + horizonMonths - 1;
  const maxFloor = group.maxFloorByArea.get(subject.areaM2) ?? null;
  const band = subject.floor != null ? floorBandOf(subject.floor, maxFloor) : null;
  const prices = [];
  for (let j = start; j < trades.length && trades[j].month <= end; j += 1) {
    const other = trades[j];
    if (j === index || other.areaM2 !== subject.areaM2 || other.dealing === 'd') continue;
    if (band && (other.floor == null || floorBandOf(other.floor, maxFloor) !== band)) continue;
    prices.push(other.price);
  }
  if (prices.length < minFutureSample) return null;
  const price = medianPrice(prices);
  return { price, sample: prices.length, banded: Boolean(band), realized: ((price - subject.price) / price) * 100 };
}

/**
 * 한 단지의 가상 매물을 모두 채점한다.
 * 반환 { records, skippedDirect } — record.variants[이름] = { status:'ok', baseline, discount, error, … } | { status:'held', reason }
 */
export function evaluateComplex(group, range, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const { trades } = group;
  const records = [];
  let skippedDirect = 0;
  let start = 0; // 계약월이 M 이상인 첫 거래 — 그 앞이 "그 시점에 알 수 있던 거래"
  const firstMonth = monthIndex(range.first);
  const lastMonth = monthIndex(range.last);

  for (let i = 0; i < trades.length; i += 1) {
    const subject = trades[i];
    if (subject.month < firstMonth) continue;
    if (subject.month > lastMonth) break;
    if (subject.dealing === 'd') { skippedDirect += 1; continue; }
    while (start < trades.length && trades[start].month < subject.month) start += 1;

    const calendarAsOf = subject.month - 1;
    const complexAsOf = start > 0 ? trades[start - 1].month : null; // 운영과 같은 기준월: 단지의 가장 최근 거래월
    const near = [];
    for (let j = 0; j < start; j += 1) {
      if (Math.abs(trades[j].areaM2 - subject.areaM2) <= 2) near.push(trades[j]);
    }
    const within = (asOf) => near.filter((t) => t.month >= asOf - 35);
    const basisOf = (input, asOf, floor) => computePriceBasis({
      trades: input, areaM2: subject.areaM2, floor, price: subject.price, asOf: monthOf(asOf), computedAt: 'backtest',
    });
    const judge = (input, asOf, floor) => compact(basisOf(input, asOf, floor), subject.price);

    const variants = {};
    if (complexAsOf == null) {
      for (const name of VARIANTS) variants[name] = { status: 'held', reason: 'no_data' };
    } else {
      const comparable = within(complexAsOf);
      const full = basisOf(comparable, complexAsOf, subject.floor);
      variants.current = compact(full, subject.price);
      variants.no_floor = subject.floor == null ? variants.current : judge(comparable, complexAsOf, null);
      variants.all_36 = full.status === 'ok'
        ? {
          ...variants.current,
          baseline: full.median36,
          discount: round1(((full.median36 - subject.price) / full.median36) * 100),
          error: ((subject.price - full.median36) / full.median36) * 100,
          windowMonths: 36,
          sampleSize: full.totalSample36,
          floorAdjusted: false,
        }
        : variants.current;
      variants.include_direct = comparable.some((t) => t.dealing === 'd')
        ? judge(comparable.map((t) => (t.dealing === 'd' ? { ...t, dealing: '' } : t)), complexAsOf, subject.floor)
        : variants.current;
      variants.calendar_anchor = complexAsOf === calendarAsOf
        ? variants.current
        : judge(within(calendarAsOf), calendarAsOf, subject.floor);
    }

    records.push({
      sido: group.sido,
      yearMonth: subject.yearMonth,
      areaM2: subject.areaM2,
      floor: subject.floor,
      price: subject.price,
      staleness: complexAsOf == null ? null : calendarAsOf - complexAsOf,
      outcome: outcomeFor(group, i, start, settings),
      variants,
    });
  }
  return { records, skippedDirect };
}

// ───────────────────────── 집계 ─────────────────────────

function newBucket() {
  return {
    tested: 0, heldNoData: 0, heldLowSample: 0, approxArea: 0,
    errors: [],
    flagged: 0, outliers: 0,
    scored: 0, flaggedScored: 0, truePositive: 0, looseHit: 0, missed: 0,
    realizedFlagged: [], realizedUnflagged: [],
  };
}

export const isFlagged = (discount, threshold = MIN_DISC) => discount != null && discount >= threshold && discount <= MAX_DISC;

function addToBucket(bucket, result, outcome) {
  bucket.tested += 1;
  if (result.status !== 'ok') {
    if (result.reason === 'no_data') bucket.heldNoData += 1;
    else bucket.heldLowSample += 1;
    return;
  }
  bucket.errors.push(result.error);
  if (result.approxArea) bucket.approxArea += 1;
  const flagged = isFlagged(result.discount);
  if (flagged) bucket.flagged += 1;
  if (result.discount > MAX_DISC) bucket.outliers += 1;
  if (!outcome) return;
  bucket.scored += 1;
  const actual = outcome.realized >= MIN_DISC;
  if (flagged) {
    bucket.flaggedScored += 1;
    if (actual) bucket.truePositive += 1;
    if (outcome.realized > 0) bucket.looseHit += 1;
    bucket.realizedFlagged.push(outcome.realized);
  } else {
    if (actual) bucket.missed += 1;
    bucket.realizedUnflagged.push(outcome.realized);
  }
}

export function summarizeBucket(bucket) {
  const judged = bucket.errors.length;
  let within5 = 0;
  let within10 = 0;
  let outlier = 0;
  const abs = new Array(judged);
  for (let i = 0; i < judged; i += 1) {
    const a = Math.abs(bucket.errors[i]);
    abs[i] = a;
    if (a <= 5) within5 += 1;
    if (a <= 10) within10 += 1;
    if (a > OUTLIER_ERROR) outlier += 1;
  }
  return {
    tested: bucket.tested,
    judged,
    coverage: ratio(judged, bucket.tested),
    held: { noData: bucket.heldNoData, lowSample: bucket.heldLowSample },
    approxArea: bucket.approxArea,
    accuracy: {
      n: judged,
      medianAbsError: round1(medianOf(abs)),
      within5: ratio(within5, judged),
      within10: ratio(within10, judged),
      bias: round1(medianOf(bucket.errors)),
      outlierShare: ratio(outlier, judged),
    },
    flag: {
      flagged: bucket.flagged,
      flagRate: ratio(bucket.flagged, judged),
      outliers: bucket.outliers,
      scored: bucket.flaggedScored,
      precision: ratio(bucket.truePositive, bucket.flaggedScored),
      loosePrecision: ratio(bucket.looseHit, bucket.flaggedScored),
      recall: ratio(bucket.truePositive, bucket.truePositive + bucket.missed),
      medianRealized: round1(medianOf(bucket.realizedFlagged)),
      medianRealizedUnflagged: round1(medianOf(bucket.realizedUnflagged)),
    },
    outcomeShare: ratio(bucket.scored, judged),
  };
}

const stalenessKey = (months) => (months === 0 ? '0개월' : months <= 3 ? '1~3개월' : months <= 6 ? '4~6개월' : '7개월 이상');
const sampleKey = (n) => (n <= 4 ? '3~4건' : n <= 9 ? '5~9건' : '10건 이상');
const floorKey = (r) => (r.floorAdjusted ? '같은 층 구간만 사용' : r.floorBand ? '층 구간 표본 부족 → 전체 층' : '층 정보 없음');

export function createAggregator() {
  const variants = Object.fromEntries(VARIANTS.map((name) => [name, newBucket()]));
  const breakdowns = { byWindow: new Map(), byFloor: new Map(), bySample: new Map(), byStaleness: new Map(), bySido: new Map(), byQuarter: new Map() };
  const pairs = []; // current 변형에서 이후 시세가 있는 건의 [판정 할인율, 실현 할인율]
  const into = (map, key, result, outcome) => {
    if (!map.has(key)) map.set(key, newBucket());
    addToBucket(map.get(key), result, outcome);
  };

  return {
    add(record) {
      for (const name of VARIANTS) addToBucket(variants[name], record.variants[name], record.outcome);
      const current = record.variants.current;
      into(breakdowns.bySido, record.sido, current, record.outcome);
      into(breakdowns.byQuarter, quarterOf(record.yearMonth), current, record.outcome);
      if (current.status !== 'ok') return;
      into(breakdowns.byWindow, `${current.windowMonths}개월`, current, record.outcome);
      into(breakdowns.byFloor, floorKey(current), current, record.outcome);
      into(breakdowns.bySample, sampleKey(current.sampleSize), current, record.outcome);
      into(breakdowns.byStaleness, stalenessKey(record.staleness), current, record.outcome);
      if (record.outcome) pairs.push([current.discount, record.outcome.realized]);
    },
    summary() {
      const table = (map, order) => {
        const keys = order ? order.filter((k) => map.has(k)) : [...map.keys()].sort();
        return keys.map((key) => ({ key, ...summarizeBucket(map.get(key)) }));
      };
      return {
        variants: Object.fromEntries(VARIANTS.map((name) => [name, summarizeBucket(variants[name])])),
        current: {
          byWindow: table(breakdowns.byWindow, WINDOWS.map((w) => `${w}개월`)),
          byFloor: table(breakdowns.byFloor, ['같은 층 구간만 사용', '층 구간 표본 부족 → 전체 층', '층 정보 없음']),
          bySample: table(breakdowns.bySample, ['3~4건', '5~9건', '10건 이상']),
          byStaleness: table(breakdowns.byStaleness, ['0개월', '1~3개월', '4~6개월', '7개월 이상']),
          bySido: table(breakdowns.bySido).sort((a, b) => b.judged - a.judged),
          byQuarter: table(breakdowns.byQuarter),
          byDiscountBucket: DISCOUNT_BUCKETS.map(({ key, min, max }) => {
            const realized = pairs.filter(([d]) => d >= min && d < max).map(([, r]) => r);
            return {
              key,
              n: realized.length,
              medianRealized: round1(medianOf(realized)),
              cheaperShare: ratio(realized.filter((r) => r > 0).length, realized.length),
              bargainShare: ratio(realized.filter((r) => r >= MIN_DISC).length, realized.length),
            };
          }),
          byThreshold: THRESHOLDS.map((threshold) => {
            const hit = pairs.filter(([d]) => isFlagged(d, threshold));
            return {
              threshold,
              flagged: hit.length,
              flagShare: ratio(hit.length, pairs.length),
              precision: ratio(hit.filter(([, r]) => r >= MIN_DISC).length, hit.length),
              loosePrecision: ratio(hit.filter(([, r]) => r > 0).length, hit.length),
              medianRealized: round1(medianOf(hit.map(([, r]) => r))),
            };
          }),
        },
      };
    },
  };
}

/** 묶음 전체를 돌려 리포트 객체를 만든다. */
export function runBacktest(groups, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const data = dataRange(groups);
  const range = testRange(data, settings);
  if (!range) {
    throw new Error(
      `검증할 달이 없습니다 — 데이터 ${data ? `${data.from}~${data.to}` : '없음'}, 최소 이력 ${settings.minHistoryMonths}개월, 이후 ${settings.horizonMonths}개월. `
      + '--min-history 나 --horizon 을 줄이세요.',
    );
  }
  const aggregator = createAggregator();
  const dealing = { brokered: 0, direct: 0, unknown: 0 };
  let trades = 0;
  let tested = 0;
  let skippedDirect = 0;
  let complexesTested = 0;
  let done = 0;
  for (const group of groups.values()) {
    trades += group.trades.length;
    for (const trade of group.trades) {
      dealing[trade.dealing === 'b' ? 'brokered' : trade.dealing === 'd' ? 'direct' : 'unknown'] += 1;
    }
    const result = evaluateComplex(group, range, settings);
    skippedDirect += result.skippedDirect;
    if (result.records.length > 0) complexesTested += 1;
    tested += result.records.length;
    for (const record of result.records) aggregator.add(record);
    done += 1;
    if (settings.onProgress && done % 5000 === 0) settings.onProgress(done, groups.size);
  }
  return {
    meta: {
      generatedAt: settings.generatedAt ?? new Date().toISOString().slice(0, 10),
      input: settings.inputLabel ?? null,
      subset: Boolean(settings.subset),
      filter: settings.sido ?? null,
      dataFrom: data.from,
      dataTo: data.to,
      testFrom: range.first,
      testTo: range.last,
      options: { minHistoryMonths: settings.minHistoryMonths, horizonMonths: settings.horizonMonths, minFutureSample: settings.minFutureSample },
      rule: { minSample: MIN_SAMPLE, minDiscount: MIN_DISC, maxDiscount: MAX_DISC, windows: WINDOWS },
    },
    universe: { complexes: groups.size, complexesTested, trades, tested, skippedDirect, dealing },
    ...aggregator.summary(),
  };
}

// ───────────────────────── 실행부 ─────────────────────────

export function parseArgs(argv) {
  const options = { input: null, out: null, md: null, sido: null, minHistoryMonths: DEFAULTS.minHistoryMonths, horizonMonths: DEFAULTS.horizonMonths };
  const names = { '--input': 'input', '--out': 'out', '--md': 'md', '--sido': 'sido', '--min-history': 'minHistoryMonths', '--horizon': 'horizonMonths' };
  for (let i = 0; i < argv.length; i += 1) {
    const name = names[argv[i]];
    if (!name) throw new Error(`알 수 없는 옵션: ${argv[i]} (가능: ${Object.keys(names).join(', ')})`);
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${argv[i]} 뒤에 값이 필요합니다.`);
    i += 1;
    if (name === 'minHistoryMonths' || name === 'horizonMonths') {
      const months = Number(value);
      if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error(`${argv[i - 1]} 는 1~120 사이 정수여야 합니다: ${value}`);
      options[name] = months;
    } else {
      options[name] = value;
    }
  }
  return options;
}

function resolveInput(explicit) {
  if (explicit) {
    const resolved = path.resolve(projectRoot, explicit);
    if (!fs.existsSync(resolved)) throw new Error(`입력 파일이 없습니다: ${resolved}`);
    return { file: resolved, subset: false };
  }
  const full = path.join(projectRoot, 'scripts', 'output', 'complex_trades_rows.json');
  if (fs.existsSync(full)) return { file: full, subset: false };
  const bundle = path.join(projectRoot, 'public', 'data', 'complex_trades.json');
  if (fs.existsSync(bundle)) return { file: bundle, subset: true };
  throw new Error(
    '개별 실거래 데이터가 없습니다.\n'
    + '→ node scripts/build-complex-trades.mjs && node scripts/build-complex-trades-rows.mjs 를 먼저 실행하세요 (원본 CSV 필요, docs/DESKTOP_TODO.md B).',
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = resolveInput(options.input);
  const label = path.relative(projectRoot, input.file).replace(/\\/g, '/');
  console.log(`[백테스트] 입력: ${label}`);
  if (input.subset) {
    console.warn('[백테스트] ⚠ 전체 산출물이 없어 번들(거래 많은 상위 단지)로 돌립니다 — 결과가 거래가 활발한 단지 쪽으로 치우칩니다.');
  }
  let rows = JSON.parse(fs.readFileSync(input.file, 'utf8'));
  if (options.sido) {
    rows = rows.filter((row) => String(row.gu ?? '').startsWith(options.sido));
    if (rows.length === 0) throw new Error(`'${options.sido}' 로 시작하는 지역의 거래가 없습니다.`);
  }
  const groups = groupByComplex(rows);
  rows = null;
  const started = Date.now();
  const report = runBacktest(groups, {
    ...options,
    inputLabel: label,
    subset: input.subset,
    onProgress: (done, total) => process.stdout.write(`  단지 ${done.toLocaleString('ko-KR')}/${total.toLocaleString('ko-KR')}\r`),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const outputDir = options.out ? path.resolve(projectRoot, options.out) : path.join(projectRoot, 'scripts', 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const markdown = renderMarkdown(report);
  fs.writeFileSync(path.join(outputDir, 'backtest_report.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'backtest_report.md'), markdown, 'utf8');
  if (options.md) {
    const target = path.resolve(projectRoot, options.md);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, markdown, 'utf8');
  }

  const current = report.variants.current;
  const fmt = (n) => Number(n).toLocaleString('ko-KR');
  const pct = (v) => (v == null ? '–' : `${v.toFixed(1)}%`);
  if (report.universe.dealing.brokered + report.universe.dealing.direct === 0) {
    console.warn('[백테스트] ⚠ 거래유형 정보가 없는 데이터입니다 — 직거래를 걸러내지 못했습니다 (재수집 전 데이터).');
  }
  console.log(`[백테스트] 데이터 ${report.meta.dataFrom}~${report.meta.dataTo} · 검증 대상 ${report.meta.testFrom}~${report.meta.testTo} (${seconds}초)`);
  console.log(`[백테스트] 가상 매물 ${fmt(report.universe.tested)}건 (직거래 ${fmt(report.universe.skippedDirect)}건 제외) · 판정 가능 ${pct(current.coverage)}`);
  console.log(`[백테스트] 기준가 오차 중앙값 ${pct(current.accuracy.medianAbsError)} · ±5% 이내 ${pct(current.accuracy.within5)} · ±10% 이내 ${pct(current.accuracy.within10)} · 치우침 ${pct(current.accuracy.bias)}`);
  console.log(`[백테스트] 판정 급매 ${fmt(current.flag.flagged)}건(${pct(current.flag.flagRate)}) · 채점 ${fmt(current.flag.scored)}건 · 정밀도 ${pct(current.flag.precision)} · 재현율 ${pct(current.flag.recall)}`);
  const shown = path.relative(projectRoot, outputDir).replace(/\\/g, '/') || '.';
  console.log(`[백테스트] 출력: ${shown}/backtest_report.md · backtest_report.json${options.md ? ` · ${options.md}` : ''}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`[백테스트] 실패: ${err.message}`);
    process.exit(1);
  }
}
