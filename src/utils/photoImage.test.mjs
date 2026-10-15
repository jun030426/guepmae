import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, PHOTO_MAX_EDGE, processPhotoFile } from './photoImage.js';

test('camera originals are rejected with actionable guidance in the ordinary photo field', async () => {
  await assert.rejects(processPhotoFile({ name: 'camera.insp' }), /360 투어/);
  await assert.rejects(processPhotoFile({ name: 'camera.dng' }), /JPG/);
});

test('undecodable photo is rejected instead of uploading unreadable original bytes', async () => {
  await assert.rejects(processPhotoFile({ name: 'broken.jpg' }), /읽을 수 없는 사진/);
});

test('fitWithin — 긴 변을 1600 으로 맞추고 비율을 유지한다', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200, scale: 0.4 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600, scale: 0.4 });
  assert.equal(PHOTO_MAX_EDGE, 1600);
});

test('fitWithin — 작은 사진은 확대하지 않는다', () => {
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600, scale: 1 });
});

test('fitWithin — 잘못된 크기는 0', () => {
  assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0, scale: 1 });
  assert.deepEqual(fitWithin(NaN, 100), { width: 0, height: 0, scale: 1 });
});
