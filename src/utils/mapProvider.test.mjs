import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapProvider } from './mapProvider.js';

test('resolveMapProvider — 카카오 키가 있으면 카카오가 기본, 없으면 OSM', () => {
  assert.equal(resolveMapProvider({ hasKakao: true }), 'kakao');
  assert.equal(resolveMapProvider({ hasKakao: false }), 'osm');
  assert.equal(resolveMapProvider({ requested: 'kakao', hasKakao: false }), 'osm');
});

test('resolveMapProvider — 명시한 제공자가 우선, 키가 없으면 무시', () => {
  assert.equal(resolveMapProvider({ requested: 'osm', hasKakao: true }), 'osm');
  assert.equal(resolveMapProvider({ requested: 'Google', hasGoogle: true, hasKakao: true }), 'google');
  assert.equal(resolveMapProvider({ requested: 'google', hasGoogle: false, hasKakao: true }), 'kakao');
  assert.equal(resolveMapProvider({ requested: 'naver', hasNaver: true }), 'naver');
});
