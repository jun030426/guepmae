// 가격 주장의 근거와 그 신뢰도를 화면 어디서나 같은 규칙으로 표기하기 위한 유틸.
// 제품 원칙: 모든 가격 주장에는 표본 수와 기간이 따라붙는다.

// "2023-11" → "23.11"
function shortMonth(value) {
  if (!value) return '';
  const [year, month] = String(value).split('-');
  return year && month ? `${year.slice(2)}.${month}` : String(value);
}

// 카드·목록에 붙는 짧은 근거 문구. 근거가 없으면 null (문구를 지어내지 않는다).
export function formatPriceEvidence(priceBasis) {
  if (!priceBasis?.sampleSize) return null;
  const period = [shortMonth(priceBasis.periodStart), shortMonth(priceBasis.periodEnd)]
    .filter(Boolean)
    .join('~');
  return period
    ? `실거래 ${priceBasis.sampleSize}건 · ${period}`
    : `실거래 ${priceBasis.sampleSize}건`;
}

// 표본이 적어 할인율이 우연에 좌우될 수 있는 구간
export function isLowSample(priceBasis) {
  const size = priceBasis?.sampleSize ?? 0;
  return size > 0 && size < 10;
}

// 매도가와 설명문의 금액 표기가 어긋나는 매물 탐지.
// 갭투자(세안고)·총액·초기 투자금 표기가 섞이면 표시 매도가와 다른 금액이 본문에 등장해
// "N% 저렴"이라는 검증 주장과 정면으로 충돌한다. 데이터를 감추지 않고 주의를 표기한다.
const PRICE_CONFLICT_PATTERN = /세안고|세 안고|총가격|총 가격|초기약|초기 약|실투자/;

export function hasPriceConflict(property) {
  return PRICE_CONFLICT_PATTERN.test(property?.description ?? '');
}
