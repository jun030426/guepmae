/*
 * complexAlerts.js — 관심 단지 급매 알림 구독 저장·조회·해지.
 *
 * 저장: complex_alerts 테이블 (하이브리드 = Supabase, 로컬 = localStorage).
 * 비로그인 사용자는 자기 행을 다시 읽을 수 없으므로(RLS), 신청할 때 만든 해지 토큰을
 * 이 기기(localStorage)에 남겨 "내 알림"에서 해지할 수 있게 한다.
 * 발송은 아직 없다 — 구독 저장과 지표(신청 수)까지. 설계: docs/superpowers/specs/2026-09-29-complex-alerts-design.md
 */

import { db } from '../lib/dataClient.js';
import {
  alertKey,
  clampMinDiscount,
  isValidEmail,
  newUnsubscribeToken,
  normalizeEmail,
  summarizeAlerts,
} from '../utils/alertMatch.js';

const DEVICE_KEY = 'geupmae:my-alerts';

function readDevice() {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_KEY));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeDevice(list) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(list));
  } catch {
    /* quota — 기기 목록은 편의 기능이라 실패해도 구독 자체는 저장됨 */
  }
}

/** 이 기기에서 신청한 알림 (해지 토큰 포함) */
export function listDeviceAlerts() {
  return readDevice();
}

export function isSubscribedOnDevice({ email, complex, gu, areaM2 }) {
  const key = alertKey({ email, complex, gu, areaM2 });
  return readDevice().some((item) => item.key === key);
}

function isDuplicateError(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('23505') || text.includes('duplicate');
}

/**
 * 구독 신청. 반환 { ok, duplicate }.
 * 같은 이메일·단지·평형의 활성 구독이 이미 있으면 duplicate:true (오류 아님).
 */
export async function subscribeAlert({ email, complex, gu, areaM2 = null, minDiscount = 5, sourcePropertyId = null }) {
  const cleanEmail = normalizeEmail(email);
  if (!isValidEmail(cleanEmail)) throw new Error('이메일 주소를 확인해주세요.');
  if (!complex || !gu) throw new Error('알림을 받을 단지를 확인할 수 없습니다.');
  const area = areaM2 == null || areaM2 === '' ? null : Math.floor(Number(areaM2));
  const key = alertKey({ email: cleanEmail, complex, gu, areaM2: area });
  const token = newUnsubscribeToken();

  const { error } = await db.from('complex_alerts').insert({
    email: cleanEmail,
    complex,
    gu,
    area_m2: area,
    min_discount: clampMinDiscount(minDiscount),
    source_property_id: sourcePropertyId,
    unsubscribe_token: token,
    status: 'active',
  });
  if (error) {
    if (isDuplicateError(error)) return { ok: true, duplicate: true };
    throw new Error(error.message || '알림 신청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }

  const device = readDevice().filter((item) => item.key !== key);
  device.unshift({ key, token, email: cleanEmail, complex, gu, areaM2: area, minDiscount: clampMinDiscount(minDiscount), createdAt: new Date().toISOString() });
  writeDevice(device.slice(0, 100));
  return { ok: true, duplicate: false };
}

/** 해지 — 토큰으로. 비로그인도 가능(DB 함수 unsubscribe_alert). */
export async function unsubscribeAlert(token) {
  if (!token) throw new Error('해지 토큰이 없습니다.');
  const { error } = await db.rpc('unsubscribe_alert', { p_token: token });
  if (error) throw new Error(error.message || '알림을 해지하지 못했습니다.');
  writeDevice(readDevice().filter((item) => item.token !== token));
  return true;
}

/** 로그인 사용자의 이메일로 등록된 활성 알림 (다른 기기에서 신청한 것 포함). 비로그인·오류면 빈 배열. */
export async function fetchAlertsByEmail(email) {
  const cleanEmail = normalizeEmail(email);
  if (!isValidEmail(cleanEmail)) return [];
  const { data, error } = await db
    .from('complex_alerts')
    .select('email, complex, gu, area_m2, min_discount, status, unsubscribe_token, created_at')
    .eq('email', cleanEmail)
    .eq('status', 'active');
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    key: alertKey({ email: row.email, complex: row.complex, gu: row.gu, areaM2: row.area_m2 }),
    token: row.unsubscribe_token,
    email: row.email,
    complex: row.complex,
    gu: row.gu,
    areaM2: row.area_m2,
    minDiscount: Number(row.min_discount),
    createdAt: row.created_at,
  }));
}

/** 운영 통계 — 활성 신청 수·단지 수·상위 단지. 운영 권한이 없으면(RLS) 0 으로 보인다. */
export async function fetchAlertStats() {
  const { data, error } = await db.from('complex_alerts').select('complex, gu, area_m2, status, created_at');
  if (error || !Array.isArray(data)) return { total: 0, complexes: 0, top: [] };
  return summarizeAlerts(data);
}
