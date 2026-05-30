/*
 * verify-report-snapshot.mjs (일회성 검증 — 보존/삭제 사용자 결정)
 *
 * scripts/data/ 17개 CSV에서 직접 집계해서 라이브 seed SQL의
 * Top 10·인사이트·지역 평균이 정직한지 검증.
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

const dataDir = path.resolve('scripts/data');
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.csv'));

function readCsv(p) {
  const buf = fs.readFileSync(p);
  const text = iconv.decode(buf, 'cp949');
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex(
    (l) => /시군구/.test(l) && /(거래금액|단지명|전용면적)/.test(l),
  );
  if (hi === -1) return [];
  return parse(lines.slice(hi).join('\n'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
}

const pick = (r, ks) => ks.map((k) => r[k]).find((v) => v !== undefined && v !== '');
const parseAmount = (raw) => {
  const c = String(raw ?? '').replace(/[^0-9-]/g, '');
  return c ? Number(c) * 10000 : null;
};
const parseArea = (raw) => {
  const v = Number(String(raw ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(v) ? v : null;
};
const parseMonth = (raw) => {
  const c = String(raw ?? '').replace(/[^0-9]/g, '');
  return c.length === 6 ? `${c.slice(0, 4)}-${c.slice(4, 6)}` : null;
};
const getBucket = (a) => {
  if (a == null) return '미상';
  if (a <= 60) return '60㎡ 이하';
  if (a <= 85) return '60–85㎡';
  if (a <= 102) return '85–102㎡';
  if (a <= 135) return '102–135㎡';
  return '135㎡ 초과';
};
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
};
const getRegion1 = (s) =>
  s?.trim().split(/\s+/)[0]?.replace(/특별시$|광역시$|특별자치시$|특별자치도$|도$/, '').trim() ?? null;

// === 1. 전체 로드 ===
const all = [];
for (const f of files) {
  const rows = readCsv(path.join(dataDir, f));
  for (const r of rows) {
    const sigungu = pick(r, ['시군구', '시군구명']);
    const complex = pick(r, ['단지명', '아파트', '아파트명']);
    const area = parseArea(pick(r, ['전용면적(㎡)', '전용면적', '면적']));
    const amount = parseAmount(pick(r, ['거래금액(만원)', '거래금액', '금액']));
    const month = parseMonth(pick(r, ['계약년월', '계약년월일']));
    if (!sigungu || !complex || amount == null) continue;
    all.push({
      sigungu: sigungu.trim(),
      complex: complex.trim(),
      region1: getRegion1(sigungu),
      area,
      bucket: getBucket(area),
      amount,
      month,
    });
  }
}
console.log('=== 전체 ===');
console.log('CSV 17개 합계 정상 행:', all.length);
const byMonth = new Map();
for (const r of all) if (r.month) byMonth.set(r.month, (byMonth.get(r.month) || 0) + 1);
console.log('월별 분포:');
for (const [m, c] of [...byMonth.entries()].sort()) console.log(`  ${m}: ${c.toLocaleString()}건`);

// === 2. 라이브 seed가 37,105건이라 했으니 그 가설로 — 2026-04만? 2026-04+05?
for (const target of ['2026-04', '2026-05', '2026-04+05', '1년치 전체']) {
  let rows;
  if (target === '2026-04+05') rows = all.filter((r) => r.month === '2026-04' || r.month === '2026-05');
  else if (target === '1년치 전체') rows = all;
  else rows = all.filter((r) => r.month === target);

  // peer median
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.complex}__${r.bucket}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.amount);
  }
  const peerMed = new Map();
  for (const [k, arr] of groups) if (arr.length >= 3) peerMed.set(k, median(arr));

  const enriched = rows.map((r) => {
    const peer = peerMed.get(`${r.complex}__${r.bucket}`);
    const disc = peer ? ((peer - r.amount) / peer) * 100 : null;
    return { ...r, peer, disc };
  });
  const urgent = enriched.filter((r) => r.disc != null && r.disc >= 5);
  const ratio = ((urgent.length / rows.length) * 100).toFixed(1);
  console.log(
    `\n[${target}] 행 ${rows.length.toLocaleString()} | 급매 ${urgent.length.toLocaleString()} (${ratio}%)`,
  );
}

// === 3. PDF Top 10 추적 — 2026-04 가설(라이브 seed metadata에 적힌 기간)
const TARGET_MONTH = '2026-04';
const monthRows = all.filter((r) => r.month === TARGET_MONTH);
const groups = new Map();
for (const r of monthRows) {
  const k = `${r.complex}__${r.bucket}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r.amount);
}
const peerMed = new Map();
for (const [k, arr] of groups) if (arr.length >= 3) peerMed.set(k, median(arr));

const targets = [
  { name: '미륭', region: '노원구 월계동' },
  { name: '대한', region: '창원시 의창구 동읍 신방리' },
  { name: '현대그린', region: '서대문구 홍제동' },
];

console.log(`\n=== PDF Top 10 단지 추적 (가설: ${TARGET_MONTH}) ===`);
for (const t of targets) {
  console.log(`\n--- ${t.name} / ${t.region} ---`);
  const hits = monthRows.filter(
    (r) => r.complex === t.name && r.sigungu.includes(t.region),
  );
  console.log(`  ${TARGET_MONTH} 거래: ${hits.length}건`);

  const yearHits = all.filter((r) => r.complex === t.name && r.sigungu.includes(t.region));
  if (yearHits.length !== hits.length) {
    console.log(`  (1년치 전체: ${yearHits.length}건)`);
  }

  // 같은 단지명 다른 지역도 있는지
  const sameName = all.filter((r) => r.complex === t.name);
  const sigungus = [...new Set(sameName.map((r) => r.sigungu))];
  if (sigungus.length > 1) {
    console.log(`  같은 이름 단지 분포 (${sigungus.length}개 지역):`);
    for (const sg of sigungus.slice(0, 6)) {
      const cnt = sameName.filter((r) => r.sigungu === sg).length;
      console.log(`    ${sg}: ${cnt}건`);
    }
  }

  const discounts = [];
  for (const r of hits) {
    const peer = peerMed.get(`${r.complex}__${r.bucket}`);
    const disc = peer ? ((peer - r.amount) / peer) * 100 : null;
    if (disc != null) discounts.push(disc);
    console.log(
      `    ${r.area}㎡(${r.bucket}) ${r.amount.toLocaleString()}원  peer=${peer ? peer.toLocaleString() : '–'}  disc=${disc != null ? disc.toFixed(1) + '%' : '–'}`,
    );
  }
  const avg = discounts.length
    ? (discounts.reduce((a, b) => a + b, 0) / discounts.length).toFixed(1)
    : '–';
  const urgentCnt = discounts.filter((d) => d >= 5).length;
  console.log(`  평균 할인율: ${avg}%  |  급매(≥5%) 건수: ${urgentCnt}`);
}

// === 4. 음수 평균 할인율 — 1년치로 서울 검증
console.log(`\n=== 음수 할인율 검증: 서울 (1년치) ===`);
const seoul = all.filter((r) => r.region1 === '서울');
const seoulGroups = new Map();
for (const r of seoul) {
  const k = `${r.complex}__${r.bucket}`;
  if (!seoulGroups.has(k)) seoulGroups.set(k, []);
  seoulGroups.get(k).push(r.amount);
}
const seoulPeer = new Map();
for (const [k, arr] of seoulGroups) if (arr.length >= 3) seoulPeer.set(k, median(arr));
const seoulDiscs = [];
for (const r of seoul) {
  const peer = seoulPeer.get(`${r.complex}__${r.bucket}`);
  if (peer) seoulDiscs.push(((peer - r.amount) / peer) * 100);
}
const seoulAvg = seoulDiscs.reduce((a, b) => a + b, 0) / seoulDiscs.length;
const seoulMed = median(seoulDiscs);
console.log(`서울 전체 거래 (1년치): ${seoul.length.toLocaleString()}건`);
console.log(`peer 비교 가능: ${seoulDiscs.length.toLocaleString()}건`);
console.log(`평균 할인율: ${seoulAvg.toFixed(1)}%  |  중앙값: ${seoulMed.toFixed(1)}%`);
console.log(`(marketData.json regional 서울 averageDiscount = -32.8 였음)`);

// 음수 최대/최소
const minD = Math.min(...seoulDiscs);
const maxD = Math.max(...seoulDiscs);
console.log(`범위: min ${minD.toFixed(1)}% (가장 비싸게 거래) ~ max ${maxD.toFixed(1)}% (가장 큰 할인)`);
