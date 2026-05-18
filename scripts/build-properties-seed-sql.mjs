/*
 * build-properties-seed-sql.mjs
 *
 * src/data/properties.generated.json 을 읽어 Supabase 에 한 번에 적용할 SQL 파일을 만든다.
 * 결과: supabase/seed/properties_seed.sql
 *
 * 사용:
 *   1) node scripts/build-properties-seed-sql.mjs
 *   2) 생성된 SQL 을 Supabase Dashboard → SQL Editor 에 붙여넣고 Run
 *
 * SQL 내용:
 *   - properties 테이블에 unit_count 컬럼 추가 (idempotent)
 *   - 기존 properties 모두 삭제
 *   - 115건 insert
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const inputPath = path.join(projectRoot, 'src', 'data', 'properties.generated.json');
const outputPath = path.join(projectRoot, 'supabase', 'seed', 'properties_seed.sql');

function escapeText(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function escapeNumber(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return String(value);
}

function escapeBool(value) {
  return value ? 'true' : 'false';
}

function escapeJson(obj) {
  if (obj === null || obj === undefined) return `'{}'::jsonb`;
  const json = JSON.stringify(obj).replace(/'/g, "''");
  return `'${json}'::jsonb`;
}

function escapeDate(value) {
  if (!value) return 'null';
  return `'${value}'::date`;
}

function buildInsert(p) {
  const cols = [
    'id', 'title', 'address', 'coordinates', 'region', 'property_type',
    'price', 'actual_transaction_price', 'discount_rate', 'urgent_score',
    'area', 'supply_area', 'floor', 'built_year',
    'image_label', 'verified', 'last_verified_at', 'recent_transaction_date',
    'description', 'parking', 'maintenance_fee', 'move_in_date',
    'rooms', 'bathrooms', 'unit_count',
    'agent', 'lifestyle', 'price_history',
  ].join(', ');

  const values = [
    escapeText(p.id),
    escapeText(p.title),
    escapeText(p.address),
    escapeJson(p.coordinates),
    escapeText(p.region),
    escapeText(p.propertyType),
    escapeNumber(p.price),
    escapeNumber(p.actualTransactionPrice),
    escapeNumber(p.discountRate),
    escapeNumber(p.urgentScore),
    escapeNumber(p.area),
    escapeNumber(p.supplyArea),
    escapeText(p.floor),
    escapeNumber(p.builtYear),
    escapeText(p.imageLabel || ''),
    escapeBool(p.verified),
    escapeDate(p.lastVerifiedAt),
    escapeDate(p.recentTransactionDate),
    escapeText(p.description),
    escapeText(p.parking),
    escapeNumber(p.maintenanceFee),
    escapeText(p.moveInDate),
    escapeNumber(p.rooms),
    escapeNumber(p.bathrooms),
    escapeNumber(p.unitCount),
    escapeJson(p.agent),
    escapeJson(p.lifestyle),
    escapeJson(p.priceHistory),
  ].join(', ');

  return `insert into public.properties (${cols}) values (${values});`;
}

function main() {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const properties = JSON.parse(raw);

  const lines = [
    '-- 매물 시드 SQL — scripts/build-properties-seed-sql.mjs 로 자동 생성',
    '-- Supabase Dashboard → SQL Editor 에 통째로 붙여넣고 Run',
    '',
    '-- 1) unit_count 컬럼이 없으면 추가 (idempotent)',
    'alter table public.properties add column if not exists unit_count int;',
    '',
    '-- 2) 기존 매물 모두 삭제',
    'delete from public.properties;',
    '',
    `-- 3) ${properties.length}건 insert`,
    'begin;',
    ...properties.map(buildInsert),
    'commit;',
    '',
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${properties.length} INSERTs to ${path.relative(projectRoot, outputPath)}`);
}

main();
