// discountRate 가 null 이면 판정 보류(표본 부족·데이터 없음) — 급매 배지를 달지 않는다.
function UrgentBadge({ discountRate, verified }) {
  let label = '일반 매물';
  let tone = 'neutral';

  if (discountRate == null) {
    label = '판정 보류';
    tone = 'held';
  } else if (!verified) {
    label = '검증 대기';
    tone = 'pending';
  } else if (discountRate >= 10) {
    label = '초급매';
    tone = 'hot';
  } else if (discountRate >= 5) {
    label = '급매';
    tone = 'urgent';
  }

  return <span className={`urgent-badge ${tone}`}>{label}</span>;
}

export default UrgentBadge;
