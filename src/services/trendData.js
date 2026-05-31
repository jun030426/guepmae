/*
 * trendData — 시세 동향 페이지 전용 fetch.
 *
 * propertyRegistration.fetchPriceHistory가 매물 등록 스냅샷용으로 series 배열만
 * 반환하는 것과 달리, 여기서는 신뢰도 메타까지 한 번에 계산해서 반환.
 *   { series, reliability, realMonths, sampleTotal }
 *
 * 같은 price_trends 테이블 조회 + sample_size 컬럼 같이 select.
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';
import { gradeReliability } from '../utils/trendStats.js';

const EMPTY = { series: [], reliability: 'low', realMonths: 0, sampleTotal: 0 };

/* 시도/구 select 옵션 — 페이지 마운트 시 한 번 로드해서 모듈 캐시.
 * 254개 구 + 17개 시도라 한 번 받으면 충분. 동시 호출도 inflight로 묶음. */
const EMPTY_OPTIONS = { sidos: [], guBySido: {} };
let cachedRegionOptions = null;
let inflightRegionOptions = null;

export async function fetchRegionOptions() {
  if (cachedRegionOptions) return cachedRegionOptions;
  if (inflightRegionOptions) return inflightRegionOptions;
  if (!isSupabaseConfigured) return EMPTY_OPTIONS;

  inflightRegionOptions = (async () => {
    // 14,391행이지만 region·gu 두 컬럼만 select. PostgREST 기본 1000 limit 초과라 range 명시.
    const { data, error } = await supabase
      .from('price_trends')
      .select('region, gu')
      .range(0, 15000);

    if (error || !data) {
      if (error) console.warn('region options 조회 실패:', error.message);
      return EMPTY_OPTIONS;
    }

    const guMap = new Map();
    for (const row of data) {
      if (!guMap.has(row.region)) guMap.set(row.region, new Set());
      guMap.get(row.region).add(row.gu);
    }
    const sidos = [...guMap.keys()].sort();
    const guBySido = {};
    for (const sido of sidos) {
      guBySido[sido] = [...guMap.get(sido)].sort();
    }
    cachedRegionOptions = { sidos, guBySido };
    return cachedRegionOptions;
  })();

  try {
    return await inflightRegionOptions;
  } finally {
    inflightRegionOptions = null;
  }
}

export async function fetchPriceTrend({ gu, areaBucket }) {
  if (!isSupabaseConfigured || !gu || !areaBucket || areaBucket === '미상') {
    return EMPTY;
  }

  const { data, error } = await supabase
    .from('price_trends')
    .select('year_month, price, sample_size, is_estimated')
    .eq('gu', gu)
    .eq('area_bucket', areaBucket)
    .order('year_month', { ascending: true });

  if (error || !data?.length) {
    if (error) console.warn('price_trends 조회 실패:', error.message);
    return EMPTY;
  }

  const series = data.map((row) => ({
    yearMonth: row.year_month,
    month: row.year_month.slice(2).replace('-', '.'), // '2025-05' → '25.05'
    price: row.price,
    sampleSize: row.sample_size,
    estimated: row.is_estimated,
  }));

  const realMonths = series.filter((s) => !s.estimated).length;
  const sampleTotal = series.reduce((acc, s) => acc + (s.sampleSize || 0), 0);

  return {
    series,
    reliability: gradeReliability(realMonths, sampleTotal),
    realMonths,
    sampleTotal,
  };
}
