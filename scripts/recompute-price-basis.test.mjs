import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeComplex,
  buildComplexIndex,
  resolveComplex,
  recomputeBasis,
  median,
  areaSummary,
  recentTrades,
  realHistory,
  buildTradesIndex,
  makeTradeKey,
} from './recompute-price-basis.mjs';

const CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '한신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,84,60–85㎡,400000000,30,2023-07,2026-07,2015',
  '한신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,59,60㎡ 이하,300000000,2,2023-07,2026-07,2015',
].join('\n');

const INDEX = buildComplexIndex(CSV);
const TODAY = '2026-08-27';

// import-listings.py:resolve_complex 3단계 매칭 검증용 픽스처.
// len(n2) >= 3 가드에 걸리지 않도록 모든 fuzzy 대상 이름은 3자 이상으로 구성한다.
const CSV2 = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '삼천리1,강원특별자치도 원주시 단구동,강원특별자치도 원주시,84,60–85㎡,300000000,15,2023-01,2026-07,2005',
  '대림서초리시온,강원특별자치도 원주시 단구동,강원특별자치도 원주시,59,60㎡ 이하,900000000,20,2023-01,2026-07,2010',
  '한신더휴(1차),강원특별자치도 원주시 무실동,강원특별자치도 원주시,84,60–85㎡,410000000,10,2023-01,2026-07,2000',
  '현대타운1차,강원특별자치도 원주시 단구동,강원특별자치도 원주시,84,60–85㎡,500000000,10,2023-01,2026-07,1999',
  '현대타운2차,강원특별자치도 원주시 단구동,강원특별자치도 원주시,84,60–85㎡,550000000,10,2023-01,2026-07,1999',
  '두산위브,인천광역시 부평구 부평동,인천광역시 부평구,84,60–85㎡,350000000,12,2023-01,2026-07,2008',
].join('\n');

const INDEX2 = buildComplexIndex(CSV2);

const prop = (over = {}) => ({
  id: 'gm-x', region: '강원특별자치도 원주시', title: '한신 전용84㎡',
  price: 320000000, area: 84,
  price_basis: { source: 'complex', coordSource: 'places' },
  ...over,
});

test('normalizeComplex strips spaces and the 아파트 suffix', () => {
  assert.equal(normalizeComplex(' 한신 아파트 '), '한신');
  assert.equal(normalizeComplex('래미안대치팰리스'), '래미안대치팰리스');
});

test('buildComplexIndex keys on gu and normalized complex name', () => {
  const g = INDEX.get('강원특별자치도 원주시');
  assert.ok(g.has('한신'));
  assert.equal(g.get('한신').rows.length, 2);
});

test('recomputeBasis returns the new median and discount', () => {
  const out = recomputeBasis(prop(), INDEX, TODAY);
  assert.equal(out.actual_transaction_price, 400000000);
  assert.equal(out.discount_rate, 20);  // (400000000-320000000)/400000000*100
});

test('recomputeBasis stamps the sample window and computedAt', () => {
  const out = recomputeBasis(prop(), INDEX, TODAY);
  assert.equal(out.price_basis.sampleSize, 30);
  assert.equal(out.price_basis.periodStart, '2023-07');
  assert.equal(out.price_basis.periodEnd, '2026-07');
  assert.equal(out.price_basis.computedAt, TODAY);
  assert.match(out.price_basis.method, /84㎡ · 2023-07~2026-07 30건 중앙값/);
});

test('recomputeBasis preserves unrelated price_basis fields', () => {
  assert.equal(recomputeBasis(prop(), INDEX, TODAY).price_basis.coordSource, 'places');
});

test('recomputeBasis returns null below MIN_DISC', () => {
  // 중앙값 400,000,000 대비 3% 할인
  assert.equal(recomputeBasis(prop({ price: 388000000 }), INDEX, TODAY), null);
});

test('recomputeBasis returns null above MAX_DISC', () => {
  // 55% 할인 — 이상치
  assert.equal(recomputeBasis(prop({ price: 180000000 }), INDEX, TODAY), null);
});

// ---- MIN_DISC/MAX_DISC 경계값: import-listings.py 는 `if disc < MIN_DISC: continue` /
// `if disc > MAX_DISC: continue` 로 양쪽 경계를 포함(inclusive)한다. 실제 배포 데이터에
// 정확히 5% 할인인 매물이 있어, 경계 자체가 회귀 없이 유지되는지 고정해 둔다.
// 중앙값 400,000,000 기준 가격을 역산해 계산된 discount_rate 가 정확히 경계에 떨어지게 한다.

test('recomputeBasis keeps a discount of exactly MIN_DISC (5.0)', () => {
  // (400,000,000 - 380,000,000) / 400,000,000 * 100 = 5.0
  const out = recomputeBasis(prop({ price: 380000000 }), INDEX, TODAY);
  assert.ok(out);
  assert.equal(out.discount_rate, 5.0);
});

