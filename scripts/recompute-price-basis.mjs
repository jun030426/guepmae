/*
 * recompute-price-basis.mjs
 *
 * public/data/properties.json 의 매물 할인율 근거를 최신 complex_prices.csv 로 다시 계산한다.
 * 실거래를 갱신하면 6월 기준선으로 박제된 price_basis 가 새 중앙값과 어긋나기 때문이다.
 *
 * price_basis(할인율 근거) 뿐 아니라 화면에 나란히 노출되는 증거 필드(표A 평형별 요약,
 * 표B 최근 실거래 내역, 시세추이 차트, urgent_score, recent_transaction_date)도 같은
 * complex_trades.csv 로 함께 갱신한다 — 그렇지 않으면 페이지 위에서 주장(claim)과 근거가
 * 서로 어긋나는 상태로 남는다.
 *
 * 기준가는 src/utils/priceBasis.js 의 판정 규칙(앱과 동일)으로 구한다 — 해제·직거래 제외 →
 * 최근 12/24/36개월 창 → 같은 층 구간 → 중앙값. 개별 실거래(complex_trades.csv)가 없는 단지는
 * complex_prices 중앙값(전체 기간·층 보정 없음)으로 폴백한다.
 *
 * 재계산 후 판정 보류이거나 할인율이 MIN_DISC 아래·MAX_DISC 위면 "검증된 급매"가 아니므로 제외한다.
 *
 * 실행:
 *   node scripts/recompute-price-basis.mjs 강원            # 미리보기
 *   node scripts/recompute-price-basis.mjs 강원 --write    # public/data/properties.json 갱신
 *   node scripts/recompute-price-basis.mjs --all --write   # 전 지역
 */

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';
import {
  basisFromComplexRow,
  computePriceBasis,
  MAX_DISC as BASIS_MAX_DISC,
  MIN_DISC as BASIS_MIN_DISC,
  MIN_SAMPLE as BASIS_MIN_SAMPLE,
} from '../src/utils/priceBasis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// import-listings.py:19 및 src/utils/priceBasis.js 와 같은 값
export const MIN_SAMPLE = BASIS_MIN_SAMPLE;
export const MIN_DISC = BASIS_MIN_DISC;
export const MAX_DISC = BASIS_MAX_DISC;

export function normalizeComplex(name) {
  return String(name ?? '').replace(/\s+|아파트/g, '').trim();
}

// import-listings.py:norm2 와 같은 규칙 — 괄호 내용을 먼저 지운 뒤 normalizeComplex
export function normalizeComplex2(name) {
  return normalizeComplex(String(name ?? '').replace(/\(.*?\)/g, ''));
}

// import-listings.py 의 `cp[gu][norm(complex)] = {"orig", "n2", "rows": [...]}` 와 같은 모양.
// index: Map<gu, Map<normalizedComplexKey, {orig, n2, rows}>>
export function buildComplexIndex(csvText) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const index = new Map();
  for (const rec of records) {
    const gu = String(rec.gu ?? '').trim();
    const key = normalizeComplex(rec.complex);
    const row = {
      complex: rec.complex,
      area_m2: Number(rec.area_m2),
      median_price: Number(rec.median_price),
      sample_size: Number(rec.sample_size),
      earliest_year_month: rec.earliest_year_month,
      latest_year_month: rec.latest_year_month,
    };
    if (!index.has(gu)) index.set(gu, new Map());
    const g = index.get(gu);
    if (!g.has(key)) {
      g.set(key, { orig: rec.complex, n2: normalizeComplex2(rec.complex), rows: [] });
    }
    g.get(key).rows.push(row);
  }
  return index;
}

// import-listings.py:resolve_complex 와 동일한 3단계 매칭.
// 1) norm 완전일치  2) norm2 일치(후보 1개일 때만)  3) norm2 부분포함(후보 1개일 때만)
// 두 후보 이상이면 모호하므로 null — 이 가드가 없으면 엉뚱한 단지에 조용히 매칭된다.
// 반환값은 rows 배열이 아니라 entry 전체({orig, n2, rows}) — complex_trades.csv 매칭에
// 필요한 단지 정식명(orig)을 호출자가 함께 얻기 위함.
export function resolveComplex(name, gu, index) {
  const g = index.get(String(gu ?? '').trim());
  if (!g) return null;

  const n = normalizeComplex(name);
  const n2 = normalizeComplex2(name);

  if (g.has(n)) return g.get(n);

  const cand = [...g.values()].filter((v) => v.n2 === n2 && n2.length >= 3);
  if (cand.length === 1) return cand[0];

  const sub = [...g.entries()].filter(
    ([key, v]) => key.length >= 3 && n2.length >= 3 && (n2.includes(key) || key.includes(n2))
  );
  return sub.length === 1 ? sub[0][1] : null;
}

