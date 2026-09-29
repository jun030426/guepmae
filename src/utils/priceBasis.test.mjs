import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  basisConditions,
  basisFromComplexRow,
  computePriceBasis,
  discountLabel,
  expandTradeRow,
  floorBandOf,
  formatBasisMethod,
  isHeld,
  median,
  normalizeTrade,
  parseFloor,
  shiftMonth,
  windowStart,
} from './priceBasis.js';

const AS_OF = '2026-07';
const t = (yearMonth, price, floor = 7, extra = {}) => ({ areaM2: 84, yearMonth, day: '10', price, floor, dealing: 'b', ...extra });
// n 개월 전 'YYYY-MM'
const ago = (n) => shiftMonth(AS_OF, -n);

test('median — 짝수 개는 내림 정수 나눗셈', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2); // (2+3)/2 = 2.5 → 2
  assert.equal(median([]), null);
});

test('shiftMonth / windowStart', () => {
  assert.equal(shiftMonth('2026-07', -1), '2026-06');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-07', -11), '2025-08');
  assert.equal(windowStart('2026-07', 12), '2025-08');
  assert.equal(windowStart('2026-07', 36), '2023-08');
});

test('parseFloor — 숫자·텍스트·지하', () => {
  assert.deepEqual(parseFloor('12층'), { floor: 12, band: null });
  assert.deepEqual(parseFloor(5), { floor: 5, band: null });
  assert.deepEqual(parseFloor('저층'), { floor: null, band: 'low' });
  assert.deepEqual(parseFloor('고층'), { floor: null, band: 'high' });
  assert.deepEqual(parseFloor('반지하'), { floor: 0, band: null });
  assert.deepEqual(parseFloor(''), { floor: null, band: null });
  assert.deepEqual(parseFloor('로얄층'), { floor: null, band: null });
});

test('floorBandOf — 저층 1~3, 고층은 최고층 ≥ 10 일 때 상위 3개 층', () => {
  assert.equal(floorBandOf(1, 15), 'low');
  assert.equal(floorBandOf(3, 15), 'low');
  assert.equal(floorBandOf(4, 15), 'mid');
  assert.equal(floorBandOf(13, 15), 'high');
  assert.equal(floorBandOf(12, 15), 'mid');
  assert.equal(floorBandOf(5, 5), 'mid'); // 5층짜리 단지에는 고층 구간 없음
  assert.equal(floorBandOf(null, 15), null);
});

test('normalizeTrade — 압축 배열·인덱스 객체·표준 형태', () => {
  assert.deepEqual(normalizeTrade(['2026-03', '14', 357000000, '5', 'b'], { areaM2: 59 }), {
    areaM2: 59, yearMonth: '2026-03', day: '14', price: 357000000, floor: 5, dealing: 'b', canceled: false,
  });
  assert.equal(normalizeTrade({ a: 84, ym: '2026-01', d: '3', fl: '12', p: 500000000, dl: 'direct' }).dealing, 'd');
  assert.equal(normalizeTrade({ areaM2: 84, yearMonth: '2026-01', price: 0 }), null);
  assert.equal(normalizeTrade({ areaM2: 84, yearMonth: '202601', price: 1 }), null);
  assert.equal(expandTradeRow({ area_m2: 59, trades: [['2026-03', '14', 357000000, 5, 'b'], ['bad']] }).length, 1);
});

test('computePriceBasis — 최근 12개월 표본이 충분하면 12개월 창', () => {
  const trades = [
    t(ago(1), 500000000), t(ago(2), 520000000), t(ago(5), 510000000), t(ago(11), 490000000),
    t(ago(20), 400000000), t(ago(30), 380000000),
  ];
  const basis = computePriceBasis({ trades, areaM2: 84, floor: '7층', price: 450000000, asOf: AS_OF, computedAt: '2026-09-29' });
  assert.equal(basis.status, 'ok');
  assert.equal(basis.windowMonths, 12);
  assert.equal(basis.sampleSize, 4);
  assert.equal(basis.baselinePrice, 505000000); // 490,500,510,520 → (500+510)/2
  assert.equal(basis.discountRate, 10.9);
  assert.equal(basis.totalSample36, 6);
  assert.equal(basis.median36, 495000000);
  assert.equal(basis.periodStart, ago(11));
  assert.equal(basis.periodEnd, ago(1));
  assert.equal(basis.confidence, 'medium');
  // 전부 7층(최고층 7 → 중층) 이라 같은 층 구간 4건 ≥ 3 → 층 보정이 적용되지만 결과는 동일
  assert.equal(basis.floorAdjusted, true);
  assert.match(basis.method, /중층\(4~7층\)/);
});

