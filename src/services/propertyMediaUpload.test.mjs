import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadMediaSelection } from './propertyMediaUpload.js';

function setup({ failUpload = 0, failCleanup = false } = {}) {
  const written = [], removed = [];
  const options = { prefix: 'owner/property', photos: [{ name: 'room.bmp' }], panoramas: [],
    processPhoto: async () => ({ blob: new Blob(['photo']) }), processPanorama: async () => ({ blob: new Blob(['panorama']) }),
    storage: { from: bucket => ({
      upload: async (path, blob, config) => { written.push({ bucket, path, config }); return written.length === failUpload ? { error: { message: 'network error' } } : { data: { path } }; },
      getPublicUrl: path => ({ data: { publicUrl: `https://storage.invalid/${path}` } }),
      remove: async paths => { removed.push({ bucket, paths }); return { error: failCleanup ? new Error('cleanup failed') : null }; },
    }) },
  };
  return { options, written, removed };
}

test('uploads ordinary photos and ordered 360 scenes without overwriting existing objects', async () => {
  const { options, written } = setup();
  options.panoramas = [{ id: 'one', file: { name: 'one.jpg' }, yawOffset: 40, stitched: 'browser', calibrated: true, model: 'ONE X2' }, { id: 'two', src: 'existing.jpg', linksExplicit: true, links: [] }];
  const media = await uploadMediaSelection(options);
  assert.equal(media.length, 3);
  assert.deepEqual(media.slice(1).map(x => [x.order, x.yawOffset]), [[1,40],[2,0]]);
  assert.equal(media[1].stitched, 'browser');
  assert.equal(media[1].calibrated, true);
  assert.equal(media[1].model, 'ONE X2');
  assert.equal(media[2].src, 'existing.jpg');
  assert.deepEqual(media[2].links, []);
  assert.equal(written.length, 2);
  assert.ok(written.every(x => x.config.upsert === false && x.config.contentType === 'image/jpeg'));
});

test('photo upload failure throws its filename and cleans the already uploaded files', async () => {
  const { options, written, removed } = setup({ failUpload: 2 });
  options.photos.push({ name: 'failed.bmp' });
  await assert.rejects(uploadMediaSelection(options), /failed.bmp.*매물은 저장하지 않았습니다/);
  assert.deepEqual(removed, [{ bucket: 'property-photos', paths: [written[0].path] }]);
});

test('panorama failure cleans new photos and scenes but never existing listing media', async () => {
  const { options, written, removed } = setup({ failUpload: 3 });
  options.panoramas = [{ id: 'old', src: 'existing.jpg' }, { id: 'one', file: { name: 'one.jpg' } }, { id: 'two', file: { name: 'two.jpg' } }];
  await assert.rejects(uploadMediaSelection(options), /two.jpg/);
  assert.deepEqual(removed.flatMap(x => x.paths).sort(), written.slice(0,2).map(x=>x.path).sort());
  assert.ok(!removed.some(x => x.paths.includes('existing.jpg')));
});

test('decode failure never uploads an unsupported original', async () => {
  const { options, written } = setup();
  options.processPhoto = async () => { throw new Error('unsupported image'); };
  await assert.rejects(uploadMediaSelection(options), /room.bmp.*unsupported image/);
  assert.equal(written.length, 0);
});

test('cleanup failure is reported while preserving the upload error', async () => {
  const { options } = setup({ failUpload: 2, failCleanup: true });
  options.photos.push({ name: 'failed.bmp' });
  await assert.rejects(uploadMediaSelection(options), /failed.bmp.*network error.*임시 파일 정리에 실패/);
});
