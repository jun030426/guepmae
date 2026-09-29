/*
 * panoramaImage.js — 360 파노라마 파일 검증·축소 (브라우저 전용).
 *
 * 업로드 파이프라인 (설계 §4.4):
 *   JPG 선택 → 2:1 비율 검증 → 4096×2048 로 축소(createImageBitmap 리사이즈, 폴백 canvas)
 *   → JPEG 0.85 인코딩 → 보통 1~2MB.
 * 4096 폭으로 통일하는 이유: Pannellum 이 모바일 GPU 텍스처 한계로 4096 초과 파노라마에 경고를 내고,
 * 무료 저장 용량(Supabase 1GB)에서도 장당 ≤2MB 가 감당되는 크기다.
 */

import { isEquirectangular } from './panoramaTour.js';
import { isInspFile, stitchInsp } from './inspStitch.js';

export const PANORAMA_TARGET_WIDTH = 4096;
export const PANORAMA_JPEG_QUALITY = 0.85;

export class PanoramaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PanoramaValidationError';
  }
}

function looksLikeJpeg(file) {
  return /^image\/jpe?g$/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || '') || isInspFile(file);
}

/**
 * Insta360 원본(.insp)을 브라우저에서 정방형 JPG 로 바꿔 File 로 돌려준다.
 * 반환 { file, calibrated, model, width, height } — 이후 파이프라인은 일반 360 JPG 와 동일하게 처리.
 */
export async function convertInspToPanorama(file, { targetWidth = PANORAMA_TARGET_WIDTH } = {}) {
  let result;
  try {
    result = await stitchInsp(file, { targetWidth, quality: 0.9 });
  } catch (error) {
    const message = String(error?.message ?? '');
    if (message.startsWith('GPU_TEXTURE_LIMIT')) {
      throw new PanoramaValidationError('이 기기의 그래픽 성능으로는 .insp 를 변환할 수 없습니다. PC 에서 올리거나 Insta360 앱에서 내보낸 360 JPG 를 올려주세요.');
    }
    if (message.startsWith('WEBGL')) {
      throw new PanoramaValidationError('.insp 변환 중 그래픽 오류가 났습니다. Insta360 앱에서 내보낸 360 JPG 를 올려주세요.');
    }
    throw new PanoramaValidationError(message || '.insp 변환에 실패했습니다.');
  }
  const name = String(file.name || 'panorama').replace(/\.insp$/i, '') + '.jpg';
  return {
    file: new File([result.blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
    calibrated: result.calibrated,
    model: result.model,
    width: result.width,
    height: result.height,
  };
}

/** 디코딩 없이 크기만 필요할 때도 createImageBitmap 이 가장 빠르고 EXIF 회전을 반영한다. */
export async function readImageDimensions(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dims;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('IMAGE_DECODE_FAILED'));
    };
    image.src = url;
  });
}

/** 형식·비율 검증. 통과하면 원본 크기를 돌려주고, 아니면 사용자용 메시지의 PanoramaValidationError. */
export async function validatePanoramaFile(file) {
  if (!file) throw new PanoramaValidationError('파일이 없습니다.');
  if (!looksLikeJpeg(file)) {
    throw new PanoramaValidationError('JPG 형식의 360 사진만 올릴 수 있습니다. Insta360 앱에서 내보낸 사진을 선택해주세요.');
  }
  let dims;
  try {
    dims = await readImageDimensions(file);
  } catch {
    throw new PanoramaValidationError('이미지를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.');
  }
  if (!isEquirectangular(dims.width, dims.height)) {
    throw new PanoramaValidationError(
      `360 사진이 아닌 것 같습니다 (${dims.width}×${dims.height}). 가로가 세로의 2배인 파노라마 JPG 를 올려주세요.`,
    );
  }
  return dims;
}

async function decodeResized(file, width, height) {
  try {
    return await createImageBitmap(file, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  } catch {
    // Safari 등 리사이즈 옵션 미지원 — 원본 크기로 디코드하고 canvas 에서 축소한다.
    return createImageBitmap(file);
  }
}

/**
 * 검증 + 축소 + JPEG 인코딩. 반환: { blob, width, height, originalWidth, originalHeight }.
 * 원본이 목표 폭보다 작으면 원본 크기를 유지한다(확대하지 않음).
 */
export async function processPanoramaFile(
  file,
  { targetWidth = PANORAMA_TARGET_WIDTH, quality = PANORAMA_JPEG_QUALITY } = {},
) {
  const { width, height } = await validatePanoramaFile(file);
  const outWidth = Math.min(targetWidth, width);
  const outHeight = Math.round(outWidth / 2);

  const bitmap = await decodeResized(file, outWidth, outHeight);
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, outWidth, outHeight);
  bitmap.close?.();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('JPEG 인코딩에 실패했습니다.'))),
      'image/jpeg',
      quality,
    );
  });
  // 큰 캔버스 메모리를 즉시 반납
  canvas.width = 0;
  canvas.height = 0;

  return { blob, width: outWidth, height: outHeight, originalWidth: width, originalHeight: height };
}
