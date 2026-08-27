import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCapitalTargets } from './build-crawl-targets.mjs';

const CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '가단지,서울특별시 중구 신당동,서울특별시 중구,84,60–85㎡,900000000,25,2023-07,2026-07,2005',
  '가단지,서울특별시 중구 신당동,서울특별시 중구,59,60㎡ 이하,700000000,8,2023-07,2026-07,2005',
  '나단지,경기도 성남시 분당구 정자동,경기도 성남시 분당구,59,60㎡ 이하,700000000,40,2023-08,2026-06,2011',
  '다단지,인천광역시 연수구 송도동,인천광역시 연수구,101,85–102㎡,800000000,19,2024-01,2026-07,2018',
  '라단지,강원특별자치도 원주시 무실동,강원특별자치도 원주시,84,60–85㎡,300000000,90,2023-07,2026-07,2015',
].join('\n');

test('keeps only capital-region complexes', () => {
  const gus = pickCapitalTargets(CSV).map((t) => t.gu);
  assert.ok(!gus.some((g) => g.startsWith('강원')));
});

test('drops complexes whose max sample_size is below the threshold', () => {
  // 다단지 최댓값 19 < 20
  assert.deepEqual(pickCapitalTargets(CSV).map((t) => t.complex), ['나단지', '가단지']);
});

test('keeps a complex when any one area row clears the threshold', () => {
  // 가단지는 84㎡ 가 25 라 살아남는다 (59㎡ 는 8)
  const target = pickCapitalTargets(CSV).find((t) => t.complex === '가단지');
  assert.equal(target.max_sample, 25);
});

test('collects every area of a kept complex, sorted ascending', () => {
  const target = pickCapitalTargets(CSV).find((t) => t.complex === '가단지');
  assert.deepEqual(target.areas, [59, 84]);
});

test('sorts targets by max_sample descending', () => {
  const samples = pickCapitalTargets(CSV).map((t) => t.max_sample);
  assert.deepEqual(samples, [...samples].sort((a, b) => b - a));
});

test('honours a custom threshold', () => {
  assert.equal(pickCapitalTargets(CSV, 19).length, 3);
});

test('separates same-named complexes in different gu', () => {
  const dup = [
    'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
    '한신,서울특별시 중구 신당동,서울특별시 중구,84,60–85㎡,900000000,25,2023-07,2026-07,2005',
    '한신,경기도 수원시 팔달구 인계동,경기도 수원시 팔달구,84,60–85㎡,500000000,30,2023-07,2026-07,2001',
  ].join('\n');
  assert.equal(pickCapitalTargets(dup).length, 2);
});
