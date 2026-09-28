/*
 * propertyInspections — 매물 AI 점검 체크리스트 (수도·배관·가스 등 8항목).
 *
 * 읽기: property_inspections 테이블 (하이브리드=Supabase, 로컬=없음).
 * 생성: Edge Function inspection-report — 매물 사진을 Gemini 멀티모달로 분석.
 *       중개사(자기 매물)/운영진만, 하이브리드 모드 전용.
 */

import { db, isHybrid } from '../lib/dataClient.js';

export const canGenerateInspection = isHybrid;

export async function fetchPropertyInspection(propertyId) {
  if (!propertyId) return null;
  const { data, error } = await db
    .from('property_inspections')
    .select('report_data, status, model, photo_count, generated_at')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== 'ready' || !data.report_data?.items) return null;
  return {
    report: data.report_data,
    model: data.model,
    photoCount: data.photo_count,
    generatedAt: data.generated_at,
  };
}

export async function generatePropertyInspection(propertyId) {
  const { data, error } = await db.functions.invoke('inspection-report', {
    body: { propertyId },
  });
  if (error) {
    // FunctionsHttpError 는 실제 응답 본문에 사용자용 메시지가 있다.
    let message = error.message || '점검 리포트 생성에 실패했습니다.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      /* 응답 본문 없음 */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data?.report ?? null;
}
