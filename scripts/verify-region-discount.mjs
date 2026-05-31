/*
 * verify-region-discount.mjs (일회성 검증)
 *
 * 17개 시도별 평균 할인율 vs 중앙값 비교.
 *   - import-trades-csv.mjs와 같은 peer median(단지+bucket, 3건↑) 로직.
 *   - 시도별로 평균/중앙값/표본 수/부호 분포 출력.
 *   - 평균과 중앙값 차이가 큰 시도 = outlier 영향 큼.
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
const getRegion = (s) =>
  s?.trim().split(/\s+/)[0]?.replace(/특별시$|광역시$|특별자치시$|특별자치도$|도$/, '').trim() ?? null;

// 1. 로드
const all = [];
for (const f of files) {
  const rows = readCsv(path.join(dataDir, f));
  for (const r of rows) {
    const sigungu = pick(r, ['시군구']);
    const complex = pick(r, ['단지명', '아파트']);
    const area = parseArea(pick(r, ['전용면적(㎡)', '전용면적']));
    const amount = parseAmount(pick(r, ['거래금액(만원)', '거래금액']));
    if (!sigungu || !complex || amount == null) continue;
    all.push({
      region: getRegion(sigungu),
      complex: complex.trim(),
      bucket: getBucket(area),
      amount,
    });
  }
}
console.log(`로드: ${all.length.toLocaleString()}건`);

// 2. peer median (단지+bucket, 3건↑)
const peerGroups = new Map();
for (const r of all) {
  const k = `${r.complex}__${r.bucket}`;
  if (!peerGroups.has(k)) peerGroups.set(k, []);
  peerGroups.get(k).push(r.amount);
}
const peerMed = new Map();
for (const [k, arr] of peerGroups) if (arr.length >= 3) peerMed.set(k, median(arr));
console.log(`peer 그룹: ${peerGroups.size.toLocaleString()} / 3건↑ peer: ${peerMed.size.toLocaleString()}`);

// 3. 거래마다 할인율 계산 (peer 있는 경우만)
const enriched = all
  .map((r) => {
    const peer = peerMed.get(`${r.complex}__${r.bucket}`);
    if (!peer) return null;
    return { ...r, discount: ((peer - r.amount) / peer) * 100 };
  })
  .filter(Boolean);
console.log(`할인율 계산 가능: ${enriched.length.toLocaleString()}건 (전체의 ${((enriched.length / all.length) * 100).toFixed(1)}%)\n`);

// 4. 시도별 평균/중앙값
const byRegion = new Map();
for (const r of enriched) {
  if (!byRegion.has(r.region)) byRegion.set(r.region, []);
  byRegion.get(r.region).push(r.discount);
}

const rows = [];
for (const [region, discounts] of byRegion) {
  const total = all.filter((r) => r.region === region).length;
  const avg = discounts.reduce((s, v) => s + v, 0) / discounts.length;
  const med = median(discounts);
  const pos = discounts.filter((d) => d > 0).length;  // 할인
  const neg = discounts.filter((d) => d < 0).length;  // 프리미엄
  const zero = discounts.filter((d) => d === 0).length;
  rows.push({
    region,
    total,
    sampled: discounts.length,
    avg: Number(avg.toFixed(1)),
    med: Number(med.toFixed(1)),
    diff: Number((avg - med).toFixed(1)),
    posPct: Number(((pos / discounts.length) * 100).toFixed(1)),
    negPct: Number(((neg / discounts.length) * 100).toFixed(1)),
    pos,
    neg,
    zero,
  });
}
rows.sort((a, b) => b.total - a.total);

console.log('=== 17개 시도 평균 vs 중앙값 (거래량 내림차순) ===');
console.log(
  `${'지역'.padEnd(8)} ${'거래'.padStart(8)} ${'평균%'.padStart(7)} ${'중앙값%'.padStart(8)} ${'차이'.padStart(7)} ${'할인%'.padStart(7)} ${'프리미엄%'.padStart(9)}`,
);
console.log('—'.repeat(70));
for (const r of rows) {
  console.log(
    `${r.region.padEnd(8)} ${r.total.toLocaleString().padStart(8)} ${String(r.avg).padStart(7)} ${String(r.med).padStart(8)} ${String(r.diff).padStart(7)} ${String(r.posPct).padStart(7)} ${String(r.negPct).padStart(9)}`,
  );
}

// 5. 평균 부호 분포
const avgNeg = rows.filter((r) => r.avg < 0).length;
const avgPos = rows.filter((r) => r.avg > 0).length;
const medNeg = rows.filter((r) => r.med < 0).length;
const medPos = rows.filter((r) => r.med > 0).length;
const signFlip = rows.filter((r) => Math.sign(r.avg) !== Math.sign(r.med));
console.log(`\n=== 부호 분포 ===`);
console.log(`평균  음수(프리미엄) ${avgNeg} / 양수(할인) ${avgPos} / 0 ${rows.length - avgNeg - avgPos}`);
console.log(`중앙값 음수(프리미엄) ${medNeg} / 양수(할인) ${medPos} / 0 ${rows.length - medNeg - medPos}`);
console.log(`평균↔중앙값 부호 다른 지역: ${signFlip.length}`);
if (signFlip.length) {
  for (const r of signFlip) console.log(`  ${r.region}: 평균 ${r.avg} / 중앙값 ${r.med}`);
}

// 6. 평균-중앙값 차이 큰 지역 (outlier 영향 큼)
console.log(`\n=== 평균-중앙값 차이 큰 순 (outlier 영향) ===`);
const byDiff = [...rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5);
for (const r of byDiff) {
  console.log(`  ${r.region}: 평균 ${r.avg}% / 중앙값 ${r.med}% / 차이 ${r.diff}%p`);
}

// 7. marketData.json 평균과 일치 확인
console.log(`\n=== marketData.json regional.averageDiscount 와 일치 확인 ===`);
const md = JSON.parse(fs.readFileSync('src/data/marketData.json', 'utf8'));
for (const mdRow of md.regionalSnapshots) {
  const ours = rows.find((r) => r.region === mdRow.region);
  const ok = ours && Math.abs(ours.avg - mdRow.averageDiscount) < 0.2;
  console.log(`  ${mdRow.region.padEnd(8)} json ${String(mdRow.averageDiscount).padStart(7)} / 재계산 ${String(ours?.avg ?? '–').padStart(7)} ${ok ? '✓' : '✗'}`);
}
