/*
 * marketReport — ai_market_reports 테이블에서 최신 AI 시장 분석 1건 가져오기.
 *
 * Supabase 직접 select (RLS allows anon read). /api/market-report 라우트는
 * 생성/캐싱용이고, 페이지 read는 DB 직조회가 더 단순 (cold start 없음).
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

export async function fetchMarketReport() {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from('ai_market_reports')
    .select('data_as_of, report_data, model, generated_at, status')
    .eq('status', 'ready')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[marketReport] fetch failed:', error.message);
    return null;
  }
  if (!data) return null;

  return {
    dataAsOf: data.data_as_of,
    generatedAt: data.generated_at,
    model: data.model,
    report: data.report_data,
  };
}
