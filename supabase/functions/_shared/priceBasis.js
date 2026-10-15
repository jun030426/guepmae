/*
 * priceBasis.js — 급매 판정(기준 실거래가 산출) 공통 로직. 브라우저·Node 공용 순수 함수.
 *
 * 앱(등록·미리보기)과 파이프라인(recompute-price-basis.mjs)이 같은 함수를 쓴다.
 * 규칙: docs/superpowers/specs/2026-09-29-price-basis-judgment-design.md §4
 *
 *   0. 제외   해제(취소) 거래, 직거래
 *   1. 면적   동일 전용면적 36개월 표본 ≥ 3 → 아니면 ±2㎡ 중 표본 최다 면적(approxArea)
 *   2. 기간   최근 12개월 표본 ≥ 3 → 12 / 24 / 36 → 전부 미달이면 판정 보류
 *   3. 층     같은 층 구간 거래가 그 기간 안에 ≥ 3 이면 그 거래만 (floorAdjusted)
 *   4. 기준가 선택된 거래들의 중앙값 (추정 없음)
 *
 * 거래 표준 형태: { areaM2, yearMonth:'YYYY-MM', day, price(원), floor:number|null, dealing:'b'|'d'|'', canceled?:bool }
 */

export const MIN_SAMPLE = 3;
export const MIN_DISC = 5;
export const MAX_DISC = 40;
export const WINDOWS = [12, 24, 36];
export const HIGH_BAND_MIN_MAX_FLOOR = 10;

// ───────────────────────── 기본 유틸 ─────────────────────────

/** 짝수 개일 때 내림 정수 나눗셈 — import-listings.py / recompute-price-basis.mjs 와 동일 규칙 */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

/** 'YYYY-MM' 에 delta 개월을 더한다 (음수 가능). */
export function shiftMonth(ym, delta) {
  const [y, m] = String(ym).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym;
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** 최근 n 개월 창의 첫 달 (asOf 포함). */
export function windowStart(asOf, months) {
  return shiftMonth(asOf, -(months - 1));
}

export function normalizeDealing(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/직거래|^d$|^direct$/.test(s)) return 'd';
  if (/중개|^b$|^brokered$/.test(s)) return 'b';
  return '';
}

/**
 * 층 파싱 — 숫자("12층", "12"), 텍스트("저층/중층/고층"), 지하("B1", "반지하") 대응.
 * 반환 { floor: number|null, band: 'low'|'mid'|'high'|null } — band 는 텍스트로만 채워진다.
 */
export function parseFloor(value) {
  if (value == null || value === '') return { floor: null, band: null };
  if (typeof value === 'number') return { floor: Number.isFinite(value) ? value : null, band: null };
  const s = String(value).trim();
  if (/반지하|지하|^b\d/i.test(s)) return { floor: 0, band: null };
  const num = s.match(/(-?\d+)\s*층?/);
  if (num) return { floor: Number(num[1]), band: null };
  if (/저층/.test(s)) return { floor: null, band: 'low' };
  if (/중층/.test(s)) return { floor: null, band: 'mid' };
  if (/고층|탑층|최상층|꼭대기/.test(s)) return { floor: null, band: 'high' };
  return { floor: null, band: null };
}

/** 층 구간: 저층 1~3층 / 고층 최고층 ≥ 10 일 때 상위 3개 층 / 나머지 중층 */
export function floorBandOf(floor, maxFloor) {
  if (floor == null || !Number.isFinite(floor)) return null;
  if (floor <= 3) return 'low';
  if (maxFloor != null && maxFloor >= HIGH_BAND_MIN_MAX_FLOOR && floor >= maxFloor - 2) return 'high';
  return 'mid';
}

export function bandLabel(band, maxFloor) {
  if (band === 'low') return '저층(1~3층)';
  if (band === 'high') return maxFloor != null ? `고층(${maxFloor - 2}~${maxFloor}층)` : '고층';
  if (band === 'mid') {
    const top = maxFloor != null && maxFloor >= HIGH_BAND_MIN_MAX_FLOOR ? maxFloor - 3 : maxFloor;
    return top != null && top >= 4 ? `중층(4~${top}층)` : '중층(4층 이상)';
  }
  return '';
}

// ───────────────────────── 거래 정규화 ─────────────────────────