test('computePriceBasis — 층 구간이 같은 거래가 3건 이상이면 그 거래만 (floorAdjusted)', () => {
  const trades = [
    t(ago(1), 600000000, 15), t(ago(2), 610000000, 14), t(ago(3), 590000000, 13), // 고층 (max 15 → 13~15)
    t(ago(1), 500000000, 7), t(ago(2), 510000000, 8), t(ago(3), 495000000, 6),    // 중층
    t(ago(4), 420000000, 1), t(ago(5), 430000000, 2), t(ago(6), 410000000, 3),    // 저층
  ];
  const high = computePriceBasis({ trades, areaM2: 84, floor: '14층', price: 540000000, asOf: AS_OF });
  assert.equal(high.floorBand, 'high');
  assert.equal(high.floorAdjusted, true);
  assert.equal(high.maxFloor, 15);
  assert.equal(high.baselinePrice, 600000000);
  assert.equal(high.sampleSize, 3);
  assert.match(high.method, /고층\(13~15층\)/);

  const low = computePriceBasis({ trades, areaM2: 84, floor: '2층', price: 380000000, asOf: AS_OF });
  assert.equal(low.floorBand, 'low');
  assert.equal(low.baselinePrice, 420000000);
  assert.equal(low.discountRate, 9.5);

  const text = computePriceBasis({ trades, areaM2: 84, floor: '중층', price: 480000000, asOf: AS_OF });
  assert.equal(text.floorBand, 'mid');
  assert.equal(text.floorAdjusted, true);
  assert.equal(text.baselinePrice, 500000000);
  assert.match(text.method, /중층\(4~12층\)/);
});

test('computePriceBasis — 같은 층 구간이 3건 미만이면 기간 전체를 쓴다', () => {
  const trades = [
    t(ago(1), 600000000, 15), t(ago(2), 500000000, 7), t(ago(3), 510000000, 8), t(ago(4), 495000000, 6),
  ];
  const basis = computePriceBasis({ trades, areaM2: 84, floor: '14층', price: 500000000, asOf: AS_OF });
  assert.equal(basis.floorBand, 'high');
  assert.equal(basis.floorAdjusted, false);
  assert.equal(basis.sampleSize, 4);
  assert.equal(basis.baselinePrice, 505000000);
  const conditions = basisConditions(basis);
  assert.match(conditions.find((c) => c.label === '층 구간').value, /3건 미만/);
});

test('computePriceBasis — 12개월 부족 → 24개월, 그것도 부족 → 36개월', () => {
  const trades = [t(ago(2), 500000000), t(ago(15), 480000000), t(ago(20), 470000000), t(ago(30), 450000000)];
  const b24 = computePriceBasis({ trades, areaM2: 84, floor: '7층', price: 400000000, asOf: AS_OF });
  assert.equal(b24.windowMonths, 24);
  assert.equal(b24.sampleSize, 3);
  assert.equal(b24.baselinePrice, 480000000);

  const b36 = computePriceBasis({ trades: [t(ago(2), 500000000), t(ago(30), 450000000), t(ago(34), 440000000)], areaM2: 84, floor: '7층', price: 400000000, asOf: AS_OF });
  assert.equal(b36.windowMonths, 36);
  assert.equal(b36.sampleSize, 3);
});

