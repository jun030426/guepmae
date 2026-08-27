import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeComplex,
  buildComplexIndex,
  resolveComplex,
  recomputeBasis,
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
  const rows = resolveComplex(' 삼천리1  아파트 ', '강원특별자치도 원주시', INDEX2);
  assert.ok(rows);
  assert.equal(rows[0].median_price, 300000000);
});

test('resolveComplex tier 2: norm2 match finds a parenthesized CSV name', () => {
  // CSV complex 는 "한신더휴(1차)" — 매물 제목엔 괄호가 없다
  const rows = resolveComplex('한신더휴', '강원특별자치도 원주시', INDEX2);
  assert.ok(rows);
  assert.equal(rows[0].median_price, 410000000);
});

test('resolveComplex tier 3: substring containment, listing name longer than CSV complex', () => {
  const rows = resolveComplex('두산위브&수자인부평더퍼스트', '인천광역시 부평구', INDEX2);
  assert.ok(rows);
  assert.equal(rows[0].median_price, 350000000);
});

test('resolveComplex tier 3: substring containment, CSV complex longer than listing name', () => {
  const rows = resolveComplex('서초리시온', '강원특별자치도 원주시', INDEX2);
  assert.ok(rows);
  assert.equal(rows[0].median_price, 900000000);
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
