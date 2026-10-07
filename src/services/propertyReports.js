/*
 * propertyReports.js — 매물 AI 리포트 조회·생성.
 *
 * 읽기: property_reports (하이브리드=Supabase, 로컬=public/data/property_reports.json 번들)
 * 생성: Edge Function property-report — 검증된 가격 데이터·생활권·비교 매물로 Gemini 가 5파트 리포트 작성.
 *       리포트가 없으면 누구나 1회 생성할 수 있고, 다시 생성(force)은 중개사(자기 매물)·운영진만.
 *       로컬 데모 모드에는 생성 백엔드가 없어 번들된 대표 매물 리포트만 보인다.
 */

import { db, isHybrid } from '../lib/dataClient.js';

export const canGenerateReport = isHybrid;

// 'generating' 락이 이보다 오래되면 죽은 것으로 보고 '리포트 없음'으로 취급 (Edge Function 과 같은 값)
const LOCK_TTL_MS = 3 * 60 * 1000;

/*
 * 반환: 리포트 행 | { generating: true } (다른 요청이 생성 중 → 호출 측이 폴링) | null (없음·실패)
 */
export async function fetchPropertyReport(propertyId) {
  if (!propertyId) return null;

  const { data: cached } = await db
    .from('property_reports')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (!cached) return null;

  const status = cached.status ?? 'ready';
  if (status === 'ready') return cached;
  if (status === 'generating') {
    const age = Date.now() - new Date(cached.generated_at).getTime();
    if (Number.isFinite(age) && age < LOCK_TTL_MS) return { generating: true };
  }
  return null;
}

/*
 * 반환: 리포트 행 | { generating: true } (다른 요청이 먼저 생성 중)
 * 실패하면 사용자용 메시지를 담은 Error 를 던진다.
 */
export async function generatePropertyReport(propertyId, { force = false } = {}) {
  if (!isHybrid) {
    throw new Error('로컬 데모 모드에서는 리포트를 실시간 생성할 수 없습니다. 미리 생성된 대표 매물 리포트만 제공됩니다.');
  }
  const { data, error } = await db.functions.invoke('property-report', {
    body: { propertyId, force },
  });
  if (error) {
    // FunctionsHttpError 는 실제 응답 본문에 사용자용 메시지가 있다.
    let message = error.message || 'AI 리포트 생성에 실패했습니다.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
      else if (body?.generating) return { generating: true };
    } catch {
      /* 응답 본문 없음 */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (data?.generating) return { generating: true };
  return data?.report ?? null;
}
