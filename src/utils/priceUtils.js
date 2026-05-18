export function calculateDiscountRate(price, actualTransactionPrice) {
  if (!price || !actualTransactionPrice || actualTransactionPrice <= 0) {
    return 0;
  }

  const discountRate = ((actualTransactionPrice - price) / actualTransactionPrice) * 100;
  return Number(discountRate.toFixed(1));
}

export function isUrgentSale(price, actualTransactionPrice) {
  return calculateDiscountRate(price, actualTransactionPrice) >= 5;
}

export function calculatePriceGap(price, actualTransactionPrice) {
  if (!price || !actualTransactionPrice) {
    return 0;
  }

  return actualTransactionPrice - price;
}

export function calculateUrgentScore(property) {
  const discountRate =
    property.discountRate ??
    calculateDiscountRate(property.price, property.actualTransactionPrice);
  const discountScore = Math.min(70, Math.max(0, discountRate * 6));
  const verifiedScore = property.verified ? 18 : 4;
  const verifiedDate = new Date(property.lastVerifiedAt);
  const now = new Date();
  const daysSinceVerified = Number.isNaN(verifiedDate.getTime())
    ? 999
    : Math.floor((now - verifiedDate) / (1000 * 60 * 60 * 24));

  let recencyScore = 0;
  if (daysSinceVerified <= 3) recencyScore = 12;
  else if (daysSinceVerified <= 7) recencyScore = 10;
  else if (daysSinceVerified <= 14) recencyScore = 7;
  else if (daysSinceVerified <= 30) recencyScore = 4;

  return Math.min(100, Math.round(discountScore + verifiedScore + recencyScore));
}

export function formatPrice(price) {
  if (!Number.isFinite(Number(price))) {
    return '가격 확인 필요';
  }

  const numericPrice = Math.round(Number(price));
  const eok = Math.floor(numericPrice / 100000000);
  const man = Math.floor((numericPrice % 100000000) / 10000);

  if (eok > 0 && man > 0) {
    return `${eok}억 ${man.toLocaleString('ko-KR')}만 원`;
  }

  if (eok > 0) {
    return `${eok}억 원`;
  }

  if (man > 0) {
    return `${man.toLocaleString('ko-KR')}만 원`;
  }

  return `${numericPrice.toLocaleString('ko-KR')}원`;
}