test('recomputeBasis keeps a discount of exactly MAX_DISC (40.0)', () => {
  // (400,000,000 - 240,000,000) / 400,000,000 * 100 = 40.0
  const out = recomputeBasis(prop({ price: 240000000 }), INDEX, TODAY);
  assert.ok(out);
  assert.equal(out.discount_rate, 40.0);
});

test('recomputeBasis returns null just below MIN_DISC (4.9)', () => {
  // (400,000,000 - 380,400,000) / 400,000,000 * 100 = 4.9
  assert.equal(recomputeBasis(prop({ price: 380400000 }), INDEX, TODAY), null);
});

test('recomputeBasis returns null just above MAX_DISC (40.1)', () => {
  // (400,000,000 - 239,600,000) / 400,000,000 * 100 = 40.1
  assert.equal(recomputeBasis(prop({ price: 239600000 }), INDEX, TODAY), null);
});

test('recomputeBasis returns null when the sample is too thin', () => {
  // 59㎡ 행은 sample_size 2 < MIN_SAMPLE(3)
  assert.equal(recomputeBasis(prop({ area: 59, price: 200000000 }), INDEX, TODAY), null);
});

test('recomputeBasis returns null when the complex is unknown', () => {
  assert.equal(recomputeBasis(prop({ region: '서울특별시 중구' }), INDEX, TODAY), null);
});

test('recomputeBasis falls back to an area within 2 and flags it approximate', () => {
  const out = recomputeBasis(prop({ area: 83 }), INDEX, TODAY);
  assert.equal(out.actual_transaction_price, 400000000);
  assert.equal(out.price_basis.approxArea, true);
  assert.equal(out.price_basis.areaM2, 84);
  assert.equal(out.price_basis.requestedAreaM2, 83);
});

test('recomputeBasis marks an exact area match as not approximate', () => {
  assert.equal(recomputeBasis(prop(), INDEX, TODAY).price_basis.approxArea, false);
});

// ---- resolveComplex: import-listings.py 의 3단계 매칭 규칙 ----

test('resolveComplex: exact normalized match wins (whitespace and 아파트 suffix stripped)', () => {
  const entry = resolveComplex(' 삼천리1  아파트 ', '강원특별자치도 원주시', INDEX2);
  assert.ok(entry);
  assert.equal(entry.rows[0].median_price, 300000000);
  assert.equal(entry.orig, '삼천리1');
});

test('resolveComplex tier 2: norm2 match finds a parenthesized CSV name', () => {
  // CSV complex 는 "한신더휴(1차)" — 매물 제목엔 괄호가 없다
  const entry = resolveComplex('한신더휴', '강원특별자치도 원주시', INDEX2);
  assert.ok(entry);
  assert.equal(entry.rows[0].median_price, 410000000);
  assert.equal(entry.orig, '한신더휴(1차)');
});

test('resolveComplex tier 3: substring containment, listing name longer than CSV complex', () => {
  const entry = resolveComplex('두산위브&수자인부평더퍼스트', '인천광역시 부평구', INDEX2);
  assert.ok(entry);
  assert.equal(entry.rows[0].median_price, 350000000);
  assert.equal(entry.orig, '두산위브');
});

test('resolveComplex tier 3: substring containment, CSV complex longer than listing name', () => {
  const entry = resolveComplex('서초리시온', '강원특별자치도 원주시', INDEX2);
  assert.ok(entry);
  assert.equal(entry.rows[0].median_price, 900000000);
  assert.equal(entry.orig, '대림서초리시온');
});

test('resolveComplex refuses an ambiguous fragment matching two complexes', () => {
  // "현대타운" 은 "현대타운1차" 와 "현대타운2차" 양쪽에 모두 부분포함된다
  assert.equal(resolveComplex('현대타운', '강원특별자치도 원주시', INDEX2), null);
});

test('resolveComplex: short names do not trigger the fuzzy tiers even with substring hits', () => {
  // "타운" 은 "현대타운1차"/"현대타운2차" 양쪽의 부분문자열이지만 len(n2) < 3 이라 가드에 걸린다
  assert.equal(resolveComplex('타운', '강원특별자치도 원주시', INDEX2), null);
});

test('resolveComplex never matches across a different gu', () => {
  assert.ok(resolveComplex('두산위브', '인천광역시 부평구', INDEX2));
  assert.equal(resolveComplex('두산위브', '강원특별자치도 원주시', INDEX2), null);
});