function pickBaseline(rows, areaM2) {
  const usable = rows.filter((r) => r.sample_size >= MIN_SAMPLE);
  const exact = usable.find((r) => r.area_m2 === areaM2);
  if (exact) return { row: exact, approx: false };
  const near = usable
    .filter((r) => Math.abs(r.area_m2 - areaM2) <= 2)
    .sort((a, b) => b.sample_size - a.sample_size)[0];
  return near ? { row: near, approx: true } : null;
}

// ---------- complex_trades.csv (개별 실거래) — import-listings.py 의
// load_complex_trades / _median / area_summary / recent_trades / real_history 포팅 ----------

// needed 매물 단지만 골라야 하는 트레이드 CSV 는 104MB/145만행이라 항상 스트리밍한다.
// (gu, complex) 조합을 키로 쓴다 — complex 는 complex_prices.csv 가 돌려준 entry.orig(정식명).
export function makeTradeKey(gu, complex) {
  return `${gu}${complex}`;
}

// CSV 한 줄을 필드 배열로 분리한다. complex_trades.csv 는 콤마가 들어간 단지명을
// "대동1,2차" 처럼 큰따옴표로 감싸므로 단순 split(',') 로는 깨진다.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// import-listings.py:load_complex_trades 의 한 행 처리와 동일한 필터/파싱 규칙.
// header: complex,gu,area_m2,year_month,day,floor,price[,dealing]  (dealing: direct/brokered/빈값)
function ingestTradeLine(line, needed, map) {
  if (!line) return;
  const fields = parseCsvLine(line);
  if (fields.length < 7) return;
  const [complex, gu, areaStr, ym, day, floor, priceStr, dealingRaw] = fields;
  const key = makeTradeKey(gu, complex);
  if (!needed.has(key)) return;
  const a = Number.parseInt(areaStr, 10);
  const p = Number.parseInt(priceStr, 10);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return; // python: try/except: pass
  const dl = dealingRaw === 'direct' ? 'd' : dealingRaw === 'brokered' ? 'b' : '';
  if (!map.has(key)) map.set(key, []);
  map.get(key).push({ a, ym, d: day ?? '', fl: floor ?? '', p, dl });
}

// 테스트/픽스처용 동기 버전 — 인라인 CSV 문자열을 그대로 파싱한다(104MB 실 파일은 절대
// 이 경로로 읽지 않는다; 실행 경로는 아래 loadTradesIndexFromFile 의 스트리밍을 쓴다).
export function buildTradesIndex(csvText, needed) {
  const map = new Map();
  const lines = String(csvText ?? '').split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) { // 0번째는 헤더
    ingestTradeLine(lines[i], needed, map);
  }
  return map;
}

// 실행 경로: node:readline 으로 read stream 을 한 줄씩 흘려보내며 needed 매물 단지만 적재한다.
// complex_trades.csv 전체(104MB, ~145만행)를 메모리에 올리지 않는다.
async function loadTradesIndexFromFile(csvPath, needed) {
  const map = new Map();
  if (!fs.existsSync(csvPath)) return map;
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; } // 헤더 skip
    ingestTradeLine(line, needed, map);
  }
  return map;
}

// import-listings.py:_median — 짝수 개일 때 평균이 아니라 정수 나눗셈(내림)으로 마무리한다.
// 두 값의 합이 홀수면 소수 .5 가 아니라 그보다 작은 정수가 되어야 하므로 Math.floor 를 쓴다.
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return s[mid];
  return Math.floor((s[mid - 1] + s[mid]) / 2);
}

