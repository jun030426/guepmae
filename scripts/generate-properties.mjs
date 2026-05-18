/*
 * generate-properties.mjs
 *
 * scripts/data/ 의 국토부 실거래 CSV에서 단지/거래 정보를 샘플링하여
 * src/data/properties.generated.json (115건) 을 만든다.
 *
 * 분포: 수도권(서울+경기+인천) 80건 / 지방 35건
 *
 * 실행:  node scripts/generate-properties.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaultDataDir = path.join(__dirname, 'data');
const outputPath = path.join(projectRoot, 'src', 'data', 'properties.generated.json');

const TOTAL = 115;
const METRO_COUNT = 80; // 서울 + 경기 + 인천
const PROVINCIAL_COUNT = TOTAL - METRO_COUNT;
const SEED = 20260518; // 결정론적 출력을 위한 시드

// ----- 시드 기반 RNG (재현성) -----
let _seed = SEED;
function rng() {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
}
function rngBetween(min, max) {
  return min + rng() * (max - min);
}
function rngInt(min, max) {
  return Math.floor(rngBetween(min, max + 1));
}
function rngPick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function rngShuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ----- CSV 읽기 (import-trades-csv 와 동일 로직) -----
function resolveCsvPath() {
  const candidates = fs.readdirSync(defaultDataDir).filter((n) => n.toLowerCase().endsWith('.csv'));
  if (!candidates.length) throw new Error('scripts/data/ 에 .csv 파일이 없습니다.');
  return path.join(defaultDataDir, candidates[0]);
}

function readNationalCsv(csvPath) {
  const buffer = fs.readFileSync(csvPath);
  let text;
  try { text = iconv.decode(buffer, 'cp949'); } catch { text = buffer.toString('utf8'); }
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const t = line.trim();
    return t && /시군구/.test(t) && /(거래금액|단지명|전용면적)/.test(t);
  });
  if (headerIndex === -1) throw new Error('CSV 헤더를 찾지 못했습니다.');
  return lines.slice(headerIndex).join('\n');
}

function parseRows(csvBody) {
  return parse(csvBody, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
}

function pickColumn(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return undefined;
}

function parseDealAmount(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9-]/g, '');
  if (!cleaned) return null;
  const manWon = Number(cleaned);
  return Number.isFinite(manWon) ? manWon * 10000 : null;
}

function parseArea(raw) {
  if (!raw) return null;
  const value = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(value) ? value : null;
}

function parseYearMonth(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9]/g, '');
  if (cleaned.length === 6) return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}`;
  return null;
}

function getRegionLevel1(sigungu) {
  if (!sigungu) return null;
  const first = sigungu.trim().split(/\s+/)[0];
  return first.replace(/특별시$|광역시$|특별자치시$|특별자치도$/, '').replace(/도$/, '').trim();
}

function getAreaBucket(area) {
  if (area == null) return '미상';
  if (area <= 60) return '60㎡ 이하';
  if (area <= 85) return '60–85㎡';
  if (area <= 102) return '85–102㎡';
  if (area <= 135) return '102–135㎡';
  return '135㎡ 초과';
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function normalizeRow(row) {
  const sigungu = pickColumn(row, ['시군구', '시군구명', '시도']);
  const complex = pickColumn(row, ['단지명', '아파트', '아파트명']);
  const area = parseArea(pickColumn(row, ['전용면적(㎡)', '전용면적', '면적']));
  const dealAmount = parseDealAmount(pickColumn(row, ['거래금액(만원)', '거래금액', '금액']));
  const yearMonth = parseYearMonth(pickColumn(row, ['계약년월', '계약년월일', '거래년월']));
  const buildYear = Number(pickColumn(row, ['건축년도', '준공년도']) ?? '') || null;
  const floor = pickColumn(row, ['층']) ?? '';
  if (!sigungu || !complex || dealAmount == null) return null;
  return {
    region: getRegionLevel1(sigungu),
    sigungu: sigungu.trim(),
    complex: complex.trim(),
    area,
    areaBucket: getAreaBucket(area),
    dealAmount,
    yearMonth,
    buildYear,
    floor,
  };
}

// ----- 시군구 → 좌표 (중심점) -----
const REGION_CENTROIDS = {
  // 서울 25개 구
  '서울특별시 강남구': [37.5172, 127.0473],
  '서울특별시 강동구': [37.5301, 127.1238],
  '서울특별시 강북구': [37.6396, 127.0257],
  '서울특별시 강서구': [37.5509, 126.8495],
  '서울특별시 관악구': [37.4784, 126.9516],
  '서울특별시 광진구': [37.5384, 127.0822],
  '서울특별시 구로구': [37.4954, 126.8874],
  '서울특별시 금천구': [37.4566, 126.8956],
  '서울특별시 노원구': [37.6543, 127.0568],
  '서울특별시 도봉구': [37.6688, 127.0471],
  '서울특별시 동대문구': [37.5744, 127.0397],
  '서울특별시 동작구': [37.5124, 126.9393],
  '서울특별시 마포구': [37.5663, 126.9019],
  '서울특별시 서대문구': [37.5791, 126.9368],
  '서울특별시 서초구': [37.4837, 127.0324],
  '서울특별시 성동구': [37.5635, 127.0367],
  '서울특별시 성북구': [37.5894, 127.0167],
  '서울특별시 송파구': [37.5145, 127.1059],
  '서울특별시 양천구': [37.5170, 126.8665],
  '서울특별시 영등포구': [37.5263, 126.8962],
  '서울특별시 용산구': [37.5384, 126.9654],
  '서울특별시 은평구': [37.6027, 126.9291],
  '서울특별시 종로구': [37.5735, 126.9789],
  '서울특별시 중구': [37.5638, 126.9975],
  '서울특별시 중랑구': [37.6063, 127.0928],
  // 경기 주요 시
  '경기도 수원시': [37.2636, 127.0286],
  '경기도 성남시': [37.4203, 127.1265],
  '경기도 안양시': [37.3943, 126.9568],
  '경기도 안산시': [37.3219, 126.8309],
  '경기도 부천시': [37.5035, 126.7660],
  '경기도 광명시': [37.4783, 126.8645],
  '경기도 고양시': [37.6584, 126.8320],
  '경기도 의정부시': [37.7381, 127.0337],
  '경기도 용인시': [37.2410, 127.1776],
  '경기도 화성시': [37.1996, 126.8311],
  '경기도 시흥시': [37.3800, 126.8030],
  '경기도 광주시': [37.4296, 127.2553],
  '경기도 김포시': [37.6152, 126.7158],
  '경기도 파주시': [37.7600, 126.7800],
  '경기도 평택시': [36.9921, 127.1129],
  '경기도 하남시': [37.5394, 127.2148],
  '경기도 군포시': [37.3617, 126.9354],
  '경기도 의왕시': [37.3447, 126.9683],
  '경기도 이천시': [37.2722, 127.4350],
  '경기도 안성시': [37.0080, 127.2799],
  '경기도 양주시': [37.7853, 127.0455],
  '경기도 오산시': [37.1500, 127.0772],
  '경기도 구리시': [37.5944, 127.1297],
  '경기도 남양주시': [37.6359, 127.2168],
  // 인천 구
  '인천광역시 중구': [37.4738, 126.6213],
  '인천광역시 동구': [37.4738, 126.6431],
  '인천광역시 미추홀구': [37.4634, 126.6502],
  '인천광역시 연수구': [37.4101, 126.6781],
  '인천광역시 남동구': [37.4475, 126.7314],
  '인천광역시 부평구': [37.5072, 126.7218],
  '인천광역시 계양구': [37.5374, 126.7378],
  '인천광역시 서구': [37.5455, 126.6755],
  // 광역시
  '부산광역시 해운대구': [35.1631, 129.1635],
  '부산광역시 수영구': [35.1455, 129.1130],
  '부산광역시 동래구': [35.1995, 129.0780],
  '부산광역시 부산진구': [35.1631, 129.0532],
  '부산광역시 사하구': [35.1041, 128.9745],
  '부산광역시 남구': [35.1366, 129.0843],
  '부산광역시 북구': [35.1971, 129.0124],
  '부산광역시 강서구': [35.2122, 128.9809],
  '부산광역시 사상구': [35.1525, 128.9914],
  '부산광역시 금정구': [35.2429, 129.0925],
  '부산광역시 연제구': [35.1764, 129.0795],
  '대구광역시 중구': [35.8694, 128.6062],
  '대구광역시 수성구': [35.8581, 128.6307],
  '대구광역시 달서구': [35.8294, 128.5328],
  '대구광역시 동구': [35.8866, 128.6356],
  '대구광역시 북구': [35.8853, 128.5828],
  '대구광역시 남구': [35.8463, 128.5972],
  '광주광역시 동구': [35.1467, 126.9234],
  '광주광역시 서구': [35.1521, 126.8907],
  '광주광역시 광산구': [35.1395, 126.7942],
  '광주광역시 북구': [35.1742, 126.9120],
  '광주광역시 남구': [35.1330, 126.9027],
  '대전광역시 유성구': [36.3614, 127.3567],
  '대전광역시 서구': [36.3550, 127.3845],
  '대전광역시 중구': [36.3262, 127.4222],
  '대전광역시 동구': [36.3119, 127.4548],
  '대전광역시 대덕구': [36.3470, 127.4153],
  '울산광역시 남구': [35.5439, 129.3296],
  '울산광역시 중구': [35.5697, 129.3328],
  '울산광역시 북구': [35.5826, 129.3613],
  '울산광역시 동구': [35.5046, 129.4170],
  '세종특별자치시': [36.4801, 127.2890],
  // 도
  '강원도 춘천시': [37.8813, 127.7298],
  '강원도 강릉시': [37.7519, 128.8761],
  '강원도 원주시': [37.3422, 127.9202],
  '강원도 속초시': [38.2070, 128.5918],
  '강원특별자치도 춘천시': [37.8813, 127.7298],
  '강원특별자치도 강릉시': [37.7519, 128.8761],
  '강원특별자치도 원주시': [37.3422, 127.9202],
  '충청북도 청주시': [36.6424, 127.4890],
  '충청북도 충주시': [36.9910, 127.9259],
  '충청남도 천안시': [36.8151, 127.1139],
  '충청남도 아산시': [36.7898, 127.0029],
  '충청남도 당진시': [36.8930, 126.6457],
  '충청남도 서산시': [36.7848, 126.4503],
  '전라북도 전주시': [35.8242, 127.1480],
  '전라북도 군산시': [35.9676, 126.7370],
  '전북특별자치도 전주시': [35.8242, 127.1480],
  '전라남도 여수시': [34.7604, 127.6622],
  '전라남도 순천시': [34.9506, 127.4872],
  '전라남도 목포시': [34.8118, 126.3922],
  '경상북도 포항시': [36.0190, 129.3435],
  '경상북도 구미시': [36.1196, 128.3447],
  '경상북도 경주시': [35.8562, 129.2247],
  '경상남도 창원시': [35.2280, 128.6811],
  '경상남도 김해시': [35.2342, 128.8895],
  '경상남도 진주시': [35.1800, 128.1076],
  '경상남도 양산시': [35.3350, 129.0376],
  '제주특별자치도 제주시': [33.4996, 126.5312],
  '제주특별자치도 서귀포시': [33.2541, 126.5601],
};

const PROVINCE_FALLBACK = {
  '서울': [37.5665, 126.9780],
  '경기': [37.4138, 127.5183],
  '인천': [37.4563, 126.7052],
  '부산': [35.1796, 129.0756],
  '대구': [35.8714, 128.6014],
  '광주': [35.1595, 126.8526],
  '대전': [36.3504, 127.3845],
  '울산': [35.5384, 129.3114],
  '세종': [36.4801, 127.2890],
  '강원': [37.8228, 128.1555],
  '충북': [36.6357, 127.4914],
  '충남': [36.5184, 126.8000],
  '전북': [35.7167, 127.1442],
  '전남': [34.8161, 126.4630],
  '경북': [36.5759, 128.5052],
  '경남': [35.4606, 128.2132],
  '제주': [33.4890, 126.4983],
};

function getCoordinates(sigungu) {
  // 시도 + 시군구만 추출 (예: "서울특별시 강남구 역삼동" → "서울특별시 강남구")
  const parts = sigungu.split(/\s+/);
  for (let take = Math.min(3, parts.length); take >= 2; take--) {
    const key = parts.slice(0, take).join(' ');
    if (REGION_CENTROIDS[key]) return REGION_CENTROIDS[key];
  }
  if (parts.length === 1 && REGION_CENTROIDS[parts[0]]) return REGION_CENTROIDS[parts[0]];
  const province = getRegionLevel1(sigungu);
  return PROVINCE_FALLBACK[province] || [36.5, 127.5];
}

function jitterCoords([lat, lng]) {
  // ±0.008 정도 = 약 ±900m 이내
  return {
    lat: Number((lat + (rng() - 0.5) * 0.016).toFixed(6)),
    lng: Number((lng + (rng() - 0.5) * 0.016).toFixed(6)),
  };
}

// ----- 매물 필드 보조 -----
function getRoomCount(area) {
  if (area == null) return 2;
  if (area < 40) return 1;
  if (area < 60) return 2;
  if (area < 95) return 3;
  return 4;
}

function getBathCount(rooms, area) {
  if (rooms <= 1) return 1;
  if (rooms === 2) return 1;
  if (rooms === 3) return area > 80 ? 2 : 1;
  return 2;
}

function getRegionLabel(sigungu) {
  const parts = sigungu.split(/\s+/);
  if (parts.length >= 2) {
    const province = getRegionLevel1(sigungu);
    return `${province} ${parts[1]}`;
  }
  return getRegionLevel1(sigungu);
}

function formatDate(yearMonth, day) {
  if (!yearMonth) return '2026-05-01';
  const [y, m] = yearMonth.split('-');
  const dd = String(day ?? rngInt(1, 28)).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatMonthLabel(monthsAgo) {
  // 2026-05 기준으로 N개월 전
  const baseY = 2026, baseM = 5;
  let m = baseM - monthsAgo;
  let y = baseY;
  while (m < 1) { m += 12; y -= 1; }
  return `${m}월`;
}

const AGENT_POOL = [
  { name: '김도현', office: '프라임공인중개사', phone: '02-548-9031' },
  { name: '박지영', office: '한솔공인중개사', phone: '02-3445-7821' },
  { name: '이수민', office: '동부공인중개사', phone: '031-704-2210' },
  { name: '최우진', office: '한강뷰공인중개사', phone: '02-2666-1900' },
  { name: '정하늘', office: '시티공인중개사', phone: '02-577-8312' },
  { name: '윤서연', office: '플러스공인중개사', phone: '032-451-9087' },
  { name: '강민호', office: '센트럴공인중개사', phone: '051-742-3308' },
  { name: '한지수', office: '베스트공인중개사', phone: '053-261-7745' },
];

const SCHOOL_POOL = ['초등학교', '중학교', '고등학교'];
const MART_POOL = ['이마트', '홈플러스', '롯데마트', '코스트코'];
const HOSPITAL_POOL = ['종합병원', '대학병원', '의료원'];
const PARK_POOL = ['중앙공원', '근린공원', '체육공원', '수변공원'];

function generateLifestyle(district) {
  const baseTimes = [4, 5, 6, 7, 8, 10, 12, 15];
  return {
    subway: `${district} 지하철역 도보 ${rngPick(baseTimes)}분`,
    school: `${district} ${rngPick(SCHOOL_POOL)} 도보 ${rngPick(baseTimes)}분`,
    mart: `${rngPick(MART_POOL)} ${district}점 차량 ${rngInt(3, 10)}분`,
    hospital: `${district} ${rngPick(HOSPITAL_POOL)} 차량 ${rngInt(5, 15)}분`,
    park: `${district} ${rngPick(PARK_POOL)} 도보 ${rngPick(baseTimes)}분`,
    commute: `강남역 기준 약 ${rngInt(15, 70)}분`,
  };
}

function generatePriceHistory(currentPrice, peerMedian) {
  // 6개월: 가장 최근(5월)은 현재 가격, 나머지는 peerMedian ± 작은 분산
  const history = [];
  for (let i = 5; i >= 1; i--) {
    const variance = 0.97 + rng() * 0.06; // 0.97 ~ 1.03
    history.push({
      month: formatMonthLabel(i),
      price: Math.round(peerMedian * variance),
    });
  }
  history.push({ month: formatMonthLabel(0), price: currentPrice });
  return history;
}

function getUnitCount() {
  // 단지 규모 — 60~3000 정규분포-ish
  const r = rng();
  if (r < 0.15) return rngInt(60, 99);
  if (r < 0.45) return rngInt(100, 499);
  if (r < 0.80) return rngInt(500, 999);
  return rngInt(1000, 3000);
}

function buildProperty(id, complex, transaction, peerMedian) {
  const rooms = getRoomCount(transaction.area);
  const bathrooms = getBathCount(rooms, transaction.area);
  const discount = 5 + rng() * 10; // 5 ~ 15%
  const price = Math.round((peerMedian ?? transaction.dealAmount) * (1 - discount / 100));
  const actualTransactionPrice = peerMedian ?? Math.round(transaction.dealAmount * 1.05);
  const realDiscount = Number((((actualTransactionPrice - price) / actualTransactionPrice) * 100).toFixed(1));
  const urgentScore = Math.min(99, Math.round(60 + realDiscount * 2.5));
  const supplyArea = Math.round(transaction.area * 1.33);
  const coords = jitterCoords(getCoordinates(transaction.sigungu));
  const regionLabel = getRegionLabel(transaction.sigungu);
  const district = regionLabel.split(' ')[1] || regionLabel;
  const floorNum = Number(String(transaction.floor).replace(/[^0-9-]/g, '')) || rngInt(3, 25);
  const verifiedRand = rng();
  const verified = verifiedRand > 0.15;
  const recentDate = formatDate(transaction.yearMonth);
  const verifyDate = formatDate('2026-05', rngInt(1, 17));

  return {
    id,
    title: `${complex} ${Math.round(transaction.area)}`,
    address: `${transaction.sigungu}`,
    coordinates: coords,
    region: regionLabel,
    propertyType: '아파트',
    price,
    actualTransactionPrice,
    discountRate: realDiscount,
    urgentScore,
    area: Math.round(transaction.area),
    supplyArea,
    floor: `${floorNum}층`,
    builtYear: transaction.buildYear ?? rngInt(2005, 2023),
    imageLabel: '',
    verified,
    lastVerifiedAt: verifyDate,
    recentTransactionDate: recentDate,
    description: `${regionLabel} 생활권의 실거래 대비 ${realDiscount}% 저렴한 매물입니다.`,
    parking: `세대당 ${(0.8 + rng() * 1.2).toFixed(1)}대`,
    maintenanceFee: rngInt(15, 50) * 10000,
    moveInDate: rngPick(['즉시 입주 가능', '협의 가능', '잔금 후 1개월', '잔금 후 2개월']),
    rooms,
    bathrooms,
    unitCount: getUnitCount(),
    agent: { ...rngPick(AGENT_POOL), verified: true },
    lifestyle: generateLifestyle(district),
    priceHistory: generatePriceHistory(price, actualTransactionPrice),
  };
}

// ----- 메인 -----
function main() {
  console.log('Reading CSV...');
  const csvPath = resolveCsvPath();
  const csvBody = readNationalCsv(csvPath);
  const rawRows = parseRows(csvBody);
  const rows = rawRows.map(normalizeRow).filter(Boolean);
  console.log(`Parsed ${rows.length} rows.`);

  // peer median: 단지 × areaBucket
  const groupKey = (r) => `${r.complex}__${r.areaBucket}`;
  const groups = new Map();
  rows.forEach((r) => {
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const peerMedians = new Map();
  groups.forEach((arr, key) => {
    if (arr.length >= 3) peerMedians.set(key, median(arr.map((x) => x.dealAmount)));
  });

  // 단지(complex) 단위 묶음
  const complexMap = new Map(); // sigungu+complex → { complex, sigungu, region, transactions[] }
  rows.forEach((r) => {
    const key = `${r.sigungu}__${r.complex}`;
    if (!complexMap.has(key)) {
      complexMap.set(key, { complex: r.complex, sigungu: r.sigungu, region: r.region, transactions: [] });
    }
    complexMap.get(key).transactions.push(r);
  });
  const complexes = [...complexMap.values()];
  console.log(`Unique complexes: ${complexes.length}`);

  const isMetro = (region) => region === '서울' || region === '경기' || region === '인천';
  const metroComplexes = rngShuffle(complexes.filter((c) => isMetro(c.region)));
  const provincialComplexes = rngShuffle(complexes.filter((c) => !isMetro(c.region)));
  console.log(`Metro: ${metroComplexes.length}, Provincial: ${provincialComplexes.length}`);

  const samples = [];

  function takeFrom(pool, count) {
    const taken = [];
    for (const c of pool) {
      if (taken.length >= count) break;
      const tx = rngPick(c.transactions);
      const peer = peerMedians.get(`${c.complex}__${tx.areaBucket}`);
      if (peer == null) continue; // peer 없으면 건너뜀
      taken.push({ complex: c.complex, sigungu: c.sigungu, transaction: tx, peer });
    }
    return taken;
  }

  const metroSamples = takeFrom(metroComplexes, METRO_COUNT);
  const provincialSamples = takeFrom(provincialComplexes, PROVINCIAL_COUNT);

  const all = [...metroSamples, ...provincialSamples];
  if (all.length < TOTAL) {
    console.warn(`Only ${all.length} samples available; padding from remaining.`);
    const extra = takeFrom([...metroComplexes, ...provincialComplexes].slice(all.length), TOTAL - all.length);
    all.push(...extra);
  }

  const properties = all.slice(0, TOTAL).map((sample, idx) => {
    const id = `gm-${String(idx + 1).padStart(3, '0')}`;
    return buildProperty(id, sample.complex, sample.transaction, sample.peer);
  });

  fs.writeFileSync(outputPath, JSON.stringify(properties, null, 2), 'utf8');
  const metroFinal = properties.filter((p) => ['서울', '경기', '인천'].includes(p.region.split(' ')[0])).length;
  console.log(`\nWrote ${properties.length} properties to ${path.relative(projectRoot, outputPath)}`);
  console.log(`Distribution — metro: ${metroFinal}, provincial: ${properties.length - metroFinal}`);
}

main();
