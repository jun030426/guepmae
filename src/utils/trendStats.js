/*
 * trendStats — price_trends 시계열의 신뢰도 등급 산출 헬퍼.
 *
 * 등급 기준 (2026-05-31 데이터 검증 결과):
 *   높음 — 실거래 10개월 이상 AND 누적 표본 30건 이상 (전체 1,107 그룹의 ~74%)
 *   보통 — 실거래 7개월 이상 AND 누적 표본 13건 이상 (~10%)
 *   낮음 — 그 외 (시골 군 + 대형 평형 등 ~16%)
 *
 * 사용처: 시세 동향 페이지 UI에서 차트·라벨 색 매핑, 추후 알림·추천 등급 재활용.
 */

export function gradeReliability(realMonths, sampleTotal) {
  if (realMonths >= 10 && sampleTotal >= 30) return 'high';
  if (realMonths >= 7 && sampleTotal >= 13) return 'mid';
  return 'low';
}
