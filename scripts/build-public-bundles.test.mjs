import test from 'node:test';
import assert from 'node:assert/strict';
import { topComplexRows, buildMarketSnapshots } from './build-public-bundles.mjs';

const CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '가단지,서울특별시 중구 신당동,서울특별시 중구,84,60–85㎡,900000000,12,2023-07,2026-07,2005',
  '나단지,경기도 성남시 분당구 정자동,경기도 성남시 분당구,59,60㎡ 이하,700000000,40,2023-08,2026-06,2011',
  '다단지,인천광역시 연수구 송도동,인천광역시 연수구,101,85–102㎡,800000000,25,2024-01,2026-07,',
].join('\n');

test('topComplexRows sorts by sample_size descending', () => {
  const rows = topComplexRows(CSV);
  assert.deepEqual(rows.map((r) => r.complex), ['나단지', '다단지', '가단지']);
});

test('topComplexRows respects the limit', () => {
  assert.equal(topComplexRows(CSV, 2).length, 2);
});

test('topComplexRows coerces numeric fields', () => {
  const [first] = topComplexRows(CSV);
  assert.equal(first.sample_size, 40);
  assert.equal(first.median_price, 700000000);
  assert.equal(first.area_m2, 59);
  assert.equal(first.built_year, 2011);
});

test('topComplexRows maps a blank built_year to null', () => {
  const row = topComplexRows(CSV).find((r) => r.complex === '다단지');
  assert.equal(row.built_year, null);
});

test('topComplexRows preserves the area_bucket en-dash label', () => {
  const row = topComplexRows(CSV).find((r) => r.complex === '가단지');
  assert.equal(row.area_bucket, '60–85㎡');
});

test('buildMarketSnapshots remaps marketData keys', () => {
  const snapshots = buildMarketSnapshots({
    regionalSnapshots: [{ region: '경기' }],
    monthlyMarketTrend: [{ month: '2026-07' }],
    areaTypeBreakdown: [{ bucket: '60㎡ 이하' }],
    topUrgentComplexes: [{ complex: '가단지' }],
    marketInsights: [{ title: 'x' }],
    dataSource: { lastUpdated: '2026-08-27', months: ['2026-07'] },
  });
  assert.deepEqual(snapshots.regional, [{ region: '경기' }]);
  assert.deepEqual(snapshots.monthly, [{ month: '2026-07' }]);
  assert.deepEqual(snapshots.area_type, [{ bucket: '60㎡ 이하' }]);
  assert.deepEqual(snapshots.top_urgent, [{ complex: '가단지' }]);
  assert.deepEqual(snapshots.insights, [{ title: 'x' }]);
  assert.equal(snapshots.metadata.lastUpdated, '2026-08-27');
});

test('buildMarketSnapshots defaults missing keys to empty collections', () => {
  const snapshots = buildMarketSnapshots({});
  assert.deepEqual(snapshots.regional, []);
  assert.deepEqual(snapshots.monthly, []);
  assert.deepEqual(snapshots.area_type, []);
  assert.deepEqual(snapshots.top_urgent, []);
  assert.deepEqual(snapshots.insights, []);
  assert.deepEqual(snapshots.metadata, {});
});
