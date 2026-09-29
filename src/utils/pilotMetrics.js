/*
 * pilotMetrics.js — 파일럿 지표(조회·문의 전환·유료 의향)의 순수 로직. 브라우저·Node 공용, node:test 로 검증.
 *
 * 방문자를 식별하지 않는다: 서버로 가는 것은 매물 id 와 종류뿐이고, 같은 날 중복은 브라우저 안에서만 거른다.
 * 설계·지표 정의·한계: docs/superpowers/specs/2026-09-29-pilot-metrics-design.md
 */

export const EVENTS = ['view', 'inquiry_tel', 'inquiry_email'];
export const STAFF_ROLES = ['admin', 'owner'];
export const COMMENT_MAX = 500;

export const WILLING_OPTIONS = [
  { value: 'yes', label: '네, 계속 쓰겠습니다' },
  { value: 'depends', label: '가격에 따라 다릅니다' },
  { value: 'no', label: '아니요' },
];

// 파일럿 전에 중개사 인터뷰 결과에 맞춰 고친다. 값을 바꾸면 DB 의 check 제약(마이그레이션)도 같이 바꿔야 한다.
export const PRICE_BANDS = [
  { value: 'lt_10k', label: '월 1만원 미만' },
  { value: '10k_30k', label: '월 1만~3만원' },
  { value: '30k_50k', label: '월 3만~5만원' },
  { value: '50k_100k', label: '월 5만~10만원' },
  { value: 'gte_100k', label: '월 10만원 이상' },
  { value: 'unsure', label: '아직 모르겠습니다' },
];

export const PERIODS = [
  { key: '7', label: '최근 7일', days: 7 },
  { key: '30', label: '최근 30일', days: 30 },
  { key: '90', label: '최근 90일', days: 90 },
  { key: 'all', label: '전체', days: null },
];

const labelOf = (options, value) => options.find((option) => option.value === value)?.label ?? '';
export const willingLabel = (value) => labelOf(WILLING_OPTIONS, value);
export const priceBandLabel = (value) => labelOf(PRICE_BANDS, value);

// ───────────────────────── 날짜 (한국 시간) ─────────────────────────

