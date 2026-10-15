import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPropertyPhotos, getPrimaryPropertyPhoto } from './propertyMedia.js';
test('real photo URL is preserved including any signed query', () => {
  const src='https://storage.invalid/photo?token=signature';
  assert.equal(getPrimaryPropertyPhoto({media:[{src}]}).src,src);
});
test('360-only listing uses its first ordered real panorama', () => {
  const cover=getPrimaryPropertyPhoto({media:[{type:'360',src:'last.jpg',order:2},{type:'360',src:'first.jpg',order:1}]});
  assert.equal(cover.src,'first.jpg');assert.match(cover.label,/360/);
});
test('empty listing uses an explicit placeholder, never a stock home', () => {
  const photos=getPropertyPhotos({id:'gm-123'});
  assert.equal(photos.length,1);assert.equal(photos[0].src,'/images/property-placeholder.svg');
  assert.match(photos[0].label,/없음/);
});
