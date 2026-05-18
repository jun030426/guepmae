// 매물 데이터는 scripts/generate-properties.mjs 로 국토부 실거래 CSV에서 생성된다.
// 재생성: `node scripts/generate-properties.mjs`
import generated from './properties.generated.json';

export const properties = generated;

// 홈 페이지 AreaChart 용 — 월별 급매 트렌드 (별도 데이터)
export const monthlyUrgentTrend = [
  { month: '12월', averageDiscount: 5.6, urgentCount: 42, transactionVolume: 121 },
  { month: '1월', averageDiscount: 5.9, urgentCount: 47, transactionVolume: 118 },
  { month: '2월', averageDiscount: 6.4, urgentCount: 53, transactionVolume: 112 },
  { month: '3월', averageDiscount: 6.8, urgentCount: 61, transactionVolume: 109 },
  { month: '4월', averageDiscount: 7.3, urgentCount: 68, transactionVolume: 104 },
  { month: '5월', averageDiscount: 7.8, urgentCount: 76, transactionVolume: 99 },
];
