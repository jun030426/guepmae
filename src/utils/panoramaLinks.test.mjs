import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLink,
  autoLinksAt,
  avoidOverlap,
  buildTourPanoramas,
  effectiveLinks,
  hasExplicitLinks,
  panoramaMediaItem,
  pruneLinks,
  removeLink,
  resetLinks,
} from './panoramaTour.js';

const points = () => [
  { id: 'a', label: '현관' },
  { id: 'b', label: '거실' },
  { id: 'c', label: '주방' },
  { id: 'd', label: '안방' },
];

test('autoLinksAt / effectiveLinks — 편집 전에는 순서 기반 앞·뒤', () => {
  const items = points();
  assert.deepEqual(autoLinksAt(items, 0).map((l) => l.to), ['b']);
  assert.deepEqual(effectiveLinks(items, 1).map((l) => `${l.to}@${l.yaw}`), ['c@0', 'a@180']);
  assert.equal(hasExplicitLinks(items[1]), false);
});

test('addLink — 처음 편집하면 자동 링크를 굳히고 새 갈래를 덧붙인다', () => {
  const next = addLink(points(), 'b', { to: 'd', yaw: 90, pitch: -5, targetYaw: 0 });
  const b = next.find((p) => p.id === 'b');
  assert.equal(b.linksExplicit, true);
  assert.deepEqual(b.links.map((l) => `${l.to}@${l.yaw}`), ['c@0', 'a@180', 'd@90']);
  assert.equal(b.links[2].label, '안방');
  // 다른 지점은 그대로 자동
  assert.equal(hasExplicitLinks(next.find((p) => p.id === 'c')), false);
  // 원본 불변
  assert.equal(points()[1].links, undefined);
});

test('addLink — 같은 대상의 기존 링크는 교체, 자기 자신·없는 지점은 무시', () => {
  let items = addLink(points(), 'b', { to: 'c', yaw: 45, targetYaw: 90 });
  const b = items.find((p) => p.id === 'b');
  assert.deepEqual(b.links.map((l) => `${l.to}@${l.yaw}`), ['a@180', 'c@45']);
  assert.equal(b.links[1].targetYaw, 90);
  items = addLink(items, 'b', { to: 'b', yaw: 0 });
  assert.equal(items.find((p) => p.id === 'b').links.length, 2);
  items = addLink(items, 'b', { to: 'zzz', yaw: 0 });
  assert.equal(items.find((p) => p.id === 'b').links.length, 2);
});

test('addLink reciprocal — 대상 지점에 돌아오는 화살표를 넣는다', () => {
  const items = addLink(points(), 'b', { to: 'd', yaw: 90, pitch: -10, targetYaw: 0 }, { reciprocal: true });
  const d = items.find((p) => p.id === 'd');
  assert.equal(d.linksExplicit, true);
  // d 의 자동 링크(이전 지점 c) 는 유지되고, b 로 돌아가는 화살표가 도착 시선(0)의 반대편(180)에 생긴다
  assert.deepEqual(d.links.map((l) => `${l.to}@${l.yaw}>${l.targetYaw}`), ['c@180>180', 'b@180>270']);
  // 같은 방향(180°)이라 겹치지 않게 아래로 비켜 놓인다
  assert.deepEqual(d.links.map((l) => l.pitch), [-10, -22]);
  // 이미 돌아가는 링크가 있으면 또 넣지 않는다
  const again = addLink(items, 'b', { to: 'd', yaw: 100, targetYaw: 0 }, { reciprocal: true });
  assert.equal(again.find((p) => p.id === 'd').links.filter((l) => l.to === 'b').length, 1);
});

test('avoidOverlap — 방향이 겹칠 때만 아래로 비킨다', () => {
  const existing = [{ to: 'x', yaw: 180, pitch: -10 }, { to: 'y', yaw: 184, pitch: -22 }];
  assert.equal(avoidOverlap({ to: 'z', yaw: 178, pitch: -10 }, existing).pitch, -34);
  assert.equal(avoidOverlap({ to: 'z', yaw: 90, pitch: -10 }, existing).pitch, -10);
  assert.equal(avoidOverlap({ to: 'z', yaw: 355, pitch: -10 }, [{ to: 'x', yaw: 3, pitch: -10 }]).pitch, -22); // 0° 경계 넘김
});

test('removeLink — 자동 링크도 지울 수 있고, 전부 지우면 화살표 없는 지점이 된다', () => {

  let items = removeLink(points(), 'b', 0); // b 의 앞(→c) 삭제
  let b = items.find((p) => p.id === 'b');
  assert.deepEqual(b.links.map((l) => l.to), ['a']);
  items = removeLink(items, 'b', 0);
  b = items.find((p) => p.id === 'b');
  assert.deepEqual(b.links, []);
  assert.equal(b.linksExplicit, true);
  assert.deepEqual(effectiveLinks(items, 1), []); // 자동으로 되살아나지 않는다
  assert.equal(removeLink(items, 'b', 5), items); // 범위 밖은 그대로
});

test('resetLinks — 자동 연결로 되돌린다', () => {
  const edited = addLink(points(), 'b', { to: 'd', yaw: 90 });
  const reset = resetLinks(edited, 'b');
  assert.equal(hasExplicitLinks(reset.find((p) => p.id === 'b')), false);
  assert.deepEqual(effectiveLinks(reset, 1).map((l) => l.to), ['c', 'a']);
});

test('pruneLinks — 지운 지점을 가리키는 링크 정리', () => {
  const edited = addLink(points(), 'b', { to: 'd', yaw: 90 }, { reciprocal: true });
  const withoutD = pruneLinks(edited.filter((p) => p.id !== 'd'));
  assert.deepEqual(withoutD.find((p) => p.id === 'b').links.map((l) => l.to), ['c', 'a']);
});

test('저장·읽기 왕복 — 직접 링크와 빈 직접 링크가 뷰어까지 유지된다', () => {
  let items = addLink(points(), 'a', { to: 'c', yaw: 270, targetYaw: 90 });
  items = removeLink(removeLink(items, 'd', 0), 'd', 0); // d: 화살표 없음
  const media = items.map((item, i) => panoramaMediaItem({ ...item, src: `https://x/${item.id}.jpg`, order: i + 1 }));
  assert.equal(media[3].linksExplicit, true);
  assert.deepEqual(media[3].links, []);
  const tour = buildTourPanoramas(media);
  assert.deepEqual(tour[0].links.map((l) => `${l.to}@${l.yaw}`), ['b@0', 'c@270']);
  assert.deepEqual(tour[1].links.map((l) => l.to), ['c', 'a']); // 편집 안 한 지점은 자동
  assert.deepEqual(tour[3].links, []);
});
