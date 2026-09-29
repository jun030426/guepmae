#!/usr/bin/env node
/*
 * pipeline-data-sync.mjs — 원본 실거래 CSV(scripts/data/api_<시도>.csv)를 Supabase Storage 비공개 버킷과 동기화.
 *
 * 왜: GitHub Actions 러너는 매번 빈 디스크로 시작한다. 증분 수집(fetch-trades.py --since)은 기존 CSV 가 있어야
 *     병합할 수 있으므로, 실행 사이에 원본을 보관할 곳이 필요하다. 시도별로 gzip 해서
 *     pipeline-data/trades/api_<코드>.csv.gz 로 둔다. Storage 키는 ASCII 만 안전하므로 시도명을
 *     법정동코드 앞 2자리(서울 11, 경기 41 …)로 바꾼다.
 *
 * 사용:
 *   node scripts/pipeline-data-sync.mjs download   # 버킷 → scripts/data (+ _meta.json)
 *   node scripts/pipeline-data-sync.mjs upload     # scripts/data → 버킷 (+ 행 수 메타)
 *   node scripts/pipeline-data-sync.mjs check      # 현재 행 수가 직전 업로드보다 줄지 않았는지 (2% 허용, 시도별로도)
 *   node scripts/pipeline-data-sync.mjs list
 *
 * 환경: SUPABASE_URL(또는 VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY — process.env 우선, 없으면 .env.local
 * 종료 코드: 0 성공 · 3 버킷에 원본 없음(부트스트랩 필요) · 4 행 수 감소(check) · 1 그 밖의 오류
 *
 * download 는 scripts/data 의 같은 이름 파일을 덮어쓴다 — 로컬이 더 최신이면 먼저 upload 한다.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'scripts', 'data');
const CODES_PATH = path.join(ROOT, 'scripts', '_sigungu_codes.json');
export const BUCKET = 'pipeline-data';
export const PREFIX = 'trades/';
export const META_OBJECT = `${PREFIX}_meta.json`;
export const SHRINK_TOLERANCE = 0.02;

// ───────────────────────── 순수 함수 (테스트 대상) ─────────────────────────

/** { code5: "시도 시군구" } → Map(시도명 → 코드 앞 2자리) */
export function sidoCodeMap(codes) {
  const map = new Map();
  for (const [code, name] of Object.entries(codes ?? {})) {
    const sido = String(name).split(' ')[0];
    const prefix = String(code).slice(0, 2);
    if (sido && !map.has(sido)) map.set(sido, prefix);
  }
  return map;
}

/** 'api_서울특별시.csv' → 'trades/api_11.csv.gz' (모르는 파일은 null) */
export function objectNameForFile(fileName, map) {
  const match = /^api_(.+)\.csv$/.exec(String(fileName));
  if (!match) return null;
  const code = map.get(match[1]);
  return code ? `${PREFIX}api_${code}.csv.gz` : null;
}

/** 'trades/api_11.csv.gz' → 'api_서울특별시.csv' (모르는 객체는 null) */
export function fileNameForObject(objectName, map) {
  const match = /api_(\d{2})\.csv\.gz$/.exec(String(objectName));
  if (!match) return null;
  for (const [sido, code] of map) {
    if (code === match[1]) return `api_${sido}.csv`;
  }
  return null;
}

/** 헤더를 뺀 데이터 행 수 (빈 줄 제외) */
export function countDataRows(buffer) {
  let lines = 0;
  let sawChar = false;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) {
      if (sawChar) lines += 1;
      sawChar = false;
    } else if (buffer[i] !== 0x0d) {
      sawChar = true;
    }
  }
  if (sawChar) lines += 1;
  return Math.max(0, lines - 1);
}

/** 직전 대비 행 수가 허용치 넘게 줄었는지 */
export function hasShrunk(currentRows, previousRows, tolerance = SHRINK_TOLERANCE) {
  if (!Number.isFinite(previousRows) || previousRows <= 0) return false;
  return currentRows < previousRows * (1 - tolerance);
}

