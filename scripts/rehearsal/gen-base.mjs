/*
 * gen-base.mjs — 리허설용 가짜 실거래 원본 생성. 실제 데이터가 아니다.
 *
 * 번들(public/data/complex_prices.json · properties.json)의 단지·가격 수준을 본떠
 * fetch-trades.py 출력과 같은 형식(CP949, 10열)의 시도별 CSV 17개를 만든다.
 *
 * 사용: node scripts/rehearsal/gen-base.mjs <저장소> <출력 폴더> [--flatten 0.3]
 *   --flatten r   앞쪽 r 비율의 매물은 실거래가 호가 수준으로 내려온 상황 (할인율 0 → 재계산 탈락)
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';

const [repo, outDir] = process.argv.slice(2);
const flattenArg = process.argv.indexOf('--flatten');
const FLATTEN = flattenArg >= 0 ? Number(process.argv[flattenArg + 1]) : 0;

// 결정적 난수 — 같은 번들이면 같은 CSV
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260929);
const pick = (n) => Math.floor(rand() * n);

// 지난달(UTC)까지 36개월 — 수집기(fetch-trades.py --since)가 받는 범위와 맞춘다
function monthsBack(n) {
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based 이번 달 = 1-based 지난달
  if (m === 0) { m = 12; y -= 1; }
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out.reverse();
}
const MONTHS = monthsBack(36);
const RECENT = MONTHS.slice(-12);

const codes = JSON.parse(fs.readFileSync(path.join(repo, 'scripts', '_sigungu_codes.json'), 'utf-8'));
const sidos = [...new Set(Object.values(codes).map((v) => v.split(' ')[0]))];
const prices = JSON.parse(fs.readFileSync(path.join(repo, 'public', 'data', 'complex_prices.json'), 'utf-8'));
const properties = JSON.parse(fs.readFileSync(path.join(repo, 'public', 'data', 'properties.json'), 'utf-8'));

const HEADER = ['시군구', '단지명', '거래금액(만원)', '계약년월', '해제사유발생일', '전용면적(㎡)', '건축년도', '층', '일', '거래유형'];
const bySido = new Map(sidos.map((s) => [s, []]));

function dealing() {
  const r = rand();
  if (r < 0.85) return '중개거래';
  if (r < 0.95) return '직거래';
  return '';
}

function push(sigungu, complex, manwon, ym, area, built, floor, { cancel = '', deal = dealing() } = {}) {
  const sido = sigungu.split(' ')[0];
  if (!bySido.has(sido)) return;
  bySido.get(sido).push([sigungu, complex, String(manwon), ym, cancel, area.toFixed(2), String(built ?? ''), String(floor), String(1 + pick(28)), deal]);
}

// 매물 단지: 기준가 근처 거래를 최근 12개월에 넉넉히 — 재계산에서 할인율이 유지되도록
const listed = new Set();
let listingIndex = 0;
for (const p of properties) {
  const complex = String(p.title ?? '').split(' 전용')[0];
  listingIndex += 1;
  const flat = listingIndex <= properties.length * FLATTEN;
  const base = flat ? Number(p.price) : Number(p.price_basis?.baselinePrice ?? p.actual_transaction_price);
  const area = Number(p.area);
  if (!complex || !Number.isFinite(base) || !Number.isFinite(area)) continue;
  listed.add(`${complex}|${p.region}|${Math.floor(area)}`);
  const dong = String(p.address ?? '').startsWith(p.region) ? String(p.address).slice(p.region.length).trim() : '';
  const sigungu = `${p.region} ${dong || '가상동'}`.trim();
  const floorNum = Number.parseInt(String(p.floor), 10);
  for (let i = 0; i < 9; i += 1) {
    const ym = RECENT[pick(RECENT.length)];
    const manwon = Math.round((base / 10000) * (0.98 + rand() * 0.04));
    const floor = Number.isFinite(floorNum) ? Math.max(1, floorNum + pick(3) - 1) : 4 + pick(8);
    push(sigungu, complex, manwon, ym, area + 0.4, p.built_year ?? 2005, floor, { deal: '중개거래' });
  }
}

// 그 밖의 단지: 중앙값 근처, 36개월에 걸쳐 (해제 2% · 직거래 10% 섞음)
for (const row of prices) {
  if (listed.has(`${row.complex}|${row.gu}|${row.area_m2}`)) continue;
  const n = Math.max(6, Math.min(24, Number(row.sample_size) || 6));
  for (let i = 0; i < n; i += 1) {
    const ym = i < 4 ? RECENT[pick(RECENT.length)] : MONTHS[pick(MONTHS.length)];
    const manwon = Math.round((row.median_price / 10000) * (0.94 + rand() * 0.12));
    const cancel = rand() < 0.02 ? `${ym.slice(2, 4)}.${ym.slice(4)}.28` : '';
    push(row.sigungu, row.complex, manwon, ym, row.area_m2 + 0.5, row.built_year ?? 2005, 1 + pick(22), { cancel });
  }
}

const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
fs.mkdirSync(outDir, { recursive: true });
let total = 0;
for (const [sido, rows] of bySido) {
  rows.sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
  const text = `${[HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
  fs.writeFileSync(path.join(outDir, `api_${sido}.csv`), iconv.encode(text, 'cp949'));
  total += rows.length;
}
console.log(`가짜 원본 ${bySido.size}개 시도 · ${total}행 · ${MONTHS[0]}~${MONTHS[MONTHS.length - 1]}`);
