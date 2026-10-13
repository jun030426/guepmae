import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { aggregate, buildPeerMedians, normalizeRow, parseRows, decodeCsvBody } from './import-trades-csv.mjs';
import { peerKey } from './lib/marketAggregation.mjs';
import { buildMarketSnapshots } from './build-public-bundles.mjs';
import { prepareMarketSnapshot, isCurrentMarketReport, regionCategories, selectTopComplexes } from '../src/utils/marketReportModel.js';
import { buildUserPrompt, buildReportRow } from './generate-market-report.mjs';

const trade = (overrides = {}) => ({ region: '서울', sigungu: '서울특별시 강남구 역삼동', complex: '동명아파트',
  area: 84.91, dealAmount: 100e6, yearMonth: '2026-09', buildYear: 2000, dealing: '중개거래', ...overrides });
const copies = (n, overrides) => Array.from({ length: n }, () => trade(overrides));
const snapshot = () => buildMarketSnapshots(aggregate([...copies(2), trade({ dealAmount: 90e6 })]));

test('same-name complexes in different regions, dong, lots and IDs never share a median', () => {
  for (const difference of [
    { sigungu: '부산광역시 해운대구 우동', region: '부산' },
    { sigungu: '서울특별시 강남구 개포동' }, { lot: '101' }, { complexCode: '11680-111' }, { buildYear: 2010 },
  ]) {
    const rows = [...copies(3), ...copies(3, { ...difference, dealAmount: 500e6 })];
    const medians = buildPeerMedians(rows);
    assert.equal(medians.size, 2);
    assert.equal(medians.get(peerKey(rows[0])), 100e6);
    assert.equal(medians.get(peerKey(rows[3])), 500e6);
    assert.equal(aggregate(rows).monthlyMarketTrend.at(-1).urgentCount, 0);
  }
});

test('exact decimal area separates peers even inside the same display bucket', () => {
  const rows = [...copies(3), ...copies(3, { area: 84.99, dealAmount: 500e6 })];
  assert.equal(buildPeerMedians(rows).size, 2);
  assert.equal(aggregate(rows).areaTypeBreakdown.length, 1);
  assert.equal(aggregate(rows).monthlyMarketTrend.at(-1).urgentCount, 0);
});

test('calendar window, all charts and baselines use the same 12 months', () => {
  const result = aggregate([...copies(3, { yearMonth: '2025-09', dealAmount: 900e6 }),
    trade({ yearMonth: '2025-10' }), ...copies(2), trade({ yearMonth: '2026-10', dealAmount: 900e6 })], { asOf: '2026-09' });
  assert.deepEqual(result.dataSource.reportPeriod, { start: '2025-10', end: '2026-09', months: 12 });
  assert.equal(result.monthlyMarketTrend.length, 12);
  assert.equal(result.monthlyMarketTrend[1].transactionVolume, 0);
  assert.equal(result.dataSource.totalRows, 3);
  assert.equal(result.dataSource.excluded.outsideWindow, 4);
  assert.equal(result.fullPeriod.transactionVolume, 7);
  for (const key of ['monthlyMarketTrend', 'regionalSnapshots', 'areaTypeBreakdown']) {
    assert.equal(result[key].reduce((s, r) => s + r.transactionVolume, 0), 3);
    assert.equal(result[key].reduce((s, r) => s + r.urgentCount, 0), 0);
  }
  assert.equal(prepareMarketSnapshot(buildMarketSnapshots(result)).metadata.status, 'ready');
});

test('cancellations, direct trades and invalid rows cannot move the baseline', () => {
  const result = aggregate([...copies(3), trade({ canceled: true, dealAmount: 1000e6 }),
    trade({ dealing: '직거래', dealAmount: 1000e6 }), null, trade({ area: 0 })]);
  assert.deepEqual(result.dataSource.excluded, { invalid: 2, canceled: 1, direct: 1, outsideWindow: 0 });
  assert.equal(result.dataSource.totalRows, 3);
  assert.equal(result.regionalSnapshots[0].urgentCount, 0);
});

test('unknown dealing remains explicit and insufficient samples are null, not zero discounts', () => {
  const result = aggregate([trade({ dealing: '' }), trade({ dealing: '' })]);
  assert.equal(result.dataSource.unknownDealingRows, 2);
  assert.equal(result.dataSource.unclassifiedRows, 2);
  assert.equal(result.regionalSnapshots[0].averageDiscount, null);
  assert.equal(result.regionalSnapshots[0].urgentCount, 0);
  assert.equal(regionCategories(result.regionalSnapshots).insufficient.length, 1);
  assert.throws(() => aggregate([trade({ canceled: true })]), /집계 가능한/);
});

