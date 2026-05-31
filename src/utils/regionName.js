/*
 * regionName — 시도 짧은 이름 → 표시용 풀이름.
 *
 * import-trades-csv.mjs 의 getRegionLevel1() 이 시도 어미("도", "특별시" 등)를
 * 제거해 짧게 만든 결과("전라남도"→"전라남")가 marketData.json 의 region 값.
 * 매물(properties.region: "전라남 무안군")도 같은 짧은 형식이라 매칭이
 * `property.region.includes(filters.region)` 로 작동.
 *
 * UI 표시는 정식 풀이름이 자연스러워서(전라남이 어색) 표시 함수만 분리.
 * 데이터 자체 / URL 파라미터 / Properties 매칭은 짧은 이름 그대로.
 */

const REGION_DISPLAY = {
  서울: '서울특별시',
  부산: '부산광역시',
  대구: '대구광역시',
  인천: '인천광역시',
  광주: '광주광역시',
  대전: '대전광역시',
  울산: '울산광역시',
  세종: '세종특별자치시',
  경기: '경기도',
  강원: '강원특별자치도',
  충청북: '충청북도',
  충청남: '충청남도',
  전북: '전북특별자치도',
  전라남: '전라남도',
  경상북: '경상북도',
  경상남: '경상남도',
  제주: '제주특별자치도',
};

export function formatRegionName(short) {
  if (!short) return '';
  return REGION_DISPLAY[short] ?? short;
}
