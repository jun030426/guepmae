import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearing,
  buildTourPanoramas,
  directionOf,
  isEquirectangular,
  normalizePanoramaItems,
  normalizeYaw,
  panoramaMediaItem,
  withAutoLinks,
} from './panoramaTour.js';

test('isEquirectangular — 2:1 비율(±4%)과 최소 가로폭', () => {
  assert.equal(isEquirectangular(4096, 2048), true);
  assert.equal(isEquirectangular(6080, 3040), true); // Insta360 ONE X2 합성본 크기
  assert.equal(isEquirectangular(4096, 2060), true); // 허용 오차 안
  assert.equal(isEquirectangular(4096, 2100), false); // 허용 오차 밖
  assert.equal(isEquirectangular(4000, 3000), false); // 일반 사진
  assert.equal(isEquirectangular(1000, 500), false); // 너무 작음
  assert.equal(isEquirectangular(NaN, 500), false);
  assert.equal(isEquirectangular(4096, 0), false);
});

test('normalizeYaw / directionOf — 4방향 분류', () => {
  assert.equal(normalizeYaw(-90), 270);
  assert.equal(normalizeYaw(725), 5);
  assert.equal(normalizeYaw('abc'), 0);
  assert.equal(directionOf(0), 'forward');
  assert.equal(directionOf(350), 'forward');
  assert.equal(directionOf(90), 'right');
  assert.equal(directionOf(180), 'back');
  assert.equal(directionOf(270), 'left');
  assert.equal(directionOf(-90), 'left');
});

test('normalizePanoramaItems — 360 항목만, 기본값 채움, order 정렬', () => {
  const media = [
    { src: 'https://x/photo.jpg', label: '대표 사진' },
    { type: '3d', src: 'https://x/model.glb' },
    { type: '360', src: 'https://x/b.jpg', order: 2 },
    { type: '360', src: 'https://x/a.jpg', order: 1, id: 'entry', label: '현관' },
    { type: '360', src: '' },
  ];
  const items = normalizePanoramaItems(media);
  assert.equal(items.length, 2);
  // 기본 id·라벨 번호는 360 항목만 센 순번(사진·3D 제외) — b 는 360 중 첫 번째라 1번
  assert.deepEqual(items.map((i) => i.id), ['entry', 'pano-1']);
  assert.equal(items[1].label, '지점 1');

  assert.equal(items[0].yawOffset, 0);
});

test('withAutoLinks — 순서 기반 앞/뒤 링크, 명시 링크는 유지', () => {
  const linked = withAutoLinks([
    { id: 'c', order: 3, label: '안방' },
    { id: 'a', order: 1, label: '현관' },
    { id: 'b', order: 2, label: '거실' },
  ]);
  assert.deepEqual(linked.map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(linked[0].links, [{ to: 'b', yaw: 0, pitch: -10, targetYaw: 0, label: '거실' }]);
  assert.deepEqual(
    linked[1].links,
    [
      { to: 'c', yaw: 0, pitch: -10, targetYaw: 0, label: '안방' },
      { to: 'a', yaw: 180, pitch: -10, targetYaw: 180, label: '현관' },
    ],
  );
  assert.deepEqual(linked[2].links, [{ to: 'b', yaw: 180, pitch: -10, targetYaw: 180, label: '거실' }]);

  const explicit = withAutoLinks([
    { id: 'a', order: 1, links: [{ to: 'b', yaw: 90 }] },
    { id: 'b', order: 2 },
  ]);
  assert.deepEqual(explicit[0].links, [{ to: 'b', yaw: 90, pitch: -10, targetYaw: 0, label: '' }]);
  assert.equal(explicit[1].links.length, 1); // b 는 자동 링크(이전 지점)
});

test('buildTourPanoramas — media 에 360 이 없으면 빈 배열', () => {
  assert.deepEqual(buildTourPanoramas([{ src: 'https://x/photo.jpg' }]), []);
  assert.deepEqual(buildTourPanoramas(null), []);
  const tour = buildTourPanoramas([
    { type: '360', src: 'idb:property-360/p/1.jpg', id: 'p1', order: 1 },
    { type: '360', src: 'idb:property-360/p/2.jpg', id: 'p2', order: 2 },
  ]);
  assert.equal(tour.length, 2);
  assert.equal(tour[0].links[0].to, 'p2');
});

test('panoramaMediaItem — 라벨 기본값과 links 생략', () => {
  const item = panoramaMediaItem({ id: 'p1', src: 'https://x/1.jpg', label: '  ', order: 1 });
  assert.deepEqual(item, { type: '360', id: 'p1', src: 'https://x/1.jpg', label: '지점 1', order: 1, yawOffset: 0 });
  const withLinks = panoramaMediaItem({ id: 'p1', src: 's', label: '현관', order: 1, links: [{ to: 'p2', yaw: 0 }] });
  assert.equal(withLinks.links.length, 1);
});

test('bearing — 북쪽 0°, 동쪽 90°', () => {
  const origin = { lat: 37.5, lng: 127.0 };
  assert.ok(Math.abs(bearing(origin, { lat: 37.6, lng: 127.0 }) - 0) < 0.01);
  assert.ok(Math.abs(bearing(origin, { lat: 37.5, lng: 127.1 }) - 90) < 0.1);
  assert.ok(Math.abs(bearing(origin, { lat: 37.4, lng: 127.0 }) - 180) < 0.01);
  assert.ok(Math.abs(bearing(origin, { lat: 37.5, lng: 126.9 }) - 270) < 0.1);
});
