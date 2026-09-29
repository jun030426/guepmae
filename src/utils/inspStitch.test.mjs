import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSP_PRESETS, isInspFile, presetFor, readJpegMakeModel } from './inspStitch.js';

// 최소 JPEG: SOI + APP1(Exif, TIFF little-endian, IFD0 에 Make/Model ASCII) + SOS 마커
function buildExifJpeg({ make, model, little = true }) {
  const enc = (s) => [...s].map((c) => c.charCodeAt(0)).concat([0]);
  const makeBytes = enc(make);
  const modelBytes = enc(model);
  const entries = 2;
  const ifdOffset = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const makeOffset = ifdOffset + ifdSize;
  const modelOffset = makeOffset + makeBytes.length;
  const tiff = [];
  const u16 = (v) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff] : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifdOffset));
  tiff.push(...u16(entries));
  tiff.push(...u16(0x010f), ...u16(2), ...u32(makeBytes.length), ...u32(makeOffset));
  tiff.push(...u16(0x0110), ...u16(2), ...u32(modelBytes.length), ...u32(modelOffset));
  tiff.push(...u32(0));
  tiff.push(...makeBytes, ...modelBytes);
  const app1Body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // "Exif\0\0"
  const app1Len = app1Body.length + 2;
  const bytes = [0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, ...app1Body, 0xff, 0xda, 0, 2];
  return new Uint8Array(bytes).buffer;
}

test('readJpegMakeModel — little-endian EXIF 에서 Make/Model 을 읽는다', () => {
  const buf = buildExifJpeg({ make: 'Insta360', model: 'Insta360 ONE X2' });
  assert.deepEqual(readJpegMakeModel(buf), { make: 'Insta360', model: 'Insta360 ONE X2' });
});

test('readJpegMakeModel — big-endian 도 읽는다', () => {
  const buf = buildExifJpeg({ make: 'Insta360', model: 'Insta360 X3', little: false });
  assert.equal(readJpegMakeModel(buf).model, 'Insta360 X3');
});

test('readJpegMakeModel — EXIF 없는 JPEG·JPEG 아님 → 빈 값', () => {
  assert.deepEqual(readJpegMakeModel(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), { make: '', model: '' });
  assert.deepEqual(readJpegMakeModel(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), { make: '', model: '' });
});

test('presetFor — ONE X2 는 보정 프리셋, 나머지는 미보정 기본값', () => {
  assert.equal(presetFor('Insta360 ONE X2').calibrated, true);
  assert.equal(presetFor('insta360 one x2').key, 'insta360-one-x2');
  assert.equal(presetFor('Insta360 X3').calibrated, false);
  assert.equal(presetFor('').calibrated, false);
  assert.equal(INSP_PRESETS['insta360-one-x2'].fov, 200);
  assert.equal(INSP_PRESETS['insta360-one-x2'].frontRotation, 90);
  assert.equal(INSP_PRESETS['insta360-one-x2'].backRotation, 270);
});

test('isInspFile — 확장자로 판별', () => {
  assert.equal(isInspFile({ name: 'IMG_20260501_162230_00_021.insp' }), true);
  assert.equal(isInspFile({ name: 'IMG_0001.INSP' }), true);
  assert.equal(isInspFile({ name: 'pano.jpg' }), false);
  assert.equal(isInspFile(null), false);
});
