#!/usr/bin/env node
/*
 * load-bundles-to-supabase.mjs — public/data/*.json 번들을 Supabase 테이블에 적재.
 *
 * 하이브리드 모드의 초기 데이터 세팅용. 번들 JSON 이 원본(source of truth)이고,
 * 이 스크립트는 그 스냅샷을 DB 로 복제한다 (전체 삭제 후 재삽입 — 재실행 안전).
 *
 *   properties.json         → properties          (395 매물)
 *   complex_prices.json     → complex_prices      (단지×면적 기준가)
 *   market_snapshots.json   → market_snapshots    (key/value 행으로 변환)
 *   property_reports.json   → property_reports    (AI 매물 리포트)
 *   ai_market_reports.json  → ai_market_reports   (AI 시장 리포트)
 *
 * 사용:
 *   .env.local 에 VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요
 *   node scripts/load-bundles-to-supabase.mjs           # 전체
 *   node scripts/load-bundles-to-supabase.mjs properties  # 한 테이블만
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'public', 'data');

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local 이 없습니다.');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const url = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url) throw new Error('.env.local 에 VITE_SUPABASE_URL 이 없습니다.');
  if (!key) {
    throw new Error(
      '.env.local 에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n'
      + '→ Supabase Dashboard → Project Settings → API Keys 의 service_role 키를 추가하세요.',
    );
  }
  return { url, key };
}

const { url: URL_, key: KEY } = loadEnv();
const HDR = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(method, pathname, body, extra = {}) {
  const res = await fetch(`${URL_}/rest/v1/${pathname}`, {
    method,
    headers: { ...HDR, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  }
  return res;
}

async function count(table) {
  const res = await rest('GET', `${table}?select=*&limit=1`, undefined, { Prefer: 'count=exact', Range: '0-0' });
  const cr = res.headers.get('content-range') || '';
  return cr.split('/').pop() || '?';
}

function readBundle(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf-8'));
}

// pk: 전체 삭제용 필터 (delete 는 filter 필수)
const JOBS = {
  properties: {
    pk: 'id', wipe: 'id=neq.__none__',
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
};

async function loadTable(table) {
  const job = JOBS[table];
  const rows = job.rows();
  console.log(`\n=== ${table} ===`);
  console.log(`  현재 ${await count(table)}행 → 새로 ${rows.length}행 적재`);
  await rest('DELETE', `${table}?${job.wipe}`, undefined, { Prefer: 'return=minimal' });
  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await rest('POST', table, chunk, { Prefer: 'return=minimal' });
    done += chunk.length;
    if (rows.length > 500) process.stdout.write(`  ${done}/${rows.length}\r`);
  }
  console.log(`  완료: ${await count(table)}행`);
}

async function main() {
  const only = process.argv[2];
  const targets = only ? [only] : Object.keys(JOBS);
  for (const t of targets) {
    if (!JOBS[t]) throw new Error(`알 수 없는 테이블: ${t} (가능: ${Object.keys(JOBS).join(', ')})`);
    await loadTable(t);
  }
  console.log('\n전체 적재 완료.');
}

main().catch((err) => {
  console.error('\n실패:', err.message);
  process.exitCode = 1;
});
