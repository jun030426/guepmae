const PROPERTY_PHOTO_POOL = [
  { src: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c', label: '외관' },
  { src: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c', label: '정면' },
  { src: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2', label: '거실' },
  { src: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0', label: '주방' },
  { src: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3', label: '침실' },
  { src: 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6', label: '단지 전경' },
  { src: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750', label: '테라스' },
  { src: 'https://images.unsplash.com/photo-1494526585095-c41746248156', label: '주택가' },
  { src: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde', label: '라운지' },
  { src: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6', label: '인테리어' },
  { src: 'https://images.unsplash.com/photo-1600566752355-35792bedcfea', label: '욕실' },
  { src: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d', label: '커뮤니티' },
];

function getSeedFromProperty(property) {
  const rawId = property?.id ?? '';
  const numericId = Number(rawId.replace(/\D/g, ''));
  return Number.isFinite(numericId) && numericId > 0 ? numericId : 1;
}

function withImageParams(src, width, quality) {
  // Supabase Storage URL 은 query 변환 안 하고 그대로 반환
  if (src.includes('supabase')) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}auto=format&fit=crop&w=${width}&q=${quality}`;
}

export function getPropertyPhotos(property, count = 8) {
  // 1순위: 매물에 등록된 실 사진 (property.media)
  if (Array.isArray(property?.media) && property.media.length > 0) {
    return property.media.slice(0, count).map((item, index) => ({
      src: withImageParams(item.src, index === 0 ? 1800 : 640, index === 0 ? 84 : 76),
      label: item.label || `사진 ${index + 1}`,
      alt: item.alt || `${property?.title ?? '매물'} 사진 ${index + 1}`,
    }));
  }

  // 2순위: stock 풀에서 seed 기반 배정 (옛 mock 매물 호환용)
  const seed = getSeedFromProperty(property);
  return Array.from({ length: count }, (_, index) => {
    const source = PROPERTY_PHOTO_POOL[(seed + index - 1) % PROPERTY_PHOTO_POOL.length];
    const isHero = index === 0;
    return {
      src: withImageParams(source.src, isHero ? 1800 : 640, isHero ? 84 : 76),
      label: source.label,
      alt: `${property?.title ?? '매물'} ${source.label} 사진 ${index + 1}`,
    };
  });
}

export function getPrimaryPropertyPhoto(property) {
  return getPropertyPhotos(property, 1)[0];
}