// ───────────────────────── 실행부 ─────────────────────────

/** 버킷에 원본이 하나도 없다 — 데스크톱에서 한 번 올려야 한다 (종료 코드 3) */
export class NoBootstrapError extends Error {}

function loadEnv() {
  const env = { ...process.env };
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL(또는 VITE_SUPABASE_URL) 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (.env.local 또는 환경변수).');
  }
  return { url, key };
}

async function storage(env, method, pathname, body, headers = {}) {
  const res = await fetch(`${env.url}/storage/v1/${pathname}`, {
    method,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, ...headers },
    body,
  });
  return res;
}

async function listObjects(env) {
  const res = await storage(env, 'POST', `object/list/${BUCKET}`, JSON.stringify({ prefix: PREFIX, limit: 200 }), {
    'Content-Type': 'application/json',
  });
  if (!res.ok) throw new Error(`목록 조회 실패 ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return rows.filter((row) => row?.name).map((row) => ({ name: `${PREFIX}${row.name}`, size: row.metadata?.size ?? null }));
}

function localCsvFiles(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir).filter((f) => /^api_.+\.csv$/.test(f)).sort();
}

function localRowTotals(dataDir) {
  const perFile = {};
  let total = 0;
  for (const file of localCsvFiles(dataDir)) {
    const rows = countDataRows(fs.readFileSync(path.join(dataDir, file)));
    perFile[file] = rows;
    total += rows;
  }
  return { total, perFile };
}

export async function download(env, map, dataDir = DATA) {
  const objects = (await listObjects(env)).filter((o) => o.name.endsWith('.csv.gz'));
  if (objects.length === 0) {
    throw new NoBootstrapError('버킷에 원본 CSV 가 없습니다. 데스크톱에서 `node scripts/pipeline-data-sync.mjs upload` 로 한 번 올려주세요 (docs/DESKTOP_TODO.md C).');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  let saved = 0;
  for (const object of objects) {
    const fileName = fileNameForObject(object.name, map);
    if (!fileName) {
      console.warn(`  ? ${object.name} — 알 수 없는 시도 코드, 건너뜀`);
      continue;
    }
    const res = await storage(env, 'GET', `object/${BUCKET}/${object.name}`);
    if (!res.ok) throw new Error(`${object.name} 내려받기 실패 ${res.status}`);
    const csv = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(path.join(dataDir, fileName), csv);
    saved += 1;
    console.log(`  ↓ ${object.name} → ${fileName} (${countDataRows(csv).toLocaleString('ko-KR')}행)`);
  }
  // 메타는 직전 업로드의 행 수 — check 의 비교 기준. 버킷에 없으면 로컬의 옛 메타도 지운다(엉뚱한 기준 방지).
  const metaPath = path.join(dataDir, '_meta.json');
  const metaRes = await storage(env, 'GET', `object/${BUCKET}/${META_OBJECT}`);
  if (metaRes.ok) {
    fs.writeFileSync(metaPath, Buffer.from(await metaRes.arrayBuffer()));
  } else if (fs.existsSync(metaPath)) {
    fs.rmSync(metaPath);
  }
  console.log(`내려받기 완료: ${saved}개 파일`);
  return { files: saved };
}

export async function upload(env, map, dataDir = DATA) {
  const files = localCsvFiles(dataDir);
  if (files.length === 0) throw new Error(`${dataDir} 에 api_<시도>.csv 가 없습니다.`);
  // 메타에는 실제로 올린 파일만 적는다 — 건너뛴 파일이 섞이면 다음 check 가 "사라졌다"고 오인한다
  const perFile = {};
  let total = 0;
  for (const file of files) {
    const objectName = objectNameForFile(file, map);
    if (!objectName) {
      console.warn(`  ? ${file} — 시도 코드를 찾지 못해 건너뜀`);
      continue;
    }
    const csv = fs.readFileSync(path.join(dataDir, file));
    const gz = zlib.gzipSync(csv, { level: 9 });
    const res = await storage(env, 'POST', `object/${BUCKET}/${objectName}`, gz, {
      'Content-Type': 'application/gzip',
      'x-upsert': 'true',
    });
    if (!res.ok) throw new Error(`${file} 올리기 실패 ${res.status} ${(await res.text()).slice(0, 200)}`);
    perFile[file] = countDataRows(csv);
    total += perFile[file];
    console.log(`  ↑ ${file} → ${objectName} (${(gz.length / 1024 / 1024).toFixed(1)}MB)`);
  }
  const sent = Object.keys(perFile).length;
  if (sent === 0) throw new Error('올릴 수 있는 파일이 없습니다 — 시도 코드를 찾지 못했습니다.');
  const meta = JSON.stringify({ totalRows: total, perFile, updatedAt: new Date().toISOString() });
  const metaRes = await storage(env, 'POST', `object/${BUCKET}/${META_OBJECT}`, meta, {
    'Content-Type': 'application/json',
    'x-upsert': 'true',
  });
  if (!metaRes.ok) throw new Error(`메타 올리기 실패 ${metaRes.status}`);
  console.log(`올리기 완료: ${sent}개 파일, 총 ${total.toLocaleString('ko-KR')}행`);
  return { files: sent, totalRows: total };
}

/** 시도별로도 본다 — 한 시도가 통째로 비어도 전국 합계로는 2% 안쪽일 수 있다 */
export function check(dataDir = DATA) {
  const metaPath = path.join(dataDir, '_meta.json');
  const totals = localRowTotals(dataDir);
  if (!fs.existsSync(metaPath)) {
    console.log(`직전 메타 없음 — 비교 생략 (현재 ${totals.total.toLocaleString('ko-KR')}행)`);
    return { ok: true, current: totals.total, previous: null, shrunk: [] };
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const previous = Number(meta.totalRows);
  console.log(`행 수: 직전 ${previous.toLocaleString('ko-KR')} → 현재 ${totals.total.toLocaleString('ko-KR')}`);
  const shrunk = [];
  if (hasShrunk(totals.total, previous)) shrunk.push('전체');
  for (const [file, before] of Object.entries(meta.perFile ?? {})) {
    const now = totals.perFile[file] ?? 0;
    if (hasShrunk(now, Number(before))) {
      shrunk.push(file);
      console.error(`  ${file}: ${Number(before).toLocaleString('ko-KR')} → ${now.toLocaleString('ko-KR')}`);
    }
  }
  return { ok: shrunk.length === 0, current: totals.total, previous, shrunk };
}

async function main() {
  const command = process.argv[2];
  const map = sidoCodeMap(JSON.parse(fs.readFileSync(CODES_PATH, 'utf-8')));
  if (command === 'check') {
    const result = check();
    if (!result.ok) {
      console.error(`⛔ 행 수가 ${(SHRINK_TOLERANCE * 100).toFixed(0)}% 넘게 줄었습니다(${result.shrunk.join(', ')}) — 수집 이상 가능성. 업로드·적재를 중단합니다.`);
      process.exit(4);
    }
    return undefined;
  }
  const env = loadEnv();
  if (command === 'download') return download(env, map);
  if (command === 'upload') return upload(env, map);
  if (command === 'list') {
    for (const object of await listObjects(env)) console.log(`${object.name}\t${object.size ?? ''}`);
    return undefined;
  }
  console.error('사용: node scripts/pipeline-data-sync.mjs download|upload|check|list');
  process.exit(1);
  return undefined;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof NoBootstrapError ? `⛔ ${err.message}` : (err.message || err));
    process.exit(err instanceof NoBootstrapError ? 3 : 1);
  });
}
