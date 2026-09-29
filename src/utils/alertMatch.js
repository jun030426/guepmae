/*
 * alertMatch.js — 관심 단지 급매 알림의 순수 로직 (검증·키·매칭). node:test 로 검증.
 *
 * 알림 = "이 단지(선택: 이 평형)에 검증된 급매가 새로 올라오면 알려달라"는 구독.
 * 발송(메일)은 별도 단계 — 여기의 matchAlerts 가 발송 대상 선정 규칙이다.
 * 설계: docs/superpowers/specs/2026-09-29-complex-alerts-design.md
 */

export const ALERT_MIN_DISCOUNT = 5;
export const ALERT_MAX_DISCOUNT = 40;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length >= 5 && email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/** 중복 판정 키 — 같은 이메일·단지·구·평형(전체는 'all')은 하나만 */
export function alertKey({ email, complex, gu, areaM2 }) {
  const area = areaM2 == null || areaM2 === '' ? 'all' : String(Math.floor(Number(areaM2)));
  return `${normalizeEmail(email)}|${String(gu ?? '').trim()}|${String(complex ?? '').trim()}|${area}`;
}

/**
 * 매물에서 알림 대상 단지(국토부 기준 단지명 + 구)를 뽑는다. 알 수 없으면 null.
 *  - 수집·재계산 매물: priceTable.complexName(정식명) + region(구)
 *  - 중개사 등록 매물: priceBasis.complexName + priceBasis.gu (등록 시 저장)
 */
export function complexOf(property) {
  if (!property) return null;
  const basis = property.priceBasis ?? property.price_basis ?? {};
  const table = property.priceTable ?? property.price_table ?? {};
  const complex = String(table.complexName || basis.complexName || '').trim();
  const gu = String(basis.gu || (table.complexName ? property.region : '') || '').trim();
  if (!complex || !gu) return null;
  return { complex, gu };
}

export function clampMinDiscount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return ALERT_MIN_DISCOUNT;
  return Math.min(ALERT_MAX_DISCOUNT, Math.max(ALERT_MIN_DISCOUNT, n));
}

/**
 * 새(또는 갱신된) 매물 하나에 대해 알림을 받아야 할 구독 목록.
 * 조건: 구독 활성 · 같은 단지·구 · (평형 지정 시) 같은 전용면적 · 매물이 운영 검증 완료 ·
 *       판정 보류가 아님 · 할인율 ≥ 구독의 최소 할인율.
 * alerts 행은 DB 컬럼명(area_m2, min_discount) 또는 camelCase 둘 다 받는다.
 */
export function matchAlerts(listing, alerts) {
  const target = complexOf(listing);
  if (!target) return [];
  const verified = Boolean(listing.verified);
  const discount = listing.discountRate ?? listing.discount_rate;
  if (!verified || discount == null || !Number.isFinite(Number(discount))) return [];
  const area = Math.floor(Number(listing.area));
  return (alerts ?? []).filter((alert) => {
    if (!alert || (alert.status ?? 'active') !== 'active') return false;
    if (String(alert.complex).trim() !== target.complex || String(alert.gu).trim() !== target.gu) return false;
    const alertArea = alert.area_m2 ?? alert.areaM2;
    if (alertArea != null && Number(alertArea) !== area) return false;
    const min = clampMinDiscount(alert.min_discount ?? alert.minDiscount ?? ALERT_MIN_DISCOUNT);
    return Number(discount) >= min;
  });
}

export function newUnsubscribeToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID 가 없는 환경(구형 브라우저) — RFC 4122 v4 형식
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

/** 관리자 통계: 활성 구독 수와 단지별 상위 목록 */
export function summarizeAlerts(rows, limit = 10) {
  const active = (rows ?? []).filter((row) => (row.status ?? 'active') === 'active');
  const byComplex = new Map();
  for (const row of active) {
    const key = `${row.gu}|${row.complex}`;
    if (!byComplex.has(key)) byComplex.set(key, { complex: row.complex, gu: row.gu, count: 0 });
    byComplex.get(key).count += 1;
  }
  const top = [...byComplex.values()].sort((a, b) => b.count - a.count || a.complex.localeCompare(b.complex, 'ko')).slice(0, limit);
  return { total: active.length, complexes: byComplex.size, top };
}
