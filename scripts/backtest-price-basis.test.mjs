import test from 'node:test';
import assert from 'node:assert/strict';
import { computePriceBasis, shiftMonth } from '../src/utils/priceBasis.js';
import {
  createAggregator,
  dataRange,
  evaluateComplex,
  groupByComplex,
  isFlagged,
  medianOf,
  monthIndex,
  monthOf,
  parseArgs,
  runBacktest,
  summarizeBucket,
  testRange,
  VARIANTS,
} from './backtest-price-basis.mjs';

const GU = '서울특별시 강남구';
const M = 1000000; // 백만원
const row = (complex, area, trades, gu = GU) => ({ complex, gu, area_m2: area, trades });
const tr = (ym, price, floor = 7, dealing = 'b', day = '10') => [ym, day, price, floor, dealing];
const monthsFrom = (from, n) => Array.from({ length: n }, (_, i) => shiftMonth(from, i));
const only = (rows) => [...groupByComplex(rows).values()][0];
const at = (ym) => ({ first: ym, last: ym });

// 결정적 난수
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('monthIndex / monthOf / medianOf', () => {
  assert.equal(monthOf(monthIndex('2026-07')), '2026-07');
  assert.equal(monthOf(monthIndex('2026-01') - 1), '2025-12');
  assert.equal(monthIndex('2026-03') - monthIndex('2025-12'), 3);
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([1, 2, 3, 4]), 2.5); // 통계용은 평균 (가격 중앙값의 내림과 다름)
  assert.equal(medianOf([-10, -6, 2, -1]), -3.5);
  assert.equal(medianOf([]), null);
});

test('groupByComplex — 같은 단지의 면적을 합치고, 구가 다르면 다른 단지', () => {
  const groups = groupByComplex([
    row('래미안', 84, [tr('2026-02', 500 * M, 12), tr('2026-01', 490 * M, 3)]),
    row('래미안', 59, [tr('2026-01', 300 * M, 20, 'b', '02')]),
    row('래미안', 84, [tr('2026-01', 700 * M)], '서울특별시 서초구'),
    { complex: '', gu: GU, area_m2: 84, trades: [tr('2026-01', 1)] },
  ]);
  assert.equal(groups.size, 2);
  const gangnam = groups.get(`${GU}\t래미안`);
  assert.deepEqual(gangnam.trades.map((t) => [t.yearMonth, t.day, t.areaM2]), [['2026-01', '02', 59], ['2026-01', '10', 84], ['2026-02', '10', 84]]);
  assert.equal(gangnam.sido, '서울특별시');
  assert.equal(gangnam.maxFloorByArea.get(84), 12);
  assert.equal(gangnam.maxFloorByArea.get(59), 20);
  assert.deepEqual(dataRange(groups), { from: '2026-01', to: '2026-02' });
});

test('testRange — 이력이 충분하고 이후 시세를 볼 수 있는 달만', () => {
  assert.deepEqual(testRange({ from: '2023-10', to: '2026-09' }), { first: '2025-10', last: '2026-04' });
  assert.deepEqual(testRange({ from: '2023-10', to: '2026-09' }, { minHistoryMonths: 12, horizonMonths: 3 }), { first: '2024-10', last: '2026-07' });
  assert.equal(testRange({ from: '2025-01', to: '2026-09' }), null); // 21개월 — 이력 24개월을 채우지 못함
  assert.equal(testRange(null), null);
});

// 매달 5억에 한 건씩 거래되는 단지 + 2026-01 에 4.5억 거래 한 건
const steady = () => [
  row('한결', 84, [
    ...monthsFrom('2024-01', 30).map((ym) => tr(ym, 500 * M, 7)),
    tr('2026-01', 450 * M, 8, 'b', '20'),
  ]),
];

test('evaluateComplex — 기준가는 앞선 달의 거래로, 이후 시세는 그 달부터 6개월', () => {
  const { records, skippedDirect } = evaluateComplex(only(steady()), at('2026-01'));
  assert.equal(skippedDirect, 0);
  assert.equal(records.length, 2);
  const [regular, cheap] = records;

  assert.equal(cheap.price, 450 * M);
  assert.deepEqual(cheap.variants.current, {
    status: 'ok', baseline: 500 * M, discount: 10, error: -10,
    windowMonths: 12, sampleSize: 12, floorBand: 'mid', floorAdjusted: true, approxArea: false,
  });
  assert.equal(cheap.staleness, 0);
  // 이후 시세: 2026-01~06 의 5억 거래 6건 (자신 제외)
  assert.deepEqual(cheap.outcome, { price: 500 * M, sample: 6, banded: true, realized: 10 });

  assert.equal(regular.variants.current.discount, 0);
  // 같은 달의 4.5억 거래는 이후 시세 표본에 들어가지만 중앙값은 5억
  assert.deepEqual(regular.outcome, { price: 500 * M, sample: 6, banded: true, realized: 0 });
  for (const name of VARIANTS) assert.equal(cheap.variants[name].baseline, 500 * M, name);
});

