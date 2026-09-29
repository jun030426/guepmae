import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shiftMonth } from '../src/utils/priceBasis.js';
import { groupByComplex, runBacktest } from './backtest-price-basis.mjs';
import { renderMarkdown } from './backtest-report.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backtest-price-basis.mjs');
const M = 1000000;
const monthsFrom = (from, n) => Array.from({ length: n }, (_, i) => shiftMonth(from, i));

// 단지 12곳 · 매달 2건 · 36개월. 단지마다 가격대가 다르고 층·가격이 규칙적으로 흔들린다 (난수 없음)
function sampleRows() {
  return Array.from({ length: 12 }, (_, c) => ({
    complex: `단지${c}`,
    gu: c % 3 ? '서울특별시 강남구' : '부산광역시 해운대구',
    area_m2: 84,
    trades: monthsFrom('2023-10', 36).flatMap((ym, i) => [
      [ym, '05', (500 + c * 20 + ((i * 7 + c) % 9) * 5) * M, 2 + ((i + c) % 14), 'b'],
      [ym, '20', (500 + c * 20 - ((i * 5 + c) % 11) * 6) * M, 1 + ((i * 3 + c) % 15), i % 12 === 0 ? 'd' : 'b'],
    ]),
  }));
}

function assertClean(markdown) {
  for (const bad of ['undefined', 'NaN', 'null', '[object', 'Infinity']) {
    assert.ok(!markdown.includes(bad), `리포트에 '${bad}' 가 들어 있다`);
  }
  // 표의 모든 줄은 머리글과 칸 수가 같다
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\| ---/.test(lines[i])) continue;
    const columns = lines[i - 1].split('|').length;
    for (let j = i + 1; j < lines.length && lines[j].startsWith('|'); j += 1) {
      assert.equal(lines[j].split('|').length, columns, `표 칸 수가 다르다: ${lines[j]}`);
    }
  }
}

test('renderMarkdown — 모든 절이 있고 빈 값이 새지 않는다', () => {
  const report = runBacktest(groupByComplex(sampleRows()), { generatedAt: '2026-09-29', inputLabel: 'scripts/output/complex_trades_rows.json' });
  const markdown = renderMarkdown(report);
  for (const heading of ['# 판정 규칙 백테스트 결과', '## 1. 요약', '## 2. 규칙 요소별 효과', '## 3. 판정 할인율과 실현 할인율',
    '### 4.1 기간 창', '### 4.4 기준월 경과', '### 4.5 시도', '## 5. 눈여겨볼 점', '## 6. 지표 정의', '## 7. 한계']) {
    assert.ok(markdown.includes(heading), heading);
  }
  assert.ok(markdown.includes('데이터 2023-10~2026-09 · 검증 대상 2025-10~2026-04'));
  assert.ok(markdown.includes('| 운영 규칙 |'));
  assert.ok(markdown.includes('| 5% 이상 (운영) |'));
  assert.ok(markdown.includes('호가가 아니라 체결가다'));
  assert.ok(!markdown.includes('일부 단지만으로 돌린 결과'));
  assert.ok(!markdown.includes('거래유형(중개/직거래) 정보가 없는'));
  assert.deepEqual(report.universe.dealing, { brokered: 12 * 72 - 12 * 3, direct: 12 * 3, unknown: 0 });
  assert.ok(markdown.includes('| 거래유형 | 중개 828건 · 직거래 36건 · 미상 0건 |'));
  assert.match(markdown, /- 거래의 절반은 실제 거래가가 기준가에서 \d+\.\d% 안쪽이었다\./);
  assertClean(markdown);
});

test('renderMarkdown — 거래유형이 없는 데이터(재수집 전)는 경고한다', () => {
  const rows = sampleRows().map((r) => ({ ...r, trades: r.trades.map(([ym, day, price, floor]) => [ym, day, price, floor, '']) }));
  const report = runBacktest(groupByComplex(rows), { generatedAt: '2026-09-29' });
  assert.deepEqual(report.universe.dealing, { brokered: 0, direct: 0, unknown: 864 });
  assert.equal(report.universe.skippedDirect, 0);
  // 직거래를 가려낼 수 없으니 "직거래 포함" 변형은 운영 규칙과 같다
  assert.deepEqual(report.variants.include_direct, report.variants.current);
  const markdown = renderMarkdown(report);
  assert.ok(markdown.indexOf('거래유형(중개/직거래) 정보가 없는 데이터다') < markdown.indexOf('## 1. 요약'));
  assertClean(markdown);
});

