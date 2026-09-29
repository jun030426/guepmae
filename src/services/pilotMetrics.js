/*
 * pilotMetrics.js — 파일럿 지표의 저장·조회.
 *
 *   조회·문의 집계   DB 함수 track_property_event / property_stats (하이브리드 = Supabase, 로컬 = localStorage)
 *   유료 의향 설문   agent_pricing_intents 테이블
 *
 * 집계는 화면의 부가 기능이다 — 실패해도 매물 열람·문의를 막지 않는다(예외를 밖으로 던지지 않는다).
 * 설계: docs/superpowers/specs/2026-09-29-pilot-metrics-design.md
 */

import { db } from '../lib/dataClient.js';
import { kstDay, periodRange, rememberTracked, shouldTrack, trackKey, validateIntent } from '../utils/pilotMetrics.js';

const TRACKED_KEY = 'geupmae:tracked'; // { day, keys } — 같은 날 같은 매물을 두 번 세지 않기 위한 기록. 서버로 가지 않는다

function readTracked() {
  try {
    return JSON.parse(localStorage.getItem(TRACKED_KEY));
  } catch {
    return null;
  }
}

function writeTracked(store) {
  try {
    localStorage.setItem(TRACKED_KEY, JSON.stringify(store));
  } catch {
    /* 저장소를 쓸 수 없으면 중복 제거 없이 센다 */
  }
}

// 보내는 중인 집계 — 화면이 연달아 두 번 그려져도(개발 모드의 이중 실행 등) 요청은 하나만 나간다
const inFlight = new Set();

/**
 * 조회·문의 한 건을 센다. viewer 는 로그인한 사용자의 프로필(없으면 null).
 * 반환: 서버에 보냈는지 여부. 어떤 경우에도 예외를 던지지 않는다.
 */
export async function trackPropertyEvent(property, event, viewer = null) {
  let flight = null;
  try {
    const allowed = shouldTrack({
      event,
      property,
      viewer,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      webdriver: typeof navigator !== 'undefined' && navigator.webdriver === true,
    });
    if (!allowed) return false;

    const day = kstDay();
    const key = trackKey(event, property.id);
    if (inFlight.has(`${day}|${key}`)) return false;
    if (!rememberTracked(readTracked(), day, key).fresh) return false;

    flight = `${day}|${key}`;
    inFlight.add(flight);
    const { error } = await db.rpc('track_property_event', { p_property_id: property.id, p_event: event });
    if (error) return false; // 기록하지 않는다 — 다음에 다시 시도된다
    // 요청이 오가는 사이 다른 집계가 끼어들었을 수 있어 저장값을 다시 읽는다
    writeTracked(rememberTracked(readTracked(), day, key).store);
    return true;
  } catch {
    return false;
  } finally {
    if (flight) inFlight.delete(flight);
  }
}

const EMPTY_STATS = { scope: 'none', listings: [], daily: [] };

/** 기간의 매물별·일별 합계. days 가 없으면 전체 기간. 권한이 없거나 실패하면 빈 결과 */
export async function fetchPropertyStats(days = 30) {
  const { from, to } = periodRange(days);
  try {
    const { data, error } = await db.rpc('property_stats', { p_from: from, p_to: to });
    if (error || !data) return { ...EMPTY_STATS, from, to };
    return {
      scope: data.scope ?? 'none',
      listings: Array.isArray(data.listings) ? data.listings : [],
      daily: Array.isArray(data.daily) ? data.daily : [],
      from,
      to,
    };
  } catch {
    return { ...EMPTY_STATS, from, to };
  }
}

/** 내 설문 답. 없으면 null */
export async function fetchMyPricingIntent(userId) {
  if (!userId) return null;
  const { data, error } = await db
    .from('agent_pricing_intents')
    .select('user_id, email, willing, price_band, comment, listing_count, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** 설문 저장(처음이면 추가, 있으면 덮어씀). 잘못된 답은 오류 */
export async function savePricingIntent({ userId, email, willing, priceBand, comment, listingCount = 0 }) {
  if (!userId || !email) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
  const checked = validateIntent({ willing, priceBand, comment });
  if (!checked.ok) throw new Error(checked.error);
  const row = {
    user_id: userId,
    email: String(email).trim().toLowerCase(),
    ...checked.value,
    listing_count: Math.max(0, Math.floor(Number(listingCount) || 0)),
  };
  const { error } = await db.from('agent_pricing_intents').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message || '답변을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
  return row;
}

/** 운영진용 — 모든 설문 답. 권한이 없으면(RLS) 자기 것만 또는 빈 배열 */
export async function fetchPricingIntents() {
  const { data, error } = await db
    .from('agent_pricing_intents')
    .select('user_id, email, willing, price_band, comment, listing_count, created_at, updated_at');
  if (error || !Array.isArray(data)) return [];
  return data;
}