test('recomputeBasis end-to-end: succeeds for a listing that only resolves via tier 3', () => {
  const listing = {
    id: 'gm-y',
    region: '인천광역시 부평구',
    title: '두산위브&수자인부평더퍼스트 전용84㎡ 매물',
    price: 300000000,
    area: 84,
    price_basis: {},
  };
  const out = recomputeBasis(listing, INDEX2, TODAY);
  assert.ok(out);
  assert.equal(out.actual_transaction_price, 350000000);
  assert.equal(out.discount_rate, 14.3);
});

// ---- 증거 필드(표A/표B/시세추이/urgent_score/recent_transaction_date) ----
// import-listings.py 의 area_summary / recent_trades / real_history / _median 포팅 검증.

const trade = (a, ym, d, fl, p) => ({ a, ym, d, fl, p });

test('areaSummary: rows carry the full shape, sorted by area ascending, isMine only for my area', () => {
  const trades = [
    trade(59, '2026-01', '5', '3', 200000000),
    trade(59, '2026-03', '10', '5', 210000000),
    trade(84, '2025-12', '20', '7', 400000000),
    trade(84, '2026-02', '1', '9', 420000000),
    trade(84, '2026-02', '15', '2', 415000000),
  ];
  const out = areaSummary(trades, 84);
  assert.equal(out.length, 2);
  // 면적 오름차순
  assert.deepEqual(out.map((r) => r.areaM2), [59, 84]);

  const other = out[0];
  assert.equal(other.areaM2, 59);
  assert.equal(other.count, 2);
  assert.equal(other.recentPrice, 210000000);
  assert.equal(other.recentMonth, '2026-03');
  assert.equal(other.minPrice, 200000000);
  assert.equal(other.maxPrice, 210000000);
  assert.equal(other.isMine, false);

  const mine = out[1];
  assert.equal(mine.areaM2, 84);
  assert.equal(mine.count, 3);
  // (ym, day) 오름차순 정렬 후 마지막 = 가장 최근: 2026-02 안에서 day '1' < '15' (문자열 비교)
  assert.equal(mine.recentPrice, 415000000);
  assert.equal(mine.recentMonth, '2026-02');
  assert.equal(mine.minPrice, 400000000);
  assert.equal(mine.maxPrice, 420000000);
  assert.equal(mine.isMine, true);
});

test('recentTrades: only the listing area, newest first, capped at 30', () => {
  const mixed = [
    trade(59, '2026-07', '1', '1', 999),
    trade(84, '2025-12', '20', '7', 400000000),
    trade(84, '2026-02', '1', '9', 420000000),
    trade(84, '2026-02', '15', '2', 415000000),
  ];
  const out = recentTrades(mixed, 84, 30);
  assert.equal(out.length, 3);
  assert.ok(out.every((r) => r.areaM2 === 84));
  assert.deepEqual(out.map((r) => `${r.yearMonth}-${r.day}`), ['2026-02-15', '2026-02-1', '2025-12-20']);

  // cap: 35건 중 최신 30건만
  const many = [];
  for (let i = 0; i < 35; i += 1) {
    const year = 2020 + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, '0');
    many.push(trade(84, `${year}-${month}`, '1', '1', i));
  }
  const capped = recentTrades(many, 84, 30);
  assert.equal(capped.length, 30);
  assert.equal(capped[0].price, 34); // 가장 최신(마지막으로 생성한 항목)이 맨 앞
});

test('realHistory: one entry per month, integer median, ascending month order, ym[2:] 포맷', () => {
  const trades = [
    trade(59, '2026-05', '1', '1', 100),
    trade(59, '2026-05', '2', '2', 300),
    trade(59, '2026-06', '10', '3', 500),
    trade(59, '2026-07', '4', '1', 200),
    trade(59, '2026-07', '15', '2', 220),
    trade(59, '2026-07', '9', '3', 210),
    trade(84, '2026-07', '1', '1', 999999), // 다른 평형 — 제외되어야 함
  ];
  const out = realHistory(trades, 59);
  assert.deepEqual(out, [
    { month: '26.05', yearMonth: '2026-05', price: 200, count: 2 },
    { month: '26.06', yearMonth: '2026-06', price: 500, count: 1 },
    { month: '26.07', yearMonth: '2026-07', price: 210, count: 3 },
  ]);
});

test('median: even-count floors rather than averaging to a fraction', () => {
  assert.equal(median([1, 2, 3, 4]), 2); // floor((2+3)/2) = floor(2.5) = 2
  assert.equal(median([100000000, 300000001]), 200000000); // floor(400000001/2) = 200000000
});

test('median: odd-count picks the middle element', () => {
  assert.equal(median([5, 1, 9]), 5);
});

