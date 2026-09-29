#!/usr/bin/env node
/*
 * load-bundles-to-supabase.mjs — public/data/*.json 번들을 Supabase 테이블에 적재.
 *
 * 번들 JSON 이 원본(source of truth)이고, 이 스크립트는 그 스냅샷을 DB 로 복제한다.
 *
 *   properties.json         → properties          (수집 매물 — 중개사 등록 매물과 같은 테이블)
 *   complex_prices.json     → complex_prices      (단지×면적 기준가)
 *   market_snapshots.json   → market_snapshots    (key/value 행으로 변환)
 *   property_reports.json   → property_reports    (AI 매물 리포트)
 *   ai_market_reports.json  → ai_market_reports   (AI 시장 리포트)
 *   scripts/output/complex_trades_rows.json → complex_trades (단지×면적 개별 실거래 전체, 없으면 public 번들)
 *
 * 사용:
 *   SUPABASE_URL(또는 VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY 필요 — 환경변수 우선, 없으면 .env.local
 *   node scripts/load-bundles-to-supabase.mjs complex_trades --upsert
 *   node scripts/load-bundles-to-supabase.mjs complex_prices            # 한 테이블 전체 교체
 *   node scripts/load-bundles-to-supabase.mjs properties --upsert --prune-against <이전 properties.json>
 *   node scripts/load-bundles-to-supabase.mjs --upsert                  # 전체 (upsert 가능한 테이블은 upsert, 나머지는 교체)
 *   node scripts/load-bundles-to-supabase.mjs --replace-all             # 전체 삭제 후 재삽입 — 빈 DB 초기 세팅용
 *
 *   --upsert            지우지 않고 기본키 기준으로 덮어쓴다 (없는 행은 추가, 나머지는 그대로)
 *   --prune-against f   이전 번들 f 에는 있었지만 새 번들에서 빠진 id 만 지운다 (--upsert 와 함께)
 *                       재계산에서 탈락한 수집 매물 정리 — 중개사 등록 매물은 건드리지 않는다
 *   --replace-all       properties 를 통째로 지우고 번들로 채우는 것을 허용한다
 *
 * ⚠ properties 에는 중개사가 포털에서 등록한 매물(번들에 없는 행)이 함께 들어 있다.
 *   통째로 교체하면 그 매물이 사라지므로 --upsert 나 --replace-all 을 명시하지 않으면 실행을 거부한다.
 *   빈 번들은 어느 테이블에도 적재하지 않는다 (빈 파일로 테이블을 비우는 사고 방지).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'public', 'data');

function loadEnv() {
  const file = {};
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) file[m[1]] = m[2].trim();
    }
  }
  const pick = (name) => process.env[name] || file[name] || '';
  const url = (pick('SUPABASE_URL') || pick('VITE_SUPABASE_URL')).replace(/\/$/, '');
  const key = pick('SUPABASE_SERVICE_ROLE_KEY');
  if (!url) throw new Error('SUPABASE_URL(또는 VITE_SUPABASE_URL) 이 없습니다 (.env.local 또는 환경변수).');
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY 가 없습니다 (.env.local 또는 환경변수).\n'
      + '→ Supabase Dashboard → Project Settings → API Keys 의 service_role 키를 추가하세요.',
    );
  }
  return { url, key };
}

let env = null; // 첫 요청 때 읽는다 — import 만으로는 키를 요구하지 않는다(테스트)

async function rest(method, pathname, body, extra = {}) {
  env ??= loadEnv();
  const res = await fetch(`${env.url}/rest/v1/${pathname}`, {
    method,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  }
  return res;
}

async function count(table, request) {
  const res = await request('GET', `${table}?select=*&limit=1`, undefined, { Prefer: 'count=exact', Range: '0-0' });
  const cr = res.headers.get('content-range') || '';
  return cr.split('/').pop() || '?';
}

function readBundle(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf-8'));
}

// scripts/output 의 전체 산출물이 있으면 그것을, 없으면 public 번들(상위 4,000행)을 적재한다.
function readOutputOrBundle(outputName, bundleName) {
  const outputPath = path.join(ROOT, 'scripts', 'output', `${outputName}.json`);
  if (fs.existsSync(outputPath)) return JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  console.warn(`  ⚠ ${path.relative(ROOT, outputPath)} 가 없어 public/data/${bundleName}.json(상위 행만) 을 적재합니다.`);
  return readBundle(bundleName);
}

// wipe: 전체 삭제용 필터 (delete 는 filter 필수) · conflict: --upsert 의 기본키(on_conflict)
// protect: 번들 밖에서 만들어진 행(중개사 등록 매물)이 섞여 있어 통째로 교체하면 안 되는 테이블
export const JOBS = {
  properties: {
    pk: 'id', wipe: 'id=neq.__none__', conflict: 'id', protect: true,
    rows: () => readBundle('properties'),
  },
  complex_prices: {
    pk: 'id', wipe: 'id=gte.0',
    rows: () => readBundle('complex_prices'),
  },
  market_snapshots: {
    pk: 'key', wipe: 'key=neq.__none__',
    rows: () => Object.entries(readBundle('market_snapshots')).map(([key, data]) => ({ key, data })),
  },
  property_reports: {
    pk: 'property_id', wipe: 'property_id=neq.__none__',
    rows: () => readBundle('property_reports'),
  },
  ai_market_reports: {
    pk: 'data_as_of', wipe: 'data_as_of=neq.__none__',
    rows: () => readBundle('ai_market_reports'),
  },
  complex_trades: {
    // 행마다 거래 배열(jsonb)이 들어 있어 요청 본문이 크다 — 200행씩 나눠 보낸다
    pk: 'complex', wipe: 'complex=neq.__none__', conflict: 'complex,gu,area_m2', chunk: 200,
    rows: () => readOutputOrBundle('complex_trades_rows', 'complex_trades'),
  },
};

// 이전 번들에는 있었지만 새 번들에서 빠진 id (재계산 탈락분)
export function prunedIds(previousRows, nextRows) {
  const keep = new Set((nextRows ?? []).map((row) => row.id));
  return (previousRows ?? []).map((row) => row.id).filter((id) => id && !keep.has(id));
}

/** 명령줄 → { only, upsert, replaceAll, pruneAgainst }. 위험하거나 모순된 조합은 아무것도 하기 전에 거부한다. */
export function parseArgs(argv) {
  const args = [...argv];
  const pruneIndex = args.indexOf('--prune-against');
  let pruneAgainst = null;
  if (pruneIndex >= 0) {
    pruneAgainst = args[pruneIndex + 1];
    if (!pruneAgainst || pruneAgainst.startsWith('--')) {
      throw new Error('--prune-against 뒤에 이전 번들 경로가 필요합니다.');
    }
    args.splice(pruneIndex, 2);
  }
  const flags = args.filter((a) => a.startsWith('--'));
  const unknown = flags.filter((f) => f !== '--upsert' && f !== '--replace-all');
  if (unknown.length) throw new Error(`알 수 없는 옵션: ${unknown.join(', ')}`);
  const tables = args.filter((a) => !a.startsWith('--'));
  if (tables.length > 1) throw new Error(`테이블은 하나만 지정합니다: ${tables.join(', ')}`);
  const only = tables[0] ?? null;
  if (only && !JOBS[only]) throw new Error(`알 수 없는 테이블: ${only} (가능: ${Object.keys(JOBS).join(', ')})`);

  const upsert = flags.includes('--upsert');
  const replaceAll = flags.includes('--replace-all');
  if (upsert && replaceAll) throw new Error('--upsert 와 --replace-all 은 함께 쓸 수 없습니다.');
  if (only && upsert && !JOBS[only].conflict) {
    throw new Error(`${only} 은 --upsert 를 지원하지 않습니다 (번들 복제본이라 항상 전체 교체).`);
  }
  if (pruneAgainst && only !== 'properties') throw new Error('--prune-against 는 properties 에서만 씁니다.');
  if (pruneAgainst && !upsert) throw new Error('--prune-against 는 --upsert 와 함께 씁니다.');
  return { only, upsert, replaceAll, pruneAgainst };
}