test('evaluateComplex — 그 달 이후의 거래는 기준가에 영향을 주지 않는다', () => {
  const rows = steady();
  rows[0].trades = rows[0].trades.map((t) => (t[0] >= '2026-01' && t[2] === 500 * M ? tr(t[0], 300 * M, 7) : t));
  const cheap = evaluateComplex(only(rows), at('2026-01')).records.find((r) => r.price === 450 * M);
  assert.equal(cheap.variants.current.baseline, 500 * M);
  assert.equal(cheap.variants.current.discount, 10);
  assert.equal(cheap.outcome.price, 300 * M);
  assert.equal(cheap.outcome.realized, -50); // 시장이 내려앉았다 — 판정은 급매였지만 실제로는 비쌌다
});

test('evaluateComplex — 같은 달의 다른 거래도 기준가에 들어가지 않는다', () => {
  // 앞선 거래는 5억 3건뿐. 같은 달과 그 뒤에는 3억 거래가 더 많다 — 하나라도 새어 들어가면 중앙값이 3억이 된다
  const rows = [row('누수', 84, [
    tr('2025-10', 500 * M), tr('2025-11', 500 * M), tr('2025-12', 500 * M),
    tr('2026-01', 300 * M, 7, 'b', '01'), tr('2026-01', 300 * M, 7, 'b', '02'), tr('2026-01', 300 * M, 7, 'b', '03'),
    tr('2026-01', 450 * M, 7, 'b', '15'),
    tr('2026-01', 300 * M, 7, 'b', '28'),
    tr('2026-02', 300 * M), tr('2026-03', 300 * M),
  ])];
  const { records } = evaluateComplex(only(rows), at('2026-01'));
  assert.equal(records.length, 5);
  for (const record of records) {
    for (const name of VARIANTS) {
      assert.equal(record.variants[name].baseline, 500 * M, `${record.price} ${name}`);
      assert.equal(record.variants[name].sampleSize, 3, name);
    }
    assert.equal(record.staleness, 0);
  }
  const cheap = records.find((r) => r.price === 450 * M);
  assert.deepEqual(cheap.outcome, { price: 300 * M, sample: 6, banded: true, realized: -50 });
});

test('evaluateComplex — 같은 날 같은 가격의 다른 거래는 이후 시세에 남는다 (자신만 제외)', () => {
  const rows = [row('쌍둥이', 84, [
    ...monthsFrom('2024-01', 24).map((ym) => tr(ym, 500 * M)),
    tr('2026-01', 480 * M), tr('2026-01', 480 * M), tr('2026-01', 480 * M), tr('2026-01', 480 * M),
  ])];
  const { records } = evaluateComplex(only(rows), at('2026-01'));
  assert.equal(records.length, 4);
  for (const record of records) assert.deepEqual(record.outcome, { price: 480 * M, sample: 3, banded: true, realized: 0 });
});

test('evaluateComplex — 직거래는 가상 매물에서 빼고, 기준가에서도 뺀다', () => {
  const rows = [row('가족', 84, [
    tr('2025-07', 500 * M), tr('2025-08', 500 * M), tr('2025-09', 500 * M),
    tr('2025-10', 100 * M, 7, 'd'), tr('2025-11', 100 * M, 7, 'd'), tr('2025-12', 100 * M, 7, 'd'),
    tr('2026-01', 100 * M, 7, 'd', '05'),
    tr('2026-01', 450 * M, 7, 'b', '20'),
  ])];
  const { records, skippedDirect } = evaluateComplex(only(rows), at('2026-01'));
  assert.equal(skippedDirect, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].variants.current.baseline, 500 * M);
  assert.equal(records[0].variants.current.sampleSize, 3);
  // 직거래를 일반 거래로 넣으면 [1억×3, 5억×3] 의 중앙값 3억
  assert.equal(records[0].variants.include_direct.baseline, 300 * M);
  assert.equal(records[0].variants.include_direct.discount, -50);
  assert.equal(records[0].outcome, null); // 이후 거래가 직거래뿐
});

