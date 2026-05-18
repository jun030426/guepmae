/*
 * marketData.js — 국토부 실거래가 API 응답 구조를 흉내낸 mock 데이터
 *
 * 실제 국토부 API (RTMSDataSvcAptTradeDev)는 거래 1건씩 XML로 반환:
 *   { dealAmount, buildYear, dealYear, dealMonth, dealDay,
 *     legalDong, aptName, area, floor, jibun, regionCode }
 *
 * 본 파일은 그 거래를 집계한 결과(평균, 추세, 분포)를 미리 계산해둔 형태.
 * 추후 ETL 파이프라인이 Supabase에 적재한 데이터를 같은 shape으로 노출시키면
 * 페이지/서비스 코드를 거의 손대지 않고 교체 가능.
 */

const CURRENT_MONTH_LABEL = '5월';

/* 시도별 집계 — 최근 30일 기준 */
export const regionalSnapshots = [
  {
    code: '11',
    region: '서울',
    averageDiscount: 6.9,
    averageDealPrice: 1452000000,
    transactionVolume: 412,
    urgentRatio: 0.18,
  },
  {
    code: '41',
    region: '경기',
    averageDiscount: 7.4,
    averageDealPrice: 826000000,
    transactionVolume: 538,
    urgentRatio: 0.22,
  },
  {
    code: '28',
    region: '인천',
    averageDiscount: 8.7,
    averageDealPrice: 542000000,
    transactionVolume: 192,
    urgentRatio: 0.31,
  },
  {
    code: '26',
    region: '부산',
    averageDiscount: 8.6,
    averageDealPrice: 624000000,
    transactionVolume: 168,
    urgentRatio: 0.29,
  },
  {
    code: '29',
    region: '광주',
    averageDiscount: 8.1,
    averageDealPrice: 412000000,
    transactionVolume: 84,
    urgentRatio: 0.27,
  },
  {
    code: '30',
    region: '대전',
    averageDiscount: 7.2,
    averageDealPrice: 468000000,
    transactionVolume: 76,
    urgentRatio: 0.21,
  },
  {
    code: '27',
    region: '대구',
    averageDiscount: 9.2,
    averageDealPrice: 514000000,
    transactionVolume: 142,
    urgentRatio: 0.34,
  },
  {
    code: '31',
    region: '울산',
    averageDiscount: 6.8,
    averageDealPrice: 458000000,
    transactionVolume: 52,
    urgentRatio: 0.19,
  },
];

/* 12개월 추이 */
export const monthlyMarketTrend = [
  { month: '6월', averageDiscount: 4.8, urgentCount: 33, transactionVolume: 1284, averageDealPrice: 812000000 },
  { month: '7월', averageDiscount: 5.1, urgentCount: 38, transactionVolume: 1242, averageDealPrice: 808000000 },
  { month: '8월', averageDiscount: 5.4, urgentCount: 41, transactionVolume: 1198, averageDealPrice: 802000000 },
  { month: '9월', averageDiscount: 5.7, urgentCount: 44, transactionVolume: 1156, averageDealPrice: 794000000 },
  { month: '10월', averageDiscount: 5.5, urgentCount: 42, transactionVolume: 1188, averageDealPrice: 796000000 },
  { month: '11월', averageDiscount: 5.8, urgentCount: 46, transactionVolume: 1142, averageDealPrice: 789000000 },
  { month: '12월', averageDiscount: 5.6, urgentCount: 42, transactionVolume: 1121, averageDealPrice: 786000000 },
  { month: '1월', averageDiscount: 5.9, urgentCount: 47, transactionVolume: 1098, averageDealPrice: 781000000 },
  { month: '2월', averageDiscount: 6.4, urgentCount: 53, transactionVolume: 1072, averageDealPrice: 774000000 },
  { month: '3월', averageDiscount: 6.8, urgentCount: 61, transactionVolume: 1019, averageDealPrice: 768000000 },
  { month: '4월', averageDiscount: 7.3, urgentCount: 68, transactionVolume: 984, averageDealPrice: 761000000 },
  { month: CURRENT_MONTH_LABEL, averageDiscount: 7.8, urgentCount: 76, transactionVolume: 942, averageDealPrice: 754000000 },
];

/* 면적대별 평균가/할인율 — 전용면적 기준 */
export const areaTypeBreakdown = [
  { bucket: '60㎡ 이하', averageDealPrice: 412000000, averageDiscount: 6.1, transactionVolume: 482 },
  { bucket: '60–85㎡', averageDealPrice: 684000000, averageDiscount: 7.4, transactionVolume: 728 },
  { bucket: '85–102㎡', averageDealPrice: 928000000, averageDiscount: 8.2, transactionVolume: 412 },
  { bucket: '102–135㎡', averageDealPrice: 1284000000, averageDiscount: 8.6, transactionVolume: 218 },
  { bucket: '135㎡ 초과', averageDealPrice: 1742000000, averageDiscount: 7.1, transactionVolume: 96 },
];

/* 급매 집중 단지 Top 10 */
export const topUrgentComplexes = [
  { rank: 1, complex: '래미안 송파파인탑', region: '서울 송파구', dealCount: 18, averageDiscount: 11.2, sampleSize: 42 },
  { rank: 2, complex: '센텀 푸르지오', region: '부산 해운대구', dealCount: 14, averageDiscount: 10.8, sampleSize: 38 },
  { rank: 3, complex: '판교 알파리움', region: '경기 성남시', dealCount: 13, averageDiscount: 10.4, sampleSize: 34 },
  { rank: 4, complex: '송도 더샵 센트럴파크', region: '인천 연수구', dealCount: 12, averageDiscount: 10.1, sampleSize: 41 },
  { rank: 5, complex: '광교 자연앤힐스테이트', region: '경기 수원시', dealCount: 11, averageDiscount: 9.8, sampleSize: 29 },
  { rank: 6, complex: '마린시티 자이', region: '부산 해운대구', dealCount: 10, averageDiscount: 9.7, sampleSize: 26 },
  { rank: 7, complex: '수완 도그제일풍경채', region: '광주 광산구', dealCount: 10, averageDiscount: 9.5, sampleSize: 24 },
  { rank: 8, complex: '동탄역 시범예미지', region: '경기 화성시', dealCount: 9, averageDiscount: 9.2, sampleSize: 22 },
  { rank: 9, complex: '청라 푸르지오', region: '인천 서구', dealCount: 9, averageDiscount: 9.0, sampleSize: 21 },
  { rank: 10, complex: '대구 수성 SK리더스뷰', region: '대구 수성구', dealCount: 8, averageDiscount: 8.9, sampleSize: 19 },
];

/* 시장 관찰 포인트 — 인사이트 카드용 */
export const marketInsights = [
  {
    label: '평균 할인율',
    value: '7.8%',
    direction: 'up',
    delta: '+0.5%p',
    note: '전월 대비',
  },
  {
    label: '급매 매물 수',
    value: '942건',
    direction: 'up',
    delta: '+8.4%',
    note: '최근 30일',
  },
  {
    label: '전국 평균 거래가',
    value: '7억 5,400만',
    direction: 'down',
    delta: '-0.9%',
    note: '전월 대비',
  },
  {
    label: '거래량',
    value: '942건',
    direction: 'down',
    delta: '-4.3%',
    note: '시장 위축 지표',
  },
];

/* 데이터 소스 메타 */
export const dataSource = {
  name: '국토교통부 실거래가 공개시스템 (Mock)',
  endpoint: 'RTMSDataSvcAptTradeDev (예정)',
  lastUpdated: '2026-05-15',
  disclosureLag: '계약일 기준 약 2주 후 공개',
};
