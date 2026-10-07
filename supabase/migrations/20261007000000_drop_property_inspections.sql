/*
 * property_inspections 제거 — AI 점검 체크리스트 기능 폐기 (2026-10-07).
 * Edge Function inspection-report 도 함께 삭제됐다. 매물 AI 분석은 property-report 하나로 일원화.
 */

drop table if exists public.property_inspections;
