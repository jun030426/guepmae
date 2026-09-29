import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRows, parseArgs, prunedIds } from './load-bundles-to-supabase.mjs';

// PostgREST 흉내 — 요청을 기록하고 행 수 헤더만 돌려준다
function fakeRequest(total = 5) {
  const calls = [];
  const request = async (method, pathname, body, extra = {}) => {
    calls.push({ method, pathname, body, prefer: extra.Prefer });
    return { headers: { get: (name) => (name === 'content-range' ? `0-0/${total}` : null) } };
  };
  return { calls, request };
}
const quiet = () => {};
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

test('prunedIds — 이전 번들에만 있던 id 만', () => {
  const previous = [{ id: 'gm-a' }, { id: 'gm-b' }, { id: 'gm-c' }];
  const next = [{ id: 'gm-a' }, { id: 'gm-c' }, { id: 'gm-new' }];
  assert.deepEqual(prunedIds(previous, next), ['gm-b']);
  assert.deepEqual(prunedIds(previous, previous), []);
  assert.deepEqual(prunedIds([], next), []);
  assert.deepEqual(prunedIds(null, next), []);
  assert.deepEqual(prunedIds([{ id: '' }, {}, { id: 'gm-x' }], []), ['gm-x']);
});

test('parseArgs — 정상 조합', () => {
  assert.deepEqual(parseArgs(['complex_trades', '--upsert']),
    { only: 'complex_trades', upsert: true, replaceAll: false, pruneAgainst: null });
  assert.deepEqual(parseArgs(['properties', '--upsert', '--prune-against', 'scripts/output/properties.prev.json']),
    { only: 'properties', upsert: true, replaceAll: false, pruneAgainst: 'scripts/output/properties.prev.json' });
  assert.deepEqual(parseArgs(['--prune-against', '/tmp/prev.json', '--upsert', 'properties']),
    { only: 'properties', upsert: true, replaceAll: false, pruneAgainst: '/tmp/prev.json' });
  assert.deepEqual(parseArgs(['complex_prices']),
    { only: 'complex_prices', upsert: false, replaceAll: false, pruneAgainst: null });
  assert.deepEqual(parseArgs(['--replace-all']),
    { only: null, upsert: false, replaceAll: true, pruneAgainst: null });
  assert.deepEqual(parseArgs(['--upsert']),
    { only: null, upsert: true, replaceAll: false, pruneAgainst: null });
});

test('parseArgs — 위험하거나 모순된 조합은 거부', () => {
  assert.throws(() => parseArgs(['propertiez', '--upsert']), /알 수 없는 테이블/);
  assert.throws(() => parseArgs(['properties', '--upsrt']), /알 수 없는 옵션/);
  assert.throws(() => parseArgs(['properties', 'complex_prices']), /하나만/);
  assert.throws(() => parseArgs(['properties', '--upsert', '--prune-against']), /경로가 필요/);
  assert.throws(() => parseArgs(['properties', '--prune-against', '--upsert']), /경로가 필요/);
  assert.throws(() => parseArgs(['properties', '--prune-against', 'prev.json']), /--upsert 와 함께/);
  assert.throws(() => parseArgs(['complex_trades', '--upsert', '--prune-against', 'prev.json']), /properties 에서만/);
  assert.throws(() => parseArgs(['--upsert', '--prune-against', 'prev.json']), /properties 에서만/);
  assert.throws(() => parseArgs(['complex_prices', '--upsert']), /지원하지 않습니다/);
  assert.throws(() => parseArgs(['properties', '--upsert', '--replace-all']), /함께 쓸 수 없습니다/);
});

test('loadRows — properties 는 옵션 없이 통째로 교체하지 않는다 (요청 0건)', async () => {
  const { calls, request } = fakeRequest();
  await assert.rejects(
    loadRows('properties', [{ id: 'gm-a' }], { request, log: quiet }),
    /통째로 교체하지 않습니다/,
  );
  assert.equal(calls.length, 0);
});