/**
 * 여러 출처의 거래를 표준 형태로.
 *  - recompute 인덱스: { a, ym, d, fl, p, dl }
 *  - 압축 배열(complex_trades 행): [ym, day, price, floor, dealing]  (areaM2 는 defaults 로)
 *  - 표준 형태 그대로
 */
export function normalizeTrade(raw, defaults = {}) {
  if (!raw) return null;
  let t;
  if (Array.isArray(raw)) {
    const [ym, day, price, floor, dealing] = raw;
    t = { areaM2: defaults.areaM2, yearMonth: ym, day, price, floor, dealing };
  } else if ('ym' in raw || 'p' in raw) {
    t = { areaM2: raw.a ?? defaults.areaM2, yearMonth: raw.ym, day: raw.d, price: raw.p, floor: raw.fl, dealing: raw.dl, canceled: raw.canceled };
  } else {
    t = { ...raw };
    if (t.areaM2 == null) t.areaM2 = defaults.areaM2;
  }
  const price = Number(t.price);
  const areaM2 = Number(t.areaM2);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(areaM2)) return null;
  if (!/^\d{4}-\d{2}$/.test(String(t.yearMonth ?? ''))) return null;
  const floorParsed = parseFloor(t.floor);
  return {
    areaM2: Math.floor(areaM2),
    yearMonth: String(t.yearMonth),
    day: t.day == null ? '' : String(t.day),
    price,
    floor: floorParsed.floor,
    dealing: normalizeDealing(t.dealing),
    canceled: Boolean(t.canceled),
  };
}

/** complex_trades 행({ area_m2, trades:[[…]] }) → 표준 거래 목록 */
export function expandTradeRow(row) {
  if (!row || !Array.isArray(row.trades)) return [];
  const areaM2 = Number(row.area_m2 ?? row.areaM2);
  return row.trades.map((t) => normalizeTrade(t, { areaM2 })).filter(Boolean);
}

// ───────────────────────── 판정 ─────────────────────────

function round1(value) {
  return Math.round(value * 10) / 10;
}

function confidenceOf(sampleSize) {
  return sampleSize >= 5 ? 'high' : 'medium';
}

/** 판정 보류 근거 객체. reason: 'no_data' | 'low_sample' */
export function heldBasis(reason, extra = {}) {
  return {
    source: 'complex',
    status: 'insufficient',
    reason,
    baselinePrice: null,
    discountRate: null,
    sampleSize: extra.totalSample36 ?? 0,
    confidence: 'none',
    ...extra,
    method: extra.method ?? (reason === 'no_data' ? '단지 실거래 데이터 없음 — 판정 보류' : '표본 부족 — 판정 보류'),
  };
}

/**
 * 판정. trades 는 단지 전체(모든 면적) 또는 해당 면적만 넘겨도 된다.
 * 반환: price_basis 객체(§5) + discountRate. 보류면 status 'insufficient'.
 */