test('5% threshold is inclusive; ratio uses every eligible trade as its denominator', () => {
  const result = aggregate([...copies(2), trade({ dealAmount: 95e6 }), trade({ complex: '표본부족' })]);
  assert.equal(result.regionalSnapshots[0].urgentCount, 1);
  assert.equal(result.regionalSnapshots[0].urgentRatio, 1 / 4);
  assert.equal(result.dataSource.comparableRows, 3);
});

test('top complexes exclude small samples before limiting and separate same-name regions', () => {
  const small = Array.from({ length: 11 }, (_, i) => ({ complexId: String(i), sampleSize: 5, urgentRatio: 0.9, dealCount: 4 }));
  assert.equal(selectTopComplexes([...small, { complexId: 'valid', sampleSize: 10, urgentRatio: 0.1, dealCount: 1 }])[0].complexId, 'valid');
  const rows = [...copies(9), trade({ dealAmount: 90e6 }), ...copies(9, { sigungu: '서울특별시 강남구 개포동' }),
    trade({ sigungu: '서울특별시 강남구 개포동', dealAmount: 90e6 })];
  const top = aggregate(rows).topUrgentComplexes;
  assert.equal(top.length, 2);
  assert.notEqual(top[0].complexId, top[1].complexId);
  assert.equal(top[0].sampleSize, 10);
});

test('UTF-8 BOM and CP949 national CSVs normalize names, prices, exact area, cancellation and IDs', () => {
  const csv = '시군구,법정동,단지명,거래금액(만원),계약년월,해제사유발생일,전용면적(㎡),거래유형,아파트일련번호,지번\n서울특별시 강남구,역삼동,테스트,"10,000",202609,-,84.91,중개거래,11680-1,1-1';
  for (const buffer of [Buffer.from('\ufeff' + csv), iconv.encode(csv, 'cp949')]) {
    const row = normalizeRow(parseRows(decodeCsvBody(buffer))[0]);
    assert.equal(row.sigungu, '서울특별시 강남구 역삼동');
    assert.equal(row.dealAmount, 100e6);
    assert.equal(row.area, 84.91);
    assert.equal(row.canceled, false);
    assert.equal(row.complexCode, '11680-1');
    assert.equal(row.lot, '1-1');
  }
  const row = parseRows(csv)[0];
  assert.equal(normalizeRow({ ...row, 해제사유발생일: '20260920' }).canceled, true);
  assert.equal(normalizeRow({ ...row, 해제여부: 'O' }).canceled, true);
  assert.equal(normalizeRow({ ...row, 계약년월: '202613' }), null);
});

test('legacy, mismatched totals and non-contiguous periods do not reach the UI or AI', () => {
  assert.equal(prepareMarketSnapshot({}).metadata.status, 'needs-rebuild');
  for (const mutate of [s => { s.metadata.aggregationVersion = 1; }, s => { s.regional[0].transactionVolume += 1; },
    s => { s.monthly[0].month = '2020-01'; }, s => { s.area_type[0].urgentCount += 1; }]) {
    const s = snapshot(); mutate(s);
    assert.equal(prepareMarketSnapshot(s).metadata.status, 'needs-rebuild');
    assert.throws(() => buildUserPrompt(s));
  }
});

test('AI uses the same selected rows and exact snapshot fingerprint; old reports stay hidden', () => {
  const s = snapshot();
  s.top_urgent = [{ complexId: 'small', complex: '제외되어야함', sampleSize: 5 }];
  const prompt = buildUserPrompt(s);
  assert.ok(prompt.includes('2025-10 ~ 2026-09 (12개월)'));
  assert.ok(!prompt.includes('제외되어야함'));
  const row = buildReportRow({ dataAsOf: '1900-01', insights: [] }, s, 'test');
  const metadata = prepareMarketSnapshot(s).metadata;
  assert.equal(row.data_as_of, '2026-09');
  assert.ok(isCurrentMarketReport(row, metadata));
  assert.equal(isCurrentMarketReport({ ...row, report_data: {} }, metadata), false);
  assert.equal(isCurrentMarketReport(row, { ...metadata, snapshotId: 'changed' }), false);
});

test('fingerprint changes for data corrections but not a later build time', () => {
  const rows = [...copies(2), trade({ dealAmount: 90e6 })];
  const a = aggregate(rows, { generatedAt: '2026-10-01T00:00:00Z' });
  const b = aggregate(rows, { generatedAt: '2026-10-02T00:00:00Z' });
  assert.equal(a.dataSource.snapshotId, b.dataSource.snapshotId);
  assert.notEqual(a.dataSource.snapshotId, aggregate([...copies(2), trade({ dealAmount: 80e6 })]).dataSource.snapshotId);
});