test('urgent_score matches min(99, round(50 + disc*3)), including the 99 cap', () => {
  // 20% 할인 → 50+60=110 → 99 로 캡
  assert.equal(recomputeBasis(prop(), INDEX, TODAY).urgent_score, 99);
  // 5% 할인(MIN_DISC 경계) → 50+15=65, 캡 아래
  assert.equal(recomputeBasis(prop({ price: 380000000 }), INDEX, TODAY).urgent_score, 65);
});

test('recent_transaction_date equals price_basis.periodEnd + "-01"', () => {
  const out = recomputeBasis(prop(), INDEX, TODAY);
  assert.equal(out.recent_transaction_date, `${out.price_basis.periodEnd}-01`);
  assert.equal(out.recent_transaction_date, '2026-07-01');
});

test('recomputeBasis: no trades for the resolved complex yields empty evidence arrays, not a throw', () => {
  const out = recomputeBasis(prop(), INDEX, TODAY); // tradesIndex 인자 생략 → 기본 빈 Map
  assert.deepEqual(out.price_history, []);
  assert.deepEqual(out.price_table.areaSummary, []);
  assert.deepEqual(out.price_table.recentTrades, []);
});

// ---- consistency invariant: 이번 결함의 재발 방지 테스트 ----
// price_basis.sampleSize(중앙값 산정 근거 건수)와 표A(areaSummary) 의 내 평형 count 는
// 반드시 같아야 한다 — 다르면 화면 위에서 주장과 증거가 어긋난다(이번 결함의 정의 그 자체).

const EVIDENCE_CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '증거아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,59,60㎡ 이하,300000000,3,2026-05,2026-07,2010',
].join('\n');
const EVIDENCE_INDEX = buildComplexIndex(EVIDENCE_CSV);

const EVIDENCE_TRADES_CSV = [
  'complex,gu,area_m2,year_month,day,floor,price',
  '증거아파트,강원특별자치도 원주시,59,2026-05,3,4,280000000',
  '증거아파트,강원특별자치도 원주시,59,2026-06,10,5,290000000',
  '증거아파트,강원특별자치도 원주시,59,2026-07,1,6,300000000',
].join('\n');

const evidenceProp = {
  id: 'gm-evidence', region: '강원특별자치도 원주시', title: '증거아파트 전용59㎡',
  price: 270000000, area: 59, price_basis: {},
};

test('consistency invariant: areaSummary isMine count equals price_basis.sampleSize', () => {
  const needed = new Set([makeTradeKey('강원특별자치도 원주시', '증거아파트')]);
  const tradesIndex = buildTradesIndex(EVIDENCE_TRADES_CSV, needed);
  const out = recomputeBasis(evidenceProp, EVIDENCE_INDEX, TODAY, tradesIndex);
  assert.ok(out);
  const mine = out.price_table.areaSummary.find((r) => r.isMine);
  assert.ok(mine);
  assert.equal(mine.count, out.price_basis.sampleSize);
  assert.equal(mine.count, 3);
});

// ---- confidence: import-listings.py:build_row 와 동일하게 >= 5 에서 high ----

const CONFIDENCE_CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '확신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,59,60㎡ 이하,300000000,5,2023-01,2026-07,2010',
  '확신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,84,60–85㎡,400000000,4,2023-01,2026-07,2010',
].join('\n');
const CONFIDENCE_INDEX = buildComplexIndex(CONFIDENCE_CSV);

test('confidence is high at sample_size === 5 and medium at 4', () => {
  const high = recomputeBasis(
    { id: 'gm-c1', region: '강원특별자치도 원주시', title: '확신아파트 전용59㎡', price: 270000000, area: 59, price_basis: {} },
    CONFIDENCE_INDEX, TODAY,
  );
  assert.equal(high.price_basis.confidence, 'high');

  const medium = recomputeBasis(
    { id: 'gm-c2', region: '강원특별자치도 원주시', title: '확신아파트 전용84㎡', price: 360000000, area: 84, price_basis: {} },
    CONFIDENCE_INDEX, TODAY,
  );
  assert.equal(medium.price_basis.confidence, 'medium');
});

// ---- buildTradesIndex: complex_trades.csv 의 콤마 포함 단지명("대동1,2차")을 깨지 않고 파싱 ----

test('buildTradesIndex parses quoted complex names containing commas, and filters by needed pairs', () => {
  const csv = [
    'complex,gu,area_m2,year_month,day,floor,price',
    '"대동1,2차",강원특별자치도 동해시,73,2023-07,25,12,117000000',
    '무관한단지,강원특별자치도 동해시,59,2023-07,1,1,50000000',
  ].join('\n');
  const key = makeTradeKey('강원특별자치도 동해시', '대동1,2차');
  const idx = buildTradesIndex(csv, new Set([key]));
  assert.equal(idx.size, 1);
  const rows = idx.get(key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].a, 73);
  assert.equal(rows[0].p, 117000000);
  assert.equal(rows[0].ym, '2023-07');
});
