/*
 * build-complex-trades.mjs
 *
 * scripts/data/ 의 국토부 실거래가 CSV(CP949)에서 단지+구+면적별 "개별 실거래"를 추출합니다.
 *   → scripts/output/complex_trades.csv
 * 매물 상세의 "실거래 표"(평형별 요약 + 최근 실거래 내역)용. 재생산(추정) 없이 실데이터만.
 *   - 해제(취소)된 거래(해제사유발생일 != 빈값/-)는 제외
 *
 * 출력 컬럼: complex, gu, area_m2, year_month, day, floor, price
 * 실행: node scripts/build-complex-trades.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(__dirname, 'data');
const outputDir = path.join(__dirname, 'output');

function readNationalCsv(csvPath) {
  const buffer = fs.readFileSync(csvPath);
  let text;
  try { text = iconv.decode(buffer, 'cp949'); } catch { text = buffer.toString('utf8'); }
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const t = line.trim();
    return t && /시군구/.test(t) && /(거래금액|단지명|전용면적)/.test(t);
  });
  if (headerIndex === -1) throw new Error(`CSV 헤더 행 없음: ${csvPath}`);
  return lines.slice(headerIndex).join('\n');
}
const pick = (row, keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k]; return undefined; };
const parseAmt = (r) => { const c = String(r ?? '').replace(/[^0-9-]/g, ''); const n = Number(c); return c && Number.isFinite(n) ? n * 10000 : null; };
const parseArea = (r) => { const n = Number(String(r ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const parseYm = (r) => { const c = String(r ?? '').replace(/[^0-9]/g, ''); return c.length === 6 ? `${c.slice(0, 4)}-${c.slice(4, 6)}` : null; };
function toGu(sigungu) {
  const t = sigungu.trim().split(/\s+/);
  while (t.length > 1 && /(동|읍|면|리|가)$/.test(t[t.length - 1])) t.pop();
  return t.join(' ');
}
const csvCell = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function main() {
  const files = fs.readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.csv'));
  if (!files.length) throw new Error('scripts/data/ 에 .csv 없음');
  console.log(`[trades] 입력 파일 ${files.length}개`);
  const out = ['complex,gu,area_m2,year_month,day,floor,price'];
  let total = 0, cancelled = 0, kept = 0;
  for (const file of files) {
    const rows = parse(readNationalCsv(path.join(dataDir, file)), {
      columns: true, skip_empty_lines: true, trim: true, relax_quotes: true, relax_column_count: true,
    });
    for (const row of rows) {
      total += 1;
      const sigungu = pick(row, ['시군구']);
      const complex = pick(row, ['단지명']);
      const amount = parseAmt(pick(row, ['거래금액(만원)', '거래금액']));
      const ym = parseYm(pick(row, ['계약년월']));
      const cancel = pick(row, ['해제사유발생일']);
      if (!sigungu || !complex || amount == null || !ym) continue;
      if (cancel && cancel !== '-') { cancelled += 1; continue; }  // 취소거래 제외
      const area = parseArea(pick(row, ['전용면적(㎡)', '전용면적']));
      if (area == null) continue;
      const areaM2 = Math.floor(area);
      const gu = toGu(sigungu);
      const day = String(pick(row, ['일']) ?? '').replace(/[^0-9]/g, '');
      const floor = String(pick(row, ['층']) ?? '').replace(/[^0-9-]/g, '');
      out.push([csvCell(complex), csvCell(gu), areaM2, ym, day, floor, amount].join(','));
      kept += 1;
    }
    console.log(`[trades] ${file} 처리`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'complex_trades.csv');
  fs.writeFileSync(outPath, out.join('\n'), 'utf8');
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log('—'.repeat(40));
  console.log(`[trades] 원본 ${total.toLocaleString('ko-KR')} / 취소제외 ${cancelled.toLocaleString('ko-KR')} / 실거래 ${kept.toLocaleString('ko-KR')}건`);
  console.log(`[trades] 출력: ${path.relative(projectRoot, outPath)} (${mb}MB)`);
}
main();
