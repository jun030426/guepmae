/*
 * reportData.js — /report + 홈 차트가 사용하는 시장 통계 서빙 레이어
 *
 * 데이터 소스: Supabase `market_snapshots` 테이블 (key/value).
 * 첫 호출 시 모든 키를 한 번에 가져와 모듈 캐시에 보관 → 이후 호출은 메모리 hit.
 *
 * 갱신: scripts/build-market-snapshots-seed-sql.mjs 로 SQL 만들고 Supabase에 paste.
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

let cache = null;
let inflight = null;

const EMPTY = {
  regional: [],
  monthly: [],
  area_type: [],
  top_urgent: [],
  insights: [],
  metadata: { generatedAt: null, totalTrades: 0 },
  home_trend: [],
};

async function loadAll() {
  if (cache) return cache;
  if (inflight) return inflight;

  if (!isSupabaseConfigured) {
    cache = EMPTY;
    return cache;
  }

  inflight = (async () => {
    const { data, error } = await supabase.from('market_snapshots').select('key, data');
    if (error) {
      console.warn('[reportData] Supabase fetch failed, using empty state.', error);
      cache = EMPTY;
      return cache;
    }
    const result = { ...EMPTY };
    (data ?? []).forEach((row) => {
      result[row.key] = row.data;
    });
    cache = result;
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function fetchRegionalSnapshots() {
  const all = await loadAll();
  return all.regional ?? [];
}

export async function fetchMonthlyTrend(months = 12) {
  const all = await loadAll();
  const trend = all.monthly ?? [];
  return trend.slice(-months);
}

export async function fetchAreaTypeBreakdown() {
  const all = await loadAll();
  return all.area_type ?? [];
}

export async function fetchTopUrgentComplexes(limit = 10) {
  const all = await loadAll();
  return (all.top_urgent ?? []).slice(0, limit);
}

export async function fetchMarketInsights() {
  const all = await loadAll();
  return all.insights ?? [];
}

export async function fetchHomeUrgentTrend() {
  const all = await loadAll();
  return all.home_trend ?? [];
}

export async function getDataSource() {
  const all = await loadAll();
  return all.metadata ?? null;
}
