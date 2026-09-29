import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertKey,
  clampMinDiscount,
  complexOf,
  isValidEmail,
  matchAlerts,
  newUnsubscribeToken,
  normalizeEmail,
  summarizeAlerts,
} from './alertMatch.js';

test('normalizeEmail / isValidEmail', () => {
  assert.equal(normalizeEmail('  Buyer@Example.COM '), 'buyer@example.com');
  assert.equal(isValidEmail('buyer@example.com'), true);
  assert.equal(isValidEmail('a@b.c'), true);
  assert.equal(isValidEmail('no-at-sign.com'), false);
  assert.equal(isValidEmail('two words@example.com'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(`${'a'.repeat(250)}@example.com`), false);
});

test('alertKey — 평형 미지정은 all, 이메일 대소문자 무시', () => {
  assert.equal(alertKey({ email: 'A@B.com', complex: '두산위브', gu: '인천광역시 부평구', areaM2: 59.9 }), 'a@b.com|인천광역시 부평구|두산위브|59');
  assert.equal(alertKey({ email: 'a@b.com', complex: '두산위브', gu: '인천광역시 부평구', areaM2: null }), 'a@b.com|인천광역시 부평구|두산위브|all');
});

test('complexOf — 수집 매물은 priceTable.complexName + region, 등록 매물은 priceBasis', () => {
  assert.deepEqual(
    complexOf({ region: '인천광역시 부평구', priceTable: { complexName: '두산위브' }, priceBasis: {} }),
    { complex: '두산위브', gu: '인천광역시 부평구' },
  );
  assert.deepEqual(
    complexOf({ region: '경기도 고양시 덕양구 향동동', priceBasis: { complexName: 'DMC두산위브더퍼스트', gu: '경기도 고양시 덕양구' } }),
    { complex: 'DMC두산위브더퍼스트', gu: '경기도 고양시 덕양구' },
  );
  assert.equal(complexOf({ region: '서울특별시 중구', priceBasis: {} }), null);
  assert.equal(complexOf(null), null);
});

test('clampMinDiscount — 5~40 범위', () => {
  assert.equal(clampMinDiscount(3), 5);
  assert.equal(clampMinDiscount(12.5), 12.5);
  assert.equal(clampMinDiscount(90), 40);
  assert.equal(clampMinDiscount('x'), 5);
});

const listing = (over = {}) => ({
  id: 'gm-1', region: '인천광역시 부평구', area: 59.9, verified: true, discountRate: 12,
  priceTable: { complexName: '두산위브' }, priceBasis: {}, ...over,
});
const alert = (over = {}) => ({ email: 'a@b.com', complex: '두산위브', gu: '인천광역시 부평구', area_m2: null, min_discount: 5, status: 'active', ...over });

test('matchAlerts — 같은 단지·구, 평형 조건, 최소 할인율', () => {
  const alerts = [
    alert({ email: 'all@x.com' }),
    alert({ email: 'a59@x.com', area_m2: 59 }),
    alert({ email: 'a84@x.com', area_m2: 84 }),
    alert({ email: 'deep@x.com', min_discount: 15 }),
    alert({ email: 'other@x.com', complex: '다른단지' }),
    alert({ email: 'othergu@x.com', gu: '인천광역시 계양구' }),
    alert({ email: 'off@x.com', status: 'unsubscribed' }),
  ];
  assert.deepEqual(matchAlerts(listing(), alerts).map((a) => a.email), ['all@x.com', 'a59@x.com']);
  assert.deepEqual(matchAlerts(listing({ discountRate: 20 }), alerts).map((a) => a.email), ['all@x.com', 'a59@x.com', 'deep@x.com']);
});

test('matchAlerts — 미검증·판정 보류·단지 미상 매물은 알리지 않는다', () => {
  const alerts = [alert()];
  assert.deepEqual(matchAlerts(listing({ verified: false }), alerts), []);
  assert.deepEqual(matchAlerts(listing({ discountRate: null }), alerts), []);
  assert.deepEqual(matchAlerts(listing({ priceTable: {}, priceBasis: {} }), alerts), []);
  assert.deepEqual(matchAlerts(listing({ discountRate: 4.9 }), alerts), []);
});

test('newUnsubscribeToken — UUID v4 형식, 매번 다름', () => {
  const a = newUnsubscribeToken();
  const b = newUnsubscribeToken();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test('summarizeAlerts — 활성만 세고 단지별 상위 정렬', () => {
  const summary = summarizeAlerts([
    alert({ email: '1@x.com' }), alert({ email: '2@x.com' }), alert({ email: '3@x.com', status: 'unsubscribed' }),
    alert({ email: '4@x.com', complex: '삼천리1차', gu: '강원특별자치도 원주시' }),
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.complexes, 2);
  assert.deepEqual(summary.top[0], { complex: '두산위브', gu: '인천광역시 부평구', count: 2 });
});
