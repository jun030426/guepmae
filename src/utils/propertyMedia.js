// A listing must never borrow another home's stock photos.
export function getPropertyPhotos(property, count = 8) {
  if (count <= 0) return [];
  const source = Array.isArray(property?.mediaDisplay) ? property.mediaDisplay : property?.media;
  const items = Array.isArray(source) ? source.filter(item => item?.src) : [];
  const photos = items.filter(item => !item.type || item.type === 'photo');
  if (photos.length) return photos.slice(0, count).map((item, index) => ({
    src: item.src, label: item.label || `사진 ${index + 1}`, alt: item.alt || `${property?.title ?? '매물'} 사진 ${index + 1}`,
  }));
  const panorama = items.filter(item => item.type === '360').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  if (panorama) return [{ src: panorama.src, label: '360 파노라마 미리보기', alt: `${property?.title ?? '매물'} 실제 360 사진 미리보기` }];
  return [{ src: '/images/property-placeholder.svg', label: '등록된 사진 없음', alt: '아직 등록된 매물 사진이 없습니다' }];
}

export function getPrimaryPropertyPhoto(property) {
  return getPropertyPhotos(property, 1)[0];
}
