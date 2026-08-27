import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComplex, buildComplexIndex, recomputeBasis } from './recompute-price-basis.mjs';

const CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '한신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,84,60–85㎡,400000000,30,2023-07,2026-07,2015',
  '한신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,59,60㎡ 이하,300000000,2,2023-07,2026-07,2015',
].join('\n');

const INDEX = buildComplexIndex(CSV);
const TODAY = '2026-08-27';

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
  assert.ok(INDEX.has('강원특별자치도 원주시|한신'));
  assert.equal(INDEX.get('강원특별자치도 원주시|한신').length, 2);
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
