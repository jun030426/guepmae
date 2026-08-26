/*
 * marketReport — ai_market_reports 번들에서 최신 AI 시장 분석 1건 가져오기.
 *
 * 로컬 모드: public/data/ai_market_reports.json 번들을 직조회 (미리 생성해 둔 리포트).
 */

import { db } from '../lib/dataClient.js';

export async function fetchMarketReport() {
  const { data, error } = await db
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
