/*
 * properties.price_basis — 할인율(기준 실거래가) 산출 근거 스냅샷.
 *
 * 왜: '급매 −5%'를 검증 가능한 주장으로 만들려면, 할인율 숫자뿐 아니라
 *     "어떤 근거로 나온 기준가인지"(출처·면적·표본 수·기간·신뢰도)를
 *     매물에 함께 저장·표시해야 함. (등록 시점 스냅샷 — 감사·재현용)
 *
 * 형태(jsonb 예시):
 * {
 *   "source": "complex" | "region" | "asking",
 *   "baselinePrice": 1820000000,
 *   "areaM2": 84, "requestedAreaM2": 84, "approxArea": false,
 *   "sampleSize": 7, "periodStart": "2025-06", "periodEnd": "2026-05",
 *   "confidence": "high" | "medium" | "low" | "region" | "none",
 *   "method": "동일 단지 84㎡ · 2025-06~2026-05 7건 중앙값",
 *   "computedAt": "2026-06-24"
 * }
 */

alter table public.properties
  add column if not exists price_basis jsonb;
