/*
 * propertyReports.js — 매물 AI 리포트 조회 (로컬 모드).
 *
 * 로컬 모드에는 백엔드(Gemini 생성)가 없으므로, public/data/property_reports.json 에
 * 미리 생성해 번들한 대표 매물 리포트만 조회한다. 번들에 없으면 null(리포트 없음).
 */

import { db } from '../lib/dataClient.js';

export async function fetchPropertyReport(propertyId) {
  if (!propertyId) return null;

  // 번들된 리포트 캐시 — 완성된(ready) 리포트만 사용.
  const { data: cached } = await db
    .from('property_reports')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (cached && (cached.status ?? 'ready') === 'ready') return cached;

  // 로컬 모드: 실시간 생성 불가 → 리포트 없음.
  return null;
}

export async function regeneratePropertyReport() {
  // 로컬 데모 모드에는 AI 생성 백엔드가 없음.
  throw new Error('로컬 데모 모드에서는 리포트를 실시간 생성할 수 없습니다. 미리 생성된 대표 매물 리포트만 제공됩니다.');
}