test('loadRows — 빈 번들은 어느 테이블에도 적재하지 않는다 (요청 0건)', async () => {
  const { calls, request } = fakeRequest();
  await assert.rejects(loadRows('complex_prices', [], { request, log: quiet }), /적재할 행이 없습니다/);
  await assert.rejects(loadRows('properties', [], { upsert: true, request, log: quiet }), /적재할 행이 없습니다/);
  await assert.rejects(loadRows('properties', null, { replaceAll: true, request, log: quiet }), /적재할 행이 없습니다/);
  assert.equal(calls.length, 0);
});

test('loadRows — upsert 는 지우지 않고 on_conflict 로 보낸다', async () => {
  const { calls, request } = fakeRequest();
  const rows = [{ id: 'gm-a' }, { id: 'gm-b' }];
  const result = await loadRows('properties', rows, { upsert: true, request, log: quiet });
  assert.deepEqual(result, { mode: 'upsert', sent: 2, pruned: 0 });
  assert.deepEqual(writes(calls), [
    { method: 'POST', pathname: 'properties?on_conflict=id', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' },
  ]);
});

test('loadRows — upsert + 이전 번들: 빠진 id 만 지운다', async () => {
  const { calls, request } = fakeRequest();
  const previous = [{ id: 'gm-a' }, { id: 'gm-b' }, { id: 'gm-c' }];
  const rows = [{ id: 'gm-a' }];
  const result = await loadRows('properties', rows, { upsert: true, previousRows: previous, request, log: quiet });
  assert.equal(result.pruned, 2);
  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.equal(deletes.length, 1);
  assert.equal(decodeURIComponent(deletes[0].pathname), 'properties?id=in.("gm-b","gm-c")');
  // 전체 삭제 필터는 어디에도 없다
  assert.ok(calls.every((c) => !c.pathname.includes('neq.__none__')));
});

test('loadRows — 탈락이 100건을 넘으면 나눠서 지운다', async () => {
  const { calls, request } = fakeRequest();
  const previous = Array.from({ length: 251 }, (_, i) => ({ id: `gm-${i}` }));
  const result = await loadRows('properties', [{ id: 'gm-0' }], { upsert: true, previousRows: previous, request, log: quiet });
  assert.equal(result.pruned, 250);
  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.deepEqual(deletes.map((d) => decodeURIComponent(d.pathname).split(',').length), [100, 100, 50]);
});

test('loadRows — complex_trades 는 200행씩 upsert', async () => {
  const { calls, request } = fakeRequest();
  const rows = Array.from({ length: 450 }, (_, i) => ({ complex: `단지${i}`, gu: '서울특별시 강남구', area_m2: 84 }));
  const result = await loadRows('complex_trades', rows, { upsert: true, request, log: quiet });
  assert.equal(result.sent, 450);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((p) => p.body.length), [200, 200, 50]);
  assert.ok(posts.every((p) => p.pathname === 'complex_trades?on_conflict=complex,gu,area_m2'));
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
});

test('loadRows — 복제본 테이블은 전체 교체 (삭제 후 삽입), --upsert 가 와도 교체', async () => {
  for (const upsert of [false, true]) {
    const { calls, request } = fakeRequest();
    const result = await loadRows('complex_prices', [{ complex: 'a' }], { upsert, request, log: quiet });
    assert.equal(result.mode, 'replace');
    assert.deepEqual(writes(calls).map((c) => [c.method, c.pathname]), [
      ['DELETE', 'complex_prices?id=gte.0'],
      ['POST', 'complex_prices'],
    ]);
  }
});

test('loadRows — --replace-all 이면 properties 도 전체 교체 (빈 DB 초기 세팅)', async () => {
  const { calls, request } = fakeRequest();
  const result = await loadRows('properties', [{ id: 'gm-a' }], { replaceAll: true, request, log: quiet });
  assert.equal(result.mode, 'replace');
  assert.deepEqual(writes(calls).map((c) => [c.method, c.pathname]), [
    ['DELETE', 'properties?id=neq.__none__'],
    ['POST', 'properties'],
  ]);
});