/** 한국 시간 기준 'YYYY-MM-DD' */
export function kstDay(date = new Date()) {
  const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function shiftDay(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** 오늘을 포함한 최근 days 일. days 가 없으면 전체(양쪽 null) */
export function periodRange(days, today = kstDay()) {
  if (!days) return { from: null, to: null };
  return { from: shiftDay(today, -(days - 1)), to: today };
}

const inRange = (day, from, to) => Boolean(day) && (!from || day >= from) && (!to || day <= to);

// ───────────────────────── 셀지 말지 ─────────────────────────

const BOT_PATTERN = /bot|crawler|spider|slurp|yeti|daumoa|scrap|headless|lighthouse|preview|inspectiontool/i;

export function isBot(userAgent) {
  const ua = String(userAgent ?? '');
  return ua === '' || BOT_PATTERN.test(ua);
}

const sameEmail = (a, b) => Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * 이 조회·문의를 세어야 하는가.
 * viewer: 로그인한 사용자의 프로필({ role, email }) 또는 null.
 */
export function shouldTrack({ event, property, viewer = null, userAgent = '', webdriver = false } = {}) {
  if (!EVENTS.includes(event)) return false;
  if (!property?.id) return false;
  if (webdriver || isBot(userAgent)) return false;
  if (viewer && STAFF_ROLES.includes(viewer.role)) return false; // 검수하느라 여는 것
  if (viewer && sameEmail(viewer.email, property.agent?.email)) return false; // 담당 중개사 본인
  return true;
}

/**
 * 중복 제거 키. 문의는 채널(전화·이메일)을 가리지 않고 매물당 하나다 —
 * 한 사람이 전화와 이메일을 둘 다 눌러도 문의한 방문자는 한 명이고, 그래야 전환율이 100% 를 넘지 않는다.
 * 기록되는 채널은 먼저 누른 쪽이다.
 */
export const trackKey = (event, propertyId) => `${event === 'view' ? 'view' : 'inquiry'}|${propertyId}`;

/**
 * 같은 날 같은 키는 한 번만. store = { day, keys:[] } (localStorage 에 두는 값).
 * 날짜가 바뀌면 목록을 비운다 — 어제 본 매물을 오늘 다시 보면 새 조회다.
 */
export function rememberTracked(store, day, key) {
  const current = store && store.day === day && Array.isArray(store.keys) ? store.keys : [];
  if (current.includes(key)) return { store: { day, keys: current }, fresh: false };
  return { store: { day, keys: [...current, key] }, fresh: true };
}

// ───────────────────────── 집계 ─────────────────────────

/** 문의 ÷ 조회 (%). 조회가 0 이면 null — 0% 라고 하면 "문의가 없었다"는 다른 뜻이 된다 */
export function conversionRate(inquiries, views) {
  if (!views || views <= 0) return null;
  return Math.round((inquiries / views) * 1000) / 10;
}

function emptyTotals() {
  return { views: 0, inquiryTel: 0, inquiryEmail: 0, inquiries: 0 };
}

function addTotals(target, row) {
  const tel = Number(row.inquiry_tel ?? row.inquiryTel) || 0;
  const email = Number(row.inquiry_email ?? row.inquiryEmail) || 0;
  target.views += Number(row.views) || 0;
  target.inquiryTel += tel;
  target.inquiryEmail += email;
  target.inquiries += tel + email;
  return target;
}

/** 매물 id → { views, inquiryTel, inquiryEmail, inquiries } */
export function statsByProperty(listings) {
  const map = new Map();
  for (const row of listings ?? []) {
    if (!row?.property_id) continue;
    if (!map.has(row.property_id)) map.set(row.property_id, emptyTotals());
    addTotals(map.get(row.property_id), row);
  }
  return map;
}

export function totalsOf(listings) {
  return (listings ?? []).reduce(addTotals, emptyTotals());
}

export function summarizeIntents(rows) {
  const list = rows ?? [];
  const count = (value) => list.filter((row) => row.willing === value).length;
  return {
    total: list.length,
    yes: count('yes'),
    depends: count('depends'),
    no: count('no'),
    byBand: PRICE_BANDS
      .map((band) => ({ ...band, count: list.filter((row) => (row.price_band ?? row.priceBand) === band.value).length }))
      .filter((band) => band.count > 0),
  };
}

/**
 * 관리자 화면용 요약. 기간(from~to, 한국 시간 날짜)은 stats·alerts 를 가져올 때 이미 걸러 온다 —
 * 여기서는 "기간 안에 새로 생긴 것"(매물·알림)만 날짜로 센다.
 */
export function buildPilotSummary({ properties = [], stats = {}, intents = [], alerts = [], from = null, to = null } = {}) {
  const statRows = stats.listings ?? [];
  const byId = statsByProperty(statRows);
  const known = new Map(properties.map((p) => [p.id, p]));
  const emailOf = (value) => String(value ?? '').trim().toLowerCase();
  const intentByEmail = new Map(intents.map((row) => [emailOf(row.email), row]));

  const agents = new Map();
  const agentOf = (email, property) => {
    const key = emailOf(email);
    if (!agents.has(key)) {
      agents.set(key, { email: key, name: '', office: '', listings: 0, added: 0, ...emptyTotals(), conversion: null, intent: null });
    }
    const agent = agents.get(key);
    if (property && !agent.name) {
      agent.name = property.agent?.name ?? '';
      agent.office = property.agent?.office ?? '';
    }
    return agent;
  };

  const registered = properties.filter((p) => emailOf(p.agent?.email));
  const isAdded = (p) => p.createdAt && inRange(kstDay(p.createdAt), from, to);
  for (const property of registered) {
    const agent = agentOf(property.agent.email, property);
    agent.listings += 1;
    if (isAdded(property)) agent.added += 1;
  }

  const byListing = [];
  const seen = new Set();
  const traffic = { ...emptyTotals(), agentViews: 0, collectedViews: 0, conversion: null };
  for (const row of statRows) {
    addTotals(traffic, row);
    const email = emailOf(row.agent_email);
    if (email) {
      traffic.agentViews += Number(row.views) || 0;
      addTotals(agentOf(email, known.get(row.property_id)), row);
    } else {
      traffic.collectedViews += Number(row.views) || 0;
    }
  }
  traffic.conversion = conversionRate(traffic.inquiries, traffic.agentViews);

  const listingRow = (id, property, totals, agentEmail) => ({
    id,
    title: property?.title ?? '(삭제된 매물)',
    region: property?.region ?? '',
    agentEmail,
    agentName: property?.agent?.office || property?.agent?.name || '',
    createdAt: property?.createdAt ?? null,
    exists: Boolean(property),
    ...totals,
    // 연락처가 없는 수집 매물은 문의할 수 없으므로 전환율을 내지 않는다
    conversion: agentEmail ? conversionRate(totals.inquiries, totals.views) : null,
  });
  for (const property of registered) {
    seen.add(property.id);
    byListing.push(listingRow(property.id, property, byId.get(property.id) ?? emptyTotals(), emailOf(property.agent.email)));
  }
  for (const row of statRows) {
    if (seen.has(row.property_id)) continue;
    seen.add(row.property_id);
    byListing.push(listingRow(row.property_id, known.get(row.property_id), byId.get(row.property_id), emailOf(row.agent_email)));
  }
  byListing.sort((a, b) => b.inquiries - a.inquiries || b.views - a.views || a.title.localeCompare(b.title, 'ko'));

  for (const [email, row] of intentByEmail) agentOf(email).intent = row;
  const byAgent = [...agents.values()]
    .map((agent) => ({ ...agent, conversion: conversionRate(agent.inquiries, agent.views) }))
    .sort((a, b) => b.listings - a.listings || b.views - a.views || a.email.localeCompare(b.email));

  const activeAlerts = alerts.filter((row) => (row.status ?? 'active') === 'active');
  return {
    period: { from, to },
    listings: {
      total: registered.length,
      verified: registered.filter((p) => p.verified).length,
      added: registered.filter(isAdded).length,
      agents: new Set(registered.map((p) => emailOf(p.agent.email))).size,
    },
    alerts: {
      active: activeAlerts.length,
      added: activeAlerts.filter((row) => row.created_at && inRange(kstDay(row.created_at), from, to)).length,
    },
    traffic,
    intents: summarizeIntents(intents),
    byAgent,
    byListing,
    daily: stats.daily ?? [],
  };
}

// ───────────────────────── 설문 ─────────────────────────

/** 반환 { ok, error } 또는 { ok:true, value:{ willing, price_band, comment } } */
export function validateIntent({ willing, priceBand, comment } = {}) {
  if (!WILLING_OPTIONS.some((option) => option.value === willing)) {
    return { ok: false, error: '계속 쓰실지 골라주세요.' };
  }
  const text = String(comment ?? '').trim();
  if (text.length > COMMENT_MAX) return { ok: false, error: `의견은 ${COMMENT_MAX}자까지 쓸 수 있습니다.` };
  let band = null;
  if (willing !== 'no') {
    if (!PRICE_BANDS.some((option) => option.value === priceBand)) {
      return { ok: false, error: '낼 수 있는 월 요금을 골라주세요.' };
    }
    band = priceBand;
  }
  return { ok: true, value: { willing, price_band: band, comment: text || null } };
}

// ───────────────────────── CSV ─────────────────────────

function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  // 엑셀이 수식으로 실행하지 않게 — 의견란은 누구나 쓸 수 있는 글이다
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** columns: [{ label, value: (row) => 값 }]. 엑셀에서 한글이 깨지지 않게 BOM 을 붙인다 */
export function toCsv(columns, rows) {
  const lines = [columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of rows ?? []) lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
