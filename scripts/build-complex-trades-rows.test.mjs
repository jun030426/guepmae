import test from 'node:test';
import assert from 'node:assert/strict';
import { compactDealing, groupTradeRows, selectBundleRows } from './build-complex-trades-rows.mjs';

const CSV = [
  'complex,gu,area_m2,year_month,day,floor,price,dealing',
  '"대동1,2차",강원특별자치도 동해시,73,2023-07,25,12,117000000,brokered',
  '"대동1,2차",강원특별자치도 동해시,73,2026-03,3,5,125000000,direct',
  '"대동1,2차",강원특별자치도 동해시,73,2026-01,15,,120000000,',
  '"대동1,2차",강원특별자치도 동해시,59,2026-02,1,3,90000000,brokered',
  '무관한단지,인천광역시 부평구,84,2026-02,1,1,50000000,brokered',
  'bad,row',
].join('\n');

test('groupTradeRows — (단지, 구, 면적) 단위로 묶고 압축 배열·요약 필드를 만든다', () => {
  const rows = groupTradeRows(CSV);
  assert.equal(rows.length, 3);
  const r73 = rows.find((r) => r.complex === '대동1,2차' && r.area_m2 === 73);
  assert.equal(r73.sample_size, 3);
  assert.equal(r73.latest_year_month, '2026-03');
  assert.equal(r73.max_floor, 12);
  // 계약월 오름차순, 층 없음은 null, 거래유형은 b/d/''
  assert.deepEqual(r73.trades, [
    ['2023-07', '25', 117000000, 12, 'b'],
    ['2026-01', '15', 120000000, null, ''],
    ['2026-03', '3', 125000000, 5, 'd'],
  ]);
});

test('groupTradeRows — 7열(거래유형 없는 옛 CSV)도 읽는다', () => {
  const rows = groupTradeRows(['complex,gu,area_m2,year_month,day,floor,price', 'A,서울특별시 중구,84,2026-01,1,3,500000000'].join('\n'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].trades[0], ['2026-01', '1', 500000000, 3, '']);
});

test('compactDealing', () => {
  assert.equal(compactDealing('direct'), 'd');
  assert.equal(compactDealing('직거래'), 'd');
  assert.equal(compactDealing('brokered'), 'b');
  assert.equal(compactDealing('중개거래'), 'b');
  assert.equal(compactDealing(''), '');
  assert.equal(compactDealing('기타'), '');
});

test('selectBundleRows — complex_prices 번들과 같은 키만 남긴다', () => {
  const rows = groupTradeRows(CSV);
  const bundle = selectBundleRows(rows, [{ complex: '대동1,2차', gu: '강원특별자치도 동해시', area_m2: 73 }]);
  assert.equal(bundle.length, 1);
  assert.equal(bundle[0].area_m2, 73);
});