test('evaluateComplex — 기준월은 단지의 최근 거래월, 달력 기준 변형은 전달', () => {
  const rows = [row('한산', 84, [
    ...monthsFrom('2024-01', 6).map((ym) => tr(ym, 500 * M)),
    tr('2026-01', 450 * M),
  ])];
  const [record] = evaluateComplex(only(rows), at('2026-01')).records;
  assert.equal(record.staleness, 18); // 2024-06 → 2025-12
  assert.equal(record.variants.current.windowMonths, 12); // 2023-07~2024-06 을 "최근 12개월"로 본다
  assert.equal(record.variants.calendar_anchor.windowMonths, 24); // 2024-01~2025-12
  assert.equal(record.variants.calendar_anchor.baseline, 500 * M);
});

test('evaluateComplex — 달력 기준으로는 36개월 밖이 되는 거래', () => {
  const rows = [row('오래된', 84, [
    ...monthsFrom('2022-06', 3).map((ym) => tr(ym, 500 * M)),
    tr('2026-01', 450 * M),
  ])];
  const [record] = evaluateComplex(only(rows), at('2026-01')).records;
  assert.equal(record.variants.current.status, 'ok'); // 기준월 2022-08 기준으로는 최근 12개월
  assert.deepEqual(record.variants.calendar_anchor, { status: 'held', reason: 'low_sample' }); // 2023-01 이후 거래 없음
});

test('evaluateComplex — 판정 보류: 표본 부족 / 앞선 거래 없음', () => {
  const thin = [row('얇은', 84, [tr('2025-06', 500 * M), tr('2025-09', 500 * M), tr('2026-01', 450 * M)])];
  const [low] = evaluateComplex(only(thin), at('2026-01')).records;
  for (const name of VARIANTS) assert.deepEqual(low.variants[name], { status: 'held', reason: 'low_sample' }, name);

  // 다른 면적 거래만 있는 단지 — 단지에 앞선 거래는 있으므로 표본 부족
  const otherArea = [row('얇은', 59, monthsFrom('2025-01', 12).map((ym) => tr(ym, 300 * M))), row('얇은', 84, [tr('2026-01', 450 * M)])];
  const [other] = evaluateComplex(only(otherArea), at('2026-01')).records;
  assert.deepEqual(other.variants.current, { status: 'held', reason: 'low_sample' });

  const fresh = [row('새단지', 84, [tr('2026-01', 450 * M), tr('2026-02', 460 * M)])];
  const [first] = evaluateComplex(only(fresh), at('2026-01')).records;
  assert.equal(first.staleness, null);
  for (const name of VARIANTS) assert.deepEqual(first.variants[name], { status: 'held', reason: 'no_data' }, name);
});

test('evaluateComplex — 근접 면적(±2㎡)으로 기준가를 잡은 경우', () => {
  const rows = [
    row('근접', 85, monthsFrom('2025-01', 12).map((ym) => tr(ym, 500 * M))),
    row('근접', 84, [tr('2026-01', 450 * M)]),
  ];
  const [record] = evaluateComplex(only(rows), at('2026-01')).records;
  assert.equal(record.variants.current.approxArea, true);
  assert.equal(record.variants.current.baseline, 500 * M);
  assert.equal(record.outcome, null); // 이후 시세는 같은 면적만
});