/** 한 테이블 적재. request 는 테스트에서 바꿔 끼운다. */
export async function loadRows(table, rows, {
  upsert = false, replaceAll = false, previousRows = null, request = rest, log = console.log,
} = {}) {
  const job = JOBS[table];
  if (!job) throw new Error(`알 수 없는 테이블: ${table} (가능: ${Object.keys(JOBS).join(', ')})`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${table}: 적재할 행이 없습니다 — 빈 번들로 테이블을 비우지 않도록 중단합니다.`);
  }
  const merge = upsert && Boolean(job.conflict);
  if (job.protect && !merge && !replaceAll) {
    throw new Error(
      `${table} 에는 중개사가 등록한 매물이 함께 들어 있어 통째로 교체하지 않습니다.\n`
      + `→ node scripts/load-bundles-to-supabase.mjs ${table} --upsert   (운영 중)\n`
      + '→ 빈 DB 를 처음 채울 때만 --replace-all',
    );
  }
  if (previousRows && !merge) throw new Error('--prune-against 는 --upsert 와 함께 씁니다.');

  log(`\n=== ${table} ===`);
  log(`  현재 ${await count(table, request)}행 → ${merge ? 'upsert' : '전체 교체'} ${rows.length}행`);
  if (!merge) {
    await request('DELETE', `${table}?${job.wipe}`, undefined, { Prefer: 'return=minimal' });
  }
  const target = merge ? `${table}?on_conflict=${job.conflict}` : table;
  const prefer = merge ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal';
  const size = job.chunk ?? 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    await request('POST', target, chunk, { Prefer: prefer });
    done += chunk.length;
    if (rows.length > size && process.stdout.isTTY) process.stdout.write(`  ${done}/${rows.length}\r`);
  }
  let pruned = 0;
  if (previousRows) {
    const ids = prunedIds(previousRows, rows);
    for (let i = 0; i < ids.length; i += 100) {
      const list = ids.slice(i, i + 100).map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
      await request('DELETE', `${table}?id=in.(${encodeURIComponent(list)})`, undefined, { Prefer: 'return=minimal' });
    }
    pruned = ids.length;
    log(`  재계산 탈락 매물 ${pruned}건 정리`);
  }
  log(`  완료: ${await count(table, request)}행`);
  return { mode: merge ? 'upsert' : 'replace', sent: done, pruned };
}

async function main() {
  const { only, upsert, replaceAll, pruneAgainst } = parseArgs(process.argv.slice(2));
  const previousRows = pruneAgainst ? JSON.parse(fs.readFileSync(pruneAgainst, 'utf-8')) : null;
  const targets = only ? [only] : Object.keys(JOBS);
  for (const t of targets) {
    await loadRows(t, JOBS[t].rows(), { upsert, replaceAll, previousRows: t === 'properties' ? previousRows : null });
  }
  console.log('\n적재 완료.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('\n실패:', err.message);
    process.exitCode = 1;
  });
}