test('renderMarkdown — 번들로 돌렸으면 맨 위에 경고, 지역을 좁혔으면 표시', () => {
  const report = runBacktest(groupByComplex(sampleRows()), { generatedAt: '2026-09-29', subset: true, sido: '서울특별시' });
  const markdown = renderMarkdown(report);
  assert.ok(markdown.indexOf('일부 단지만으로 돌린 결과') < markdown.indexOf('## 1. 요약'));
  assert.ok(markdown.includes('· 지역 서울특별시'));
  assertClean(markdown);
});

test('renderMarkdown — 채점할 거래가 하나도 없어도 깨지지 않는다', () => {
  // 단지 하나, 거래가 뜸해 전부 보류
  const rows = [{ complex: '한산', gu: '강원특별자치도 춘천시', area_m2: 84, trades: monthsFrom('2023-10', 36).filter((_, i) => i % 18 === 0).map((ym) => [ym, '10', 300 * M, 5, 'b']) }];
  const report = runBacktest(groupByComplex(rows), { generatedAt: '2026-09-29', minHistoryMonths: 12, horizonMonths: 3 });
  assert.equal(report.variants.current.judged, 0);
  const markdown = renderMarkdown(report);
  assert.ok(markdown.includes('| 기준가 오차 중앙값 | – |'));
  assert.ok(markdown.includes('해당 거래 없음.'));
  assert.ok(markdown.includes('비교할 표본이 없다.'));
  assertClean(markdown);
});

// ───────────────────────── CLI ─────────────────────────

function cli(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

test('CLI — 입력을 읽어 JSON·Markdown 을 쓴다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geupmae-backtest-'));
  try {
    const input = path.join(dir, 'rows.json');
    fs.writeFileSync(input, JSON.stringify(sampleRows()));
    const out = path.join(dir, 'out');
    const md = path.join(dir, 'docs', 'BACKTEST.md');
    const result = cli(['--input', input, '--out', out, '--md', md]);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /데이터 2023-10~2026-09 · 검증 대상 2025-10~2026-04/);
    assert.match(result.out, /가상 매물 \d+건/);

    const report = JSON.parse(fs.readFileSync(path.join(out, 'backtest_report.json'), 'utf8'));
    assert.equal(report.meta.testFrom, '2025-10');
    assert.equal(report.universe.complexes, 12);
    const markdown = fs.readFileSync(path.join(out, 'backtest_report.md'), 'utf8');
    assert.equal(markdown, fs.readFileSync(md, 'utf8'));
    assertClean(markdown);

    // 지역을 좁히면 그 지역 단지만
    const seoul = cli(['--input', input, '--out', out, '--sido', '서울특별시']);
    assert.equal(seoul.code, 0, seoul.out);
    const narrowed = JSON.parse(fs.readFileSync(path.join(out, 'backtest_report.json'), 'utf8'));
    assert.equal(narrowed.universe.complexes, 8);
    assert.deepEqual(narrowed.current.bySido.map((s) => s.key), ['서울특별시']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI — 실패는 이유와 함께 종료 코드 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geupmae-backtest-'));
  try {
    const missing = cli(['--input', path.join(dir, 'none.json'), '--out', dir]);
    assert.equal(missing.code, 1);
    assert.match(missing.out, /입력 파일이 없습니다/);

    const input = path.join(dir, 'rows.json');
    fs.writeFileSync(input, JSON.stringify(sampleRows()));
    const short = cli(['--input', input, '--out', dir, '--min-history', '40']);
    assert.equal(short.code, 1);
    assert.match(short.out, /검증할 달이 없습니다/);

    const nowhere = cli(['--input', input, '--out', dir, '--sido', '제주특별자치도']);
    assert.equal(nowhere.code, 1);
    assert.match(nowhere.out, /제주특별자치도.*거래가 없습니다/);

    const typo = cli(['--horizn', '6']);
    assert.equal(typo.code, 1);
    assert.match(typo.out, /알 수 없는 옵션/);
    assert.equal(fs.existsSync(path.join(dir, 'backtest_report.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