export function computePriceBasis({ trades, areaM2, floor, price, asOf, computedAt } = {}) {
  const requestedAreaM2 = Math.floor(Number(areaM2));
  const all = (Array.isArray(trades) ? trades : []).map((t) => normalizeTrade(t)).filter(Boolean);
  const stamp = computedAt ?? new Date().toISOString().slice(0, 10);

  if (all.length === 0 || !Number.isFinite(requestedAreaM2)) {
    return heldBasis('no_data', { requestedAreaM2, areaM2: requestedAreaM2, computedAt: stamp, dataAsOf: asOf ?? null });
  }

  const excludedCanceled = all.filter((t) => t.canceled).length;
  const live = all.filter((t) => !t.canceled);
  const usable = live.filter((t) => t.dealing !== 'd');
  const dataAsOf = asOf ?? live.reduce((max, t) => (t.yearMonth > max ? t.yearMonth : max), '');
  const start36 = windowStart(dataAsOf, 36);
  const in36 = (t) => t.yearMonth >= start36 && t.yearMonth <= dataAsOf;

  // 1. 면적: 동일 면적 우선, 부족하면 ±2㎡ 중 표본 최다
  let chosenArea = requestedAreaM2;
  let approxArea = false;
  let pool36 = usable.filter((t) => t.areaM2 === requestedAreaM2 && in36(t));
  if (pool36.length < MIN_SAMPLE) {
    const counts = new Map();
    for (const t of usable) {
      if (!in36(t) || t.areaM2 === requestedAreaM2) continue;
      if (Math.abs(t.areaM2 - requestedAreaM2) <= 2) counts.set(t.areaM2, (counts.get(t.areaM2) ?? 0) + 1);
    }
    let best = null;
    for (const [area, count] of counts) {
      if (count >= MIN_SAMPLE && (!best || count > best.count)) best = { area, count };
    }
    if (best) {
      chosenArea = best.area;
      approxArea = true;
      pool36 = usable.filter((t) => t.areaM2 === chosenArea && in36(t));
    }
  }
  const excludedDirect = live.filter((t) => t.dealing === 'd' && t.areaM2 === chosenArea && in36(t)).length;

  if (pool36.length < MIN_SAMPLE) {
    const n = pool36.length;
    return heldBasis('low_sample', {
      requestedAreaM2,
      areaM2: chosenArea,
      approxArea,
      totalSample36: n,
      excludedDirect,
      excludedCanceled,
      dataAsOf,
      computedAt: stamp,
      method: `동일 단지 ${chosenArea}㎡ 최근 36개월 실거래 ${n}건 — 표본 부족(${MIN_SAMPLE}건 미만)으로 판정 보류`,
    });
  }

  // 2. 기간: 최소 창 우선
  let windowMonths = 36;
  let pool = pool36;
  for (const months of WINDOWS) {
    const start = windowStart(dataAsOf, months);
    const candidate = pool36.filter((t) => t.yearMonth >= start);
    if (candidate.length >= MIN_SAMPLE) {
      windowMonths = months;
      pool = candidate;
      break;
    }
  }

  // 3. 층 구간
  const floorsSeen = pool36.map((t) => t.floor).filter((f) => f != null && Number.isFinite(f));
  const maxFloor = floorsSeen.length ? Math.max(...floorsSeen) : null;
  const parsed = parseFloor(floor);
  const listingFloor = parsed.floor;
  const band = parsed.band ?? (listingFloor != null ? floorBandOf(listingFloor, maxFloor) : null);
  let selected = pool;
  let floorAdjusted = false;
  if (band) {
    const same = pool.filter((t) => t.floor != null && floorBandOf(t.floor, maxFloor) === band);
    if (same.length >= MIN_SAMPLE) {
      selected = same;
      floorAdjusted = true;
    }
  }

  // 4. 기준가·할인율
  const baselinePrice = median(selected.map((t) => t.price));
  const months = selected.map((t) => t.yearMonth);
  const periodStart = months.reduce((min, m) => (m < min ? m : min), months[0]);
  const periodEnd = months.reduce((max, m) => (m > max ? m : max), months[0]);
  const listingPrice = Number(price);
  const discountRate = Number.isFinite(listingPrice) && listingPrice > 0
    ? round1(((baselinePrice - listingPrice) / baselinePrice) * 100)
    : null;

  const basis = {
    source: 'complex',
    status: 'ok',
    reason: null,
    baselinePrice,
    areaM2: chosenArea,
    requestedAreaM2,
    approxArea,
    windowMonths,
    periodStart,
    periodEnd,
    sampleSize: selected.length,
    floorBand: band,
    floorAdjusted,
    listingFloor,
    maxFloor,
    excludedDirect,
    excludedCanceled,
    totalSample36: pool36.length,
    median36: median(pool36.map((t) => t.price)),
    confidence: confidenceOf(selected.length),
    dataAsOf,
    computedAt: stamp,
    discountRate,
  };
  basis.method = formatBasisMethod(basis);
  return basis;
}