// import-listings.py 의 (year_month, day) 튜플 정렬 — day 는 CSV 원문 그대로의 문자열이라
// 자리수를 맞추지 않은 "4", "15" 형태다. Python 은 이걸 문자열로 비교하므로 "15" < "4" 다.
// 동일 월 내 tie-break 에만 영향을 주는 의도된 quirk — 여기서 고치지 않고 그대로 이식한다.
function compareYmDay(a, b) {
  if (a.ym < b.ym) return -1;
  if (a.ym > b.ym) return 1;
  if (a.d < b.d) return -1;
  if (a.d > b.d) return 1;
  return 0;
}

function compareYmDayDesc(a, b) {
  return compareYmDay(b, a);
}

// import-listings.py:area_summary — 표A. 단지의 평형별 요약, 면적 오름차순.
export function areaSummary(trades, myArea) {
  const by = new Map();
  for (const t of trades) {
    if (!by.has(t.a)) by.set(t.a, []);
    by.get(t.a).push(t);
  }
  const areas = [...by.keys()].sort((a, b) => a - b);
  const out = [];
  for (const a of areas) {
    const ts = [...by.get(a)].sort(compareYmDay);
    const ps = ts.map((t) => t.p);
    out.push({
      areaM2: a,
      count: ts.length,
      recentPrice: ts[ts.length - 1].p,
      recentMonth: ts[ts.length - 1].ym,
      minPrice: Math.min(...ps),
      maxPrice: Math.max(...ps),
      isMine: a === myArea,
    });
  }
  return out;
}

// import-listings.py:recent_trades — 표B. 내 평형 최근 실거래, 최신순, limit 개.
// Python 의 sorted(..., reverse=True) 는 안정 정렬을 유지한 채 내림차순이라(동률의 원래
// 순서를 뒤집지 않음), "오름차순 정렬 후 reverse()" 가 아니라 비교자 자체를 뒤집는다.
export function recentTrades(trades, myArea, limit = 30) {
  const ts = trades.filter((t) => t.a === myArea).sort(compareYmDayDesc);
  return ts.slice(0, limit).map((t) => ({
    yearMonth: t.ym,
    day: t.d,
    areaM2: t.a,
    floor: t.fl,
    price: t.p,
    dealing: t.dl ?? '', // 'd' 직거래(기준가 제외 표시) / 'b' 중개 / '' 미상
  }));
}

// import-listings.py:real_history — 시세추이 차트. 내 평형 월별 실거래 중앙값(재생산 없음).
export function realHistory(trades, myArea) {
  const by = new Map();
  for (const t of trades) {
    if (t.a !== myArea) continue;
    if (!by.has(t.ym)) by.set(t.ym, []);
    by.get(t.ym).push(t.p);
  }
  const months = [...by.keys()].sort();
  return months.map((ym) => ({
    month: ym.slice(2).replaceAll('-', '.'),
    yearMonth: ym,
    price: median(by.get(ym)),
    count: by.get(ym).length,
  }));
}

// 매물 제목 "<단지명> 전용NN㎡ ..." 에서 단지명을 뗀다
export function complexNameOf(property) {
  return String(property.title ?? '').split(' 전용')[0];
}

