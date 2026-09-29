/*
 * mediaUrl.js — media.src 를 실제로 표시 가능한 URL 로 바꾼다.
 *
 *   https://…  → 그대로 (Supabase Storage 공개 URL, 외부 이미지)
 *   data:…     → 그대로 (로컬 모드 일반 사진)
 *   idb:<key>  → IndexedDB Blob 의 object URL (로컬 모드 360 파노라마 등 대용량)
 */

import { getObjectUrl } from './localMediaStore.js';

export const IDB_PREFIX = 'idb:';

export function isLocalMediaRef(src) {
  return typeof src === 'string' && src.startsWith(IDB_PREFIX);
}

export async function resolveMediaUrl(src) {
  if (!isLocalMediaRef(src)) return src;
  try {
    const url = await getObjectUrl(src.slice(IDB_PREFIX.length));
    return url ?? '';
  } catch {
    return '';
  }
}

/** 여러 src 를 한 번에 — 순서 유지. 실패한 항목은 '' */
export function resolveMediaUrls(sources) {
  return Promise.all((sources ?? []).map((src) => resolveMediaUrl(src)));
}