test('이후 시세 — 같은 층 구간 거래만, 다른 면적은 제외. 모자라면 전체 층으로 넓히지 않는다', () => {
  const rows = [
    row('층차', 84, [
      ...monthsFrom('2025-01', 12).map((ym) => tr(ym, 500 * M, 8)),
      tr('2026-01', 450 * M, 2, 'b', '01'), // 저층 가상 매물
      tr('2026-02', 450 * M, 1), tr('2026-03', 450 * M, 3), tr('2026-04', 450 * M, 2), // 저층 3건
      tr('2026-02', 500 * M, 8), tr('2026-03', 500 * M, 9), tr('2026-04', 500 * M, 10), tr('2026-05', 500 * M, 11), tr('2026-06', 500 * M, 12),
    ]),
    row('층차', 59, monthsFrom('2026-01', 6).map((ym) => tr(ym, 100 * M, 2))),
  ];
  const record = evaluateComplex(only(rows), at('2026-01')).records.find((r) => r.floor === 2);
  assert.deepEqual(record.outcome, { price: 450 * M, sample: 3, banded: true, realized: 0 });
  // 기준가는 저층 표본이 없어 전체 층(5억) — 판정은 급매 10% 지만 같은 층끼리 보면 제값이었다
  assert.equal(record.variants.current.discount, 10);
  assert.equal(record.variants.current.floorAdjusted, false);

  // 2026-01~03: 저층은 2건뿐 — 중층 거래(2건)가 있어도 빌려 오지 않는다
  const few = evaluateComplex(only(rows), at('2026-01'), { horizonMonths: 3 }).records.find((r) => r.floor === 2);
  assert.equal(few.outcome, null);

  // 층을 모르는 매물은 전체 층과 비교한다
  const unknown = [row('층모름', 84, [
    ...monthsFrom('2025-01', 12).map((ym) => tr(ym, 500 * M, 8)),
    tr('2026-01', 450 * M, null, 'b', '01'),
    tr('2026-02', 450 * M, 1), tr('2026-03', 500 * M, 9), tr('2026-04', 520 * M, null),
  ])];
  const record2 = evaluateComplex(only(unknown), at('2026-01')).records[0];
  assert.deepEqual(record2.outcome, { price: 500 * M, sample: 3, banded: false, realized: 10 });
});

test('evaluateComplex — 범위 밖의 달은 채점하지 않는다', () => {
  const group = only(steady());
  assert.equal(evaluateComplex(group, { first: '2026-01', last: '2026-03' }).records.length, 4);
  assert.equal(evaluateComplex(group, { first: '2027-01', last: '2027-03' }).records.length, 0);
  assert.equal(evaluateComplex(group, { first: '2020-01', last: '2020-03' }).records.length, 0);
});

test('사전 필터로 넘긴 결과 = 단지 전체 거래를 넘긴 결과', () => {
  const rand = mulberry32(7);
  const areas = [58, 59, 60, 84, 85];
  const rows = areas.map((area) => row('혼합', area, []));
  for (const ym of monthsFrom('2022-01', 54)) {
    for (const r of rows) {
      const n = Math.floor(rand() * 3); // 0~2건 — 면적별로 표본이 모자란 달이 생긴다
      for (let i = 0; i < n; i += 1) {
        const dealing = rand() < 0.15 ? 'd' : rand() < 0.1 ? '' : 'b';
        r.trades.push(tr(ym, Math.round((r.area_m2 * 6 + rand() * 60) * M), 1 + Math.floor(rand() * 18), dealing, String(1 + Math.floor(rand() * 28))));
      }
    }
  }
  const group = only(rows);
  const { records } = evaluateComplex(group, { first: '2024-01', last: '2026-06' });
  assert.ok(records.length > 100);
  const statuses = new Set();
  for (const record of records) {
    const prior = group.trades.filter((t) => t.yearMonth < record.yearMonth);
    const asOf = prior.reduce((max, t) => (t.yearMonth > max ? t.yearMonth : max), '');
    const direct = computePriceBasis({ trades: prior, areaM2: record.areaM2, floor: record.floor, price: record.price, asOf, computedAt: 'x' });
    const got = record.variants.current;
    statuses.add(`${got.status}${got.approxArea ? '+approx' : ''}${got.floorAdjusted ? '+floor' : ''}`);
    if (direct.status !== 'ok') {
      assert.equal(got.status, 'held');
    } else {
      assert.equal(got.baseline, direct.baselinePrice);
      assert.equal(got.discount, direct.discountRate);
      assert.equal(got.windowMonths, direct.windowMonths);
      assert.equal(got.sampleSize, direct.sampleSize);
      assert.equal(got.floorAdjusted, direct.floorAdjusted);
      assert.equal(got.approxArea, direct.approxArea);
      assert.equal(record.variants.all_36.baseline, direct.median36);
    }
  }
  // 여러 갈래(근접 면적·층 보정·보류)가 실제로 검사됐는지
  assert.ok(statuses.has('ok'), [...statuses].join());
  assert.ok([...statuses].some((s) => s.includes('+floor')), [...statuses].join());
});

// ───────────────────────── 집계 ─────────────────────────

