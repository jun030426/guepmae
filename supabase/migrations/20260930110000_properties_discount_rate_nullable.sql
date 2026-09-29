/*
 * properties.discount_rate — 판정 보류 매물은 할인율이 없다.
 *
 * 기존: numeric(5,2) not null default 0 — 기준가를 못 구한 매물이 "0% 저렴"으로 저장되는 가짜 지표였다.
 * 변경: null 허용. null = 판정 보류(표본 부족·데이터 없음). 앱은 null 이면 급매 배지 대신 "판정 보류"를 표시하고
 *       급매 목록·지도·홈에서 제외한다(할인율 ≥5% 필터). price_basis.status = 'insufficient' 와 짝을 이룬다.
 * 설계: docs/superpowers/specs/2026-09-29-price-basis-judgment-design.md §4
 */

alter table public.properties
  alter column discount_rate drop not null;

alter table public.properties
  alter column discount_rate drop default;