/** complex_prices 행(36개월 전체 중앙값)만 있을 때의 폴백 근거 — 시점·층 보정 없음을 명시 */
export function basisFromComplexRow(row, { requestedAreaM2, approxArea = false, price, computedAt } = {}) {
  const baselinePrice = Number(row.median_price);
  const sampleSize = Number(row.sample_size) || 0;
  const listingPrice = Number(price);
  const basis = {
    source: 'complex',
    status: 'ok',
    reason: null,
    baselinePrice,
    areaM2: Number(row.area_m2),
    requestedAreaM2: requestedAreaM2 ?? Number(row.area_m2),
    approxArea,
    windowMonths: 36,
    periodStart: row.earliest_year_month ?? null,
    periodEnd: row.latest_year_month ?? null,
    sampleSize,
    floorBand: null,
    floorAdjusted: false,
    listingFloor: null,
    maxFloor: null,
    excludedDirect: 0,
    excludedCanceled: 0,
    totalSample36: sampleSize,
    median36: baselinePrice,
    confidence: confidenceOf(sampleSize),
    dataAsOf: row.latest_year_month ?? null,
    computedAt: computedAt ?? new Date().toISOString().slice(0, 10),
    discountRate: Number.isFinite(listingPrice) && listingPrice > 0
      ? round1(((baselinePrice - listingPrice) / baselinePrice) * 100)
      : null,
    fallback: 'complex_prices',
  };
  const period = basis.periodStart && basis.periodEnd ? `${basis.periodStart}~${basis.periodEnd} ` : '';
  basis.method = `동일 단지 ${basis.areaM2}㎡${approxArea ? `(요청 ${basis.requestedAreaM2}㎡ 근접)` : ''} · ${period}${sampleSize}건 중앙값 (전체 기간 · 층 보정 없음)`;
  return basis;
}

// ───────────────────────── 표시 ─────────────────────────

export function formatBasisMethod(basis) {
  if (!basis) return '';
  if (basis.status === 'insufficient') return basis.method ?? '판정 보류';
  const parts = [`동일 단지 ${basis.areaM2}㎡${basis.approxArea ? `(요청 ${basis.requestedAreaM2}㎡ 근접)` : ''}`];
  if (basis.floorAdjusted) parts.push(bandLabel(basis.floorBand, basis.maxFloor));
  parts.push(`최근 ${basis.windowMonths}개월 ${basis.sampleSize}건 중앙값`);
  if (basis.excludedDirect > 0) parts.push(`직거래 ${basis.excludedDirect}건 제외`);
  return parts.join(' · ');
}

/** 옛 형태(status 없음) 근거도 'ok' 로 다룬다. */
export function isHeld(basis) {
  return basis?.status === 'insufficient';
}

export function isNewBasis(basis) {
  return Boolean(basis && basis.status && basis.windowMonths != null);
}

/** 화면의 "산출 조건" 목록 — 라벨/값 쌍. 신형 근거에서만 채워진다. */
export function basisConditions(basis) {
  // 옛 형태(창·층 정보 없음)나 보류 근거에는 조건을 지어내지 않는다
  if (!basis || basis.status !== 'ok' || basis.windowMonths == null) return [];
  const out = [];
  if (basis.windowMonths != null) {
    const period = basis.periodStart && basis.periodEnd ? ` (${basis.periodStart}~${basis.periodEnd})` : '';
    out.push({ label: '기간', value: basis.fallback ? `전체 기간${period}` : `최근 ${basis.windowMonths}개월${period}` });
  }
  if (basis.fallback) {
    out.push({ label: '층 구간', value: '보정 없음 (개별 거래 데이터 미보유)' });
  } else if (basis.floorAdjusted) {
    out.push({ label: '층 구간', value: `${bandLabel(basis.floorBand, basis.maxFloor)} 거래만 사용` });
  } else if (basis.floorBand) {
    out.push({ label: '층 구간', value: `${bandLabel(basis.floorBand, basis.maxFloor)} 거래 ${MIN_SAMPLE}건 미만 → 전체 층 사용` });
  } else {
    out.push({ label: '층 구간', value: '층 정보 없음 → 전체 층 사용' });
  }
  const excluded = ['해제 거래'];
  if (basis.excludedDirect > 0) excluded.push(`직거래 ${basis.excludedDirect}건`);
  out.push({ label: '제외', value: excluded.join(' · ') });
  if (basis.totalSample36 != null && basis.median36 != null && !basis.fallback) {
    out.push({ label: '참고', value: `36개월 전체 ${basis.totalSample36}건 중앙값`, price: basis.median36 });
  }
  return out;
}

/** 목록·표에서 쓰는 할인율 표기. 보류·미산출이면 '판정 보류'. */
export function discountLabel(discountRate) {
  if (discountRate == null || !Number.isFinite(Number(discountRate))) return '판정 보류';
  const n = Number(discountRate);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}
