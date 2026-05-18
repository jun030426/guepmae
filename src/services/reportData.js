/*
 * reportData.js — Report 페이지가 사용하는 데이터 서빙 레이어
 *
 * 우선순위:
 *   1) src/data/marketData.json (scripts/import-trades-csv.mjs 결과물, 실데이터)
 *   2) src/data/marketData.js의 mock 데이터 (스크립트 미실행 시 폴백)
 *
 * 추후 Supabase ETL이 가동되면 이 파일 안에서 fetch 또는 supabase.from() 으로 교체.
 */

import * as mockData from '../data/marketData.js';

// Vite가 JSON을 정적 import 하지 못해도 에러나지 않도록 try-catch (실제 import는 동기지만 try로 감쌀 수 있게 require 패턴 흉내)
let realData = null;
try {
  // Vite 동적 import — JSON이 있으면 가져오고, 없으면 catch로 빠짐
  // import.meta.glob을 쓰면 빌드 타임에 존재 여부 결정 가능
  const modules = import.meta.glob('../data/marketData.json', { eager: true });
  const matched = Object.values(modules)[0];
  if (matched) {
    realData = matched.default ?? matched;
  }
} catch {
  realData = null;
}

const source = realData ?? mockData;

function resolveWithDelay(value, delay = 0) {
  if (delay <= 0) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), delay));
}

export function fetchRegionalSnapshots() {
  return resolveWithDelay(source.regionalSnapshots);
}

export function fetchMonthlyTrend(months = 12) {
  const trend = source.monthlyMarketTrend ?? [];
  return resolveWithDelay(trend.slice(-months));
}

export function fetchAreaTypeBreakdown() {
  return resolveWithDelay(source.areaTypeBreakdown);
}

export function fetchTopUrgentComplexes(limit = 10) {
  const items = source.topUrgentComplexes ?? [];
  return resolveWithDelay(items.slice(0, limit));
}

export function fetchMarketInsights() {
  return resolveWithDelay(source.marketInsights);
}

export function getDataSource() {
  return source.dataSource;
}

export function isUsingRealData() {
  return realData !== null;
}
