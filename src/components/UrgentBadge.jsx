function UrgentBadge({ discountRate, verified }) {
  let label = '일반 매물';
  let tone = 'neutral';

  if (!verified) {
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
