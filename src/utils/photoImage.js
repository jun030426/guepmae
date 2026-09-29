/*
 * photoImage.js — 매물 일반 사진 축소·인코딩 (브라우저 전용).
 *
 * 왜: 폰 사진(3~8MB)을 그대로 올리면 매물 하나가 수십 MB 가 된다. 긴 변 1600px·JPEG 0.82 로 줄이면
 *     장당 150~400KB 로 충분한 화질이 나온다. 저장은 Storage(하이브리드)/IndexedDB(로컬)에 하고
 *     매물 행에는 URL 만 남긴다 — 예전처럼 data URL 을 행에 넣지 않는다(목록 로딩마다 전 매물 사진을 받던 문제).
 */

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.82;

/** 긴 변이 maxEdge 를 넘지 않게 맞춘 크기. 확대는 하지 않는다. */
export function fitWithin(width, height, maxEdge = PHOTO_MAX_EDGE) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/**
 * 사진 파일 → 축소 JPEG Blob. 디코드할 수 없는 형식(HEIC 등 브라우저 미지원)은 원본을 그대로 돌려준다.
 * 반환 { blob, width, height, compressed, contentType }
 */
export async function processPhotoFile(file, { maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_JPEG_QUALITY } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file); // EXIF 회전 반영
  } catch {
    return { blob: file, width: null, height: null, compressed: false, contentType: file.type || 'application/octet-stream' };
  }
  const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
  let source = bitmap;
  if (target.width !== bitmap.width || target.height !== bitmap.height) {
    try {
      source = await createImageBitmap(file, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' });
      bitmap.close?.();
    } catch {
      source = bitmap; // 리사이즈 옵션 미지원 → canvas 에서 축소
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  canvas.getContext('2d').drawImage(source, 0, 0, target.width, target.height);
  source.close?.();
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('사진 인코딩에 실패했습니다.'))), 'image/jpeg', quality);
  });
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width: target.width, height: target.height, compressed: true, contentType: 'image/jpeg' };
}