// tradesIndex: Map<makeTradeKey(gu, complex), trade[]> — 있으면 판정 규칙(기간·층·직거래 제외),
// 없으면 complex_prices 중앙값 폴백(전체 기간·층 보정 없음).
// 반환 { result, reason } — result 가 null 이면 reason 이 제외 사유(로그·집계용).
export function recomputeDecision(property, index, today, tradesIndex = new Map()) {
  const entry = resolveComplex(complexNameOf(property), property.region, index);
  if (!entry) return { result: null, reason: '단지 미매칭' };

  const areaM2 = Number(property.area);
  const price = Number(property.price);
  const gu = String(property.region ?? '').trim();
  const trades = tradesIndex.get(makeTradeKey(gu, entry.orig)) ?? [];

  let basis;
  if (trades.length > 0) {
    const asOf = trades.reduce((max, t) => (t.ym > max ? t.ym : max), '');
    basis = computePriceBasis({ trades, areaM2, floor: property.floor, price, asOf, computedAt: today });
    if (basis.status !== 'ok') {
      return {
        result: null,
        reason: basis.reason === 'no_data' ? '판정 보류(데이터 없음)' : `판정 보류(36개월 표본 ${basis.totalSample36 ?? 0}건)`,
      };
    }
  } else {
    const picked = pickBaseline(entry.rows, areaM2);
    if (!picked) return { result: null, reason: '판정 보류(중앙값 표본 부족)' };
    basis = basisFromComplexRow(picked.row, { requestedAreaM2: areaM2, approxArea: picked.approx, price, computedAt: today });
  }

  const discount = basis.discountRate;
  if (discount == null || discount < MIN_DISC) return { result: null, reason: '할인율 기준 미달' };
  if (discount > MAX_DISC) return { result: null, reason: '할인율 이상치(40% 초과)' };

  const { discountRate: _basisDiscount, ...basisFields } = basis;
  return {
    reason: null,
    result: {
      actual_transaction_price: basis.baselinePrice,
      discount_rate: discount,
      urgent_score: Math.min(99, Math.round(50 + discount * 3)),
      recent_transaction_date: `${basis.periodEnd}-01`,
      price_history: realHistory(trades, areaM2),
      // 기존 필드(coordSource 등)는 보존하고 판정 필드로 덮어쓴다
      price_basis: { ...(property.price_basis ?? {}), ...basisFields },
      price_table: {
        complexName: entry.orig,
        myAreaM2: areaM2,
        basisPeriod: '최근 3년 실거래',
        areaSummary: areaSummary(trades, areaM2),
        recentTrades: recentTrades(trades, areaM2, 30),
      },
    },
  };
}

export function recomputeBasis(property, index, today, tradesIndex = new Map()) {
  return recomputeDecision(property, index, today, tradesIndex).result;
}

async function main() {
  const prefix = process.argv[2];
  const write = process.argv.includes('--write');
  if (!prefix) {
    console.error('사용: node scripts/recompute-price-basis.mjs <지역접두사|--all> [--write]');
    process.exit(1);
  }
  const everyRegion = prefix === '--all' || prefix === '전체';
  const matches = (p) => everyRegion || String(p.region ?? '').startsWith(prefix);

  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_prices.csv');
  const index = buildComplexIndex(fs.readFileSync(csvPath, 'utf8'));
  const bundlePath = path.join(projectRoot, 'public', 'data', 'properties.json');
  const all = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  const candidates = all.filter(matches);

  // 1차 패스: 단지만 매칭해 필요한 (gu, 단지 정식명) 조합을 모은다 — 판정은 개별 실거래가 있어야
  // 하므로 여기서 하지 않는다. 104MB 트레이드 CSV 는 이 조합만 스트리밍 적재한다.
  const needed = new Set();
  for (const property of candidates) {
    const entry = resolveComplex(complexNameOf(property), property.region, index);
    if (entry) needed.add(makeTradeKey(String(property.region ?? '').trim(), entry.orig));
  }

  const tradesPath = path.join(projectRoot, 'scripts', 'output', 'complex_trades.csv');
  const tradesIndex = await loadTradesIndexFromFile(tradesPath, needed);
  if (tradesIndex.size === 0) {
    console.warn('[재계산] ⚠ complex_trades.csv 가 없거나 매칭 단지가 없어 중앙값 테이블 폴백(전체 기간·층 보정 없음)으로 계산합니다.');
  }

  let touched = 0;
  const dropped = new Map(); // 사유 → 건수
  const kept = [];
  for (const property of all) {
    if (!matches(property)) { kept.push(property); continue; }
    const { result, reason } = recomputeDecision(property, index, today, tradesIndex);
    if (!result) {
      dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
      console.log(`  제외 ${property.title} (${property.region}) — ${reason}`);
      continue;
    }
    touched += 1;
    kept.push({ ...property, ...result, last_verified_at: today });
  }

  const droppedTotal = [...dropped.values()].reduce((sum, n) => sum + n, 0);
  console.log('-'.repeat(40));
  console.log(`[재계산] ${everyRegion ? '전체' : prefix}: 갱신 ${touched}건 / 제외 ${droppedTotal}건 / 전체 ${all.length} → ${kept.length}건`);
  for (const [reason, n] of dropped) console.log(`  - ${reason}: ${n}건`);
  if (!write) {
    console.log('[재계산] 미리보기입니다. 반영하려면 --write 를 붙이세요.');
    return;
  }
  fs.writeFileSync(bundlePath, JSON.stringify(kept), 'utf8');
  console.log('[재계산] 기록: public/data/properties.json');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
