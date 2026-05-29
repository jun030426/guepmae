/*
 * propertyReports.js — 매물 AI 리포트 조회/생성 클라이언트 wrapper.
 *
 * 1순위: Supabase property_reports 테이블에서 캐시 조회
 * 2순위: 캐시 없으면 /api/property-report?id=... 호출 → 서버에서 Gemini 생성 → 캐시 저장 → 반환
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

export async function fetchPropertyReport(propertyId) {
  if (!isSupabaseConfigured || !propertyId) return null;

  // 1) Supabase 캐시 — 완성된(ready) 리포트만 사용. 'generating' 락 로우(임시 {})는 무시.
  const { data: cached } = await supabase
    .from('property_reports')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (cached && (cached.status ?? 'ready') === 'ready') return cached;

  // 2) 캐시 없으면 서버리스 함수 호출 → 생성 → 캐싱
  const res = await fetch(`/api/property-report?id=${encodeURIComponent(propertyId)}`);
  // 202 = 다른 요청이 생성 중 (중복 AI 호출 방지). 잠시 후 재조회 필요.
  if (res.status === 202) {
    return { generating: true };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `리포트 생성 실패 (${res.status})`);
  }
  const data = await res.json();
  if (data?.status === 'generating') return { generating: true };
  return data;
}

export async function regeneratePropertyReport(propertyId) {
  const res = await fetch('/api/property-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: propertyId, force: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `리포트 재생성 실패 (${res.status})`);
  }
  return res.json();
}