const ok = (error, extra = {}) => ({
  status: 'ok', baseline: 500 * M, discount: Math.round(-error * 10) / 10, error,
  windowMonths: 12, sampleSize: 6, floorBand: 'mid', floorAdjusted: true, approxArea: false, ...extra,
});
const record = (result, realized, extra = {}) => ({
  sido: '서울특별시', yearMonth: '2026-01', areaM2: 84, floor: 7, price: 450 * M, staleness: 0,
  outcome: realized == null ? null : { price: 500 * M, sample: 3, banded: true, realized },
  variants: Object.fromEntries(VARIANTS.map((name) => [name, result])),
  ...extra,
});

test('isFlagged — 5% 이상 40% 이하', () => {
  assert.equal(isFlagged(5), true);
  assert.equal(isFlagged(4.9), false);
  assert.equal(isFlagged(40), true);
  assert.equal(isFlagged(40.1), false);
  assert.equal(isFlagged(null), false);
  assert.equal(isFlagged(8, 10), false);
});

test('집계 — 정확도·정밀도·재현율을 손으로 계산한 값과 비교', () => {
  const aggregator = createAggregator();
  aggregator.add(record(ok(-10), 8)); // 판정 급매, 실제 급매
  aggregator.add(record(ok(-6), 1)); // 판정 급매, 실제로는 1% 쌌음
  aggregator.add(record(ok(2), 7)); // 판정 아님, 실제 급매 (놓침)
  aggregator.add(record(ok(-1), null)); // 이후 시세 없음
  aggregator.add(record({ status: 'held', reason: 'low_sample' }, 9));
  aggregator.add(record({ status: 'held', reason: 'no_data' }, null));
  const { variants, current } = aggregator.summary();

  assert.deepEqual(variants.current, {
    tested: 6, judged: 4, coverage: 66.7,
    held: { noData: 1, lowSample: 1 },
    approxArea: 0,
    accuracy: { n: 4, medianAbsError: 4, within5: 50, within10: 100, bias: -3.5, outlierShare: 0 },
    flag: {
      flagged: 2, flagRate: 50, outliers: 0, scored: 2,
      precision: 50, loosePrecision: 100, recall: 50,
      medianRealized: 4.5, medianRealizedUnflagged: 7,
    },
    outcomeShare: 75,
  });
  assert.deepEqual(variants.no_floor, variants.current);

  const bucket = (key) => current.byDiscountBucket.find((b) => b.key === key);
  assert.deepEqual(bucket('10~15'), { key: '10~15', n: 1, medianRealized: 8, cheaperShare: 100, bargainShare: 100 });
  assert.deepEqual(bucket('5~10'), { key: '5~10', n: 1, medianRealized: 1, cheaperShare: 100, bargainShare: 0 });
  assert.deepEqual(bucket('0 미만'), { key: '0 미만', n: 1, medianRealized: 7, cheaperShare: 100, bargainShare: 100 });
  assert.deepEqual(bucket('40 초과'), { key: '40 초과', n: 0, medianRealized: null, cheaperShare: null, bargainShare: null });

  const threshold = (t) => current.byThreshold.find((row) => row.threshold === t);
  assert.deepEqual(threshold(5), { threshold: 5, flagged: 2, flagShare: 66.7, precision: 50, loosePrecision: 100, medianRealized: 4.5 });
  assert.deepEqual(threshold(7), { threshold: 7, flagged: 1, flagShare: 33.3, precision: 100, loosePrecision: 100, medianRealized: 8 });
  assert.deepEqual(threshold(15), { threshold: 15, flagged: 0, flagShare: 0, precision: null, loosePrecision: null, medianRealized: null });

  assert.deepEqual(current.byWindow.map((w) => [w.key, w.judged]), [['12개월', 4]]);
  assert.deepEqual(current.bySido.map((s) => [s.key, s.tested, s.judged]), [['서울특별시', 6, 4]]);
  assert.deepEqual(current.byQuarter.map((q) => q.key), ['2026 1분기']);
});