test('computePriceBasis — 직거래·해제 거래는 제외되고 건수가 기록된다', () => {
  const trades = [
    t(ago(1), 500000000), t(ago(2), 510000000), t(ago(3), 490000000),
    t(ago(1), 300000000, 7, { dealing: '직거래' }),
    t(ago(2), 200000000, 7, { canceled: true }),
  ];
  const basis = computePriceBasis({ trades, areaM2: 84, floor: '7층', price: 450000000, asOf: AS_OF });
  assert.equal(basis.sampleSize, 3);
  assert.equal(basis.baselinePrice, 500000000);
  assert.equal(basis.excludedDirect, 1);
  assert.equal(basis.excludedCanceled, 1);
  assert.match(basis.method, /직거래 1건 제외/);
  assert.match(basisConditions(basis).find((c) => c.label === '제외').value, /직거래 1건/);
});

test('computePriceBasis — 동일 면적 부족 시 ±2㎡ 근접 면적 (approxArea)', () => {
  const trades = [
    t(ago(1), 500000000, 7, { areaM2: 84 }),
    t(ago(1), 520000000, 7, { areaM2: 85 }), t(ago(2), 530000000, 8, { areaM2: 85 }), t(ago(3), 510000000, 9, { areaM2: 85 }),
    t(ago(1), 700000000, 7, { areaM2: 86 }), t(ago(2), 700000000, 7, { areaM2: 86 }),
  ];
  const basis = computePriceBasis({ trades, areaM2: 84, floor: '7층', price: 480000000, asOf: AS_OF });
  assert.equal(basis.approxArea, true);
  assert.equal(basis.areaM2, 85);
  assert.equal(basis.requestedAreaM2, 84);
  assert.equal(basis.baselinePrice, 520000000);
  assert.match(basis.method, /85㎡\(요청 84㎡ 근접\)/);
});

test('computePriceBasis — 판정 보류: 표본 부족 / 데이터 없음', () => {
  const low = computePriceBasis({ trades: [t(ago(1), 500000000), t(ago(2), 510000000)], areaM2: 84, floor: '7층', price: 400000000, asOf: AS_OF });
  assert.equal(low.status, 'insufficient');
  assert.equal(low.reason, 'low_sample');
  assert.equal(low.baselinePrice, null);
  assert.equal(low.discountRate, null);
  assert.equal(low.totalSample36, 2);
  assert.match(low.method, /2건 — 표본 부족/);
  assert.equal(isHeld(low), true);

  const none = computePriceBasis({ trades: [], areaM2: 84, floor: '7층', price: 400000000, asOf: AS_OF });
  assert.equal(none.status, 'insufficient');
  assert.equal(none.reason, 'no_data');

  const stale = computePriceBasis({ trades: [t(ago(40), 1), t(ago(41), 1), t(ago(42), 1)], areaM2: 84, floor: '7층', price: 1, asOf: AS_OF });
  assert.equal(stale.reason, 'low_sample'); // 36개월 밖 거래는 세지 않는다
});

test('basisFromComplexRow — 폴백 근거는 전체 기간·층 보정 없음을 명시', () => {
  const basis = basisFromComplexRow(
    { area_m2: 84, median_price: 400000000, sample_size: 30, earliest_year_month: '2023-08', latest_year_month: '2026-07' },
    { requestedAreaM2: 84, price: 320000000, computedAt: '2026-09-29' },
  );
  assert.equal(basis.status, 'ok');
  assert.equal(basis.discountRate, 20);
  assert.equal(basis.fallback, 'complex_prices');
  assert.match(basis.method, /전체 기간 · 층 보정 없음/);
  assert.equal(isHeld(basis), false);
  assert.equal(isHeld({ source: 'complex', sampleSize: 18 }), false); // 옛 형태
});

test('formatBasisMethod / discountLabel', () => {
  assert.equal(formatBasisMethod({ status: 'ok', areaM2: 59, approxArea: false, floorAdjusted: false, windowMonths: 12, sampleSize: 7, excludedDirect: 0 }), '동일 단지 59㎡ · 최근 12개월 7건 중앙값');
  assert.equal(discountLabel(null), '판정 보류');
  assert.equal(discountLabel(15.8), '15.8%');
  assert.equal(discountLabel(20), '20%');
});