test('집계 — 세부 분해의 구간 나누기', () => {
  const aggregator = createAggregator();
  aggregator.add(record(ok(-1, { windowMonths: 24, sampleSize: 3, floorAdjusted: false, floorBand: 'low' }), 0, { staleness: 5, sido: '부산광역시', yearMonth: '2025-11' }));
  aggregator.add(record(ok(-1, { windowMonths: 36, sampleSize: 12, floorAdjusted: false, floorBand: null }), 0, { staleness: 9 }));
  aggregator.add(record(ok(-45), 0, { staleness: 2 }));
  const { current, variants } = aggregator.summary();
  assert.deepEqual(current.byWindow.map((w) => w.key), ['12개월', '24개월', '36개월']);
  assert.deepEqual(current.bySample.map((w) => w.key), ['3~4건', '5~9건', '10건 이상']);
  assert.deepEqual(current.byFloor.map((w) => w.key), ['같은 층 구간만 사용', '층 구간 표본 부족 → 전체 층', '층 정보 없음']);
  assert.deepEqual(current.byStaleness.map((w) => w.key), ['1~3개월', '4~6개월', '7개월 이상']);
  assert.deepEqual(current.byQuarter.map((w) => w.key), ['2025 4분기', '2026 1분기']);
  // 할인율 45% 는 급매가 아니라 이상치
  assert.equal(variants.current.flag.flagged, 0);
  assert.equal(variants.current.flag.outliers, 1);
  assert.equal(variants.current.accuracy.outlierShare, 33.3);
});

test('summarizeBucket — 빈 묶음도 깨지지 않는다', () => {
  const { variants } = createAggregator().summary();
  assert.equal(variants.current.tested, 0);
  assert.equal(variants.current.coverage, null);
  assert.equal(variants.current.accuracy.medianAbsError, null);
  assert.equal(variants.current.flag.precision, null);
});

// ───────────────────────── 합성 시장 ─────────────────────────

/**
 * 단지 40곳 · 매달 3건 · 42개월. trend: 월별 가격 변화율, lowFloorDiscount: 1~3층 할인,
 * noise: ±비율(균등). 가격 = 단지 기준가 × 추세 × 층 × (1 + 잡음)
 */
function market({ seed, trend = 0, lowFloorDiscount = 0, noise = 0.04, complexes = 40 }) {
  const rand = mulberry32(seed);
  const rows = [];
  for (let c = 0; c < complexes; c += 1) {
    const base = (400 + Math.floor(rand() * 600)) * M;
    const trades = [];
    monthsFrom('2023-01', 42).forEach((ym, index) => {
      for (let i = 0; i < 3; i += 1) {
        const floor = 1 + Math.floor(rand() * 15);
        const factor = (1 + trend) ** index * (floor <= 3 ? 1 - lowFloorDiscount : 1) * (1 + (rand() * 2 - 1) * noise);
        trades.push(tr(ym, Math.round(base * factor), floor, 'b', String(1 + Math.floor(rand() * 28))));
      }
    });
    rows.push(row(`단지${c}`, 84, trades, c % 2 ? '부산광역시 해운대구' : GU));
  }
  return groupByComplex(rows);
}

test('합성 시장 — 가격이 일정하면 치우침이 없고 오차는 잡음 수준', () => {
  const report = runBacktest(market({ seed: 1 }), { generatedAt: '2026-09-29' });
  assert.deepEqual([report.meta.dataFrom, report.meta.dataTo, report.meta.testFrom, report.meta.testTo], ['2023-01', '2026-06', '2025-01', '2026-01']);
  assert.equal(report.universe.tested, 40 * 3 * 13);
  const { accuracy, coverage, flag } = report.variants.current;
  assert.equal(coverage, 100);
  assert.ok(Math.abs(accuracy.bias) < 0.5, `bias ${accuracy.bias}`);
  assert.ok(accuracy.medianAbsError > 1 && accuracy.medianAbsError < 3.5, `오차 ${accuracy.medianAbsError}`);
  assert.ok(accuracy.within10 > 99, `±10% ${accuracy.within10}`);
  // 잡음 ±4% 에서 기준가보다 5% 넘게 싼 거래는 드물다
  assert.ok(flag.flagRate < 3, `급매 비율 ${flag.flagRate}`);
});

test('합성 시장 — 하락장에서는 치우침이 음수가 되고 급매 판정이 틀린다', () => {
  const flat = runBacktest(market({ seed: 2, noise: 0.08 }), { generatedAt: '2026-09-29' }).variants;
  const falling = runBacktest(market({ seed: 2, noise: 0.08, trend: -0.01 }), { generatedAt: '2026-09-29' }).variants;

  // 매달 1% 하락: 최근 12개월 중앙값은 현재보다 6% 가량 높다
  assert.ok(falling.current.accuracy.bias < -4, `하락장 치우침 ${falling.current.accuracy.bias}`);
  assert.ok(Math.abs(flat.current.accuracy.bias) < 1, `보합 치우침 ${flat.current.accuracy.bias}`);
  // 제값인 거래가 급매로 판정된다 → 급매 비율은 늘고 정밀도는 떨어진다
  assert.ok(falling.current.flag.flagRate > flat.current.flag.flagRate * 2, `${falling.current.flag.flagRate} vs ${flat.current.flag.flagRate}`);
  assert.ok(falling.current.flag.precision < flat.current.flag.precision - 20, `${falling.current.flag.precision} vs ${flat.current.flag.precision}`);
  // 기간 창이 짧을수록 덜 틀린다: 36개월 전체 중앙값은 더 높다
  assert.ok(falling.all_36.accuracy.bias < falling.current.accuracy.bias - 3, `${falling.all_36.accuracy.bias} vs ${falling.current.accuracy.bias}`);
  assert.ok(falling.all_36.accuracy.medianAbsError > falling.current.accuracy.medianAbsError);
});

test('합성 시장 — 저층이 10% 싼 단지에서는 층 보정이 오차를 줄인다', () => {
  const report = runBacktest(market({ seed: 3, lowFloorDiscount: 0.1 }), { generatedAt: '2026-09-29' });
  const { current, no_floor: noFloor } = report.variants;
  assert.ok(current.accuracy.medianAbsError < noFloor.accuracy.medianAbsError, `${current.accuracy.medianAbsError} vs ${noFloor.accuracy.medianAbsError}`);
  // 층 보정이 없으면 저층 거래가 "급매"로 잡힌다 — 같은 층끼리 보면 제값이므로 정밀도가 낮다
  assert.ok(noFloor.flag.flagRate > current.flag.flagRate + 5, `${noFloor.flag.flagRate} vs ${current.flag.flagRate}`);
  assert.ok(noFloor.flag.precision < 20, `층 보정 없음 정밀도 ${noFloor.flag.precision}`);
  const adjusted = report.current.byFloor.find((f) => f.key === '같은 층 구간만 사용');
  assert.ok(adjusted.judged > 1000);
});

test('runBacktest — 검증할 달이 없으면 이유를 말한다', () => {
  const short = groupByComplex([row('짧은', 84, monthsFrom('2025-01', 12).map((ym) => tr(ym, 500 * M)))]);
  assert.throws(() => runBacktest(short), /검증할 달이 없습니다 — 데이터 2025-01~2025-12/);
  assert.throws(() => runBacktest(new Map()), /데이터 없음/);
  const report = runBacktest(short, { minHistoryMonths: 6, horizonMonths: 3, generatedAt: '2026-09-29' });
  assert.deepEqual([report.meta.testFrom, report.meta.testTo], ['2025-07', '2025-10']);
  assert.equal(report.universe.tested, 4);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs([]), { input: null, out: null, md: null, sido: null, minHistoryMonths: 24, horizonMonths: 6 });
  assert.deepEqual(
    parseArgs(['--sido', '서울특별시', '--min-history', '12', '--horizon', '3', '--md', 'docs/BACKTEST.md', '--input', 'x.json']),
    { input: 'x.json', out: null, md: 'docs/BACKTEST.md', sido: '서울특별시', minHistoryMonths: 12, horizonMonths: 3 },
  );
  assert.throws(() => parseArgs(['--horizon']), /값이 필요/);
  assert.throws(() => parseArgs(['--horizon', '--md']), /값이 필요/);
  assert.throws(() => parseArgs(['--horizon', '0']), /1~120/);
  assert.throws(() => parseArgs(['--min-history', '2.5']), /1~120/);
  assert.throws(() => parseArgs(['--horizn', '6']), /알 수 없는 옵션/);
});

test('summarizeBucket — 직접 호출', () => {
  const summary = summarizeBucket({
    tested: 2, heldNoData: 0, heldLowSample: 0, approxArea: 1, errors: [3, -50],
    flagged: 0, outliers: 1, scored: 0, flaggedScored: 0, truePositive: 0, looseHit: 0, missed: 0,
    realizedFlagged: [], realizedUnflagged: [],
  });
  assert.equal(summary.accuracy.medianAbsError, 26.5);
  assert.equal(summary.accuracy.outlierShare, 50);
  assert.equal(summary.approxArea, 1);
  assert.equal(summary.flag.recall, null);
});
