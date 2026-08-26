/*
 * propertyRegistration.js — 중개사 매물 등록 + 사진 업로드.
 *
 * 로컬 모드 Flow:
 *   1) 사진 파일들을 브라우저에서 data URL 로 읽어 media 배열 구성
 *   2) properties 에 INSERT (localStorage 오버레이에 저장)
 *   3) 새 매물 id 반환
 */

import { db } from '../lib/dataClient.js';

function generatePropertyId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `gm-${ts}${rand}`;
}

// 로컬 모드: 사진은 Storage 대신 브라우저에서 data URL 로 읽어 매물에 그대로 저장.
// (localStorage 에 들어가므로 새로고침 후에도 보임)
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadPropertyPhotos(files, propertyId) {
  const photos = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    // eslint-disable-next-line no-await-in-loop
    const src = await readAsDataURL(file);
    photos.push({
      src,
      label: i === 0 ? '대표 사진' : `사진 ${i + 1}`,
      alt: `${propertyId} 사진 ${i + 1}`,
    });
  }
  return photos;
}

// 로컬 모드: lifestyle/좌표 자동 조회 백엔드(/api/lookup-lifestyle)가 없음 → 빈 값.
async function fetchLifestyleAndCoords() {
  return { lifestyle: null, coordinates: null, nearest: null, region: null };
}

// price_trends/complex_prices 테이블과 동일한 평형대 구간 (build-*.mjs 와 반드시 일치)
export function getAreaBucket(area) {
  if (!Number.isFinite(area)) return '미상';
  if (area <= 60) return '60㎡ 이하';
  if (area <= 85) return '60–85㎡';
  if (area <= 102) return '85–102㎡';
  if (area <= 135) return '102–135㎡';
  return '135㎡ 초과';
}

// 신뢰도 등급(표본 수 기반) — ④ 감사/투명성용. 하드 표본 가드(③)는 별도 단계.
function confidenceOf(sampleSize) {
  if (sampleSize >= 5) return 'high';
  if (sampleSize >= 3) return 'medium';
  return 'low';
}

function periodLabel(start, end) {
  if (start && end) return start === end ? start : `${start}~${end}`;
  return end || start || '';
}

// 기준 실거래가(할인율 계산 기준) + 산출 근거 자동 산출.
//  1순위: 동일 단지 + 동일 전용면적 타입(area_m2) 중앙값 (complex_prices) → 'complex'
//  2순위: 동일 단지 + 근접 면적(±2㎡) 중 표본 최다                       → 'complex'(approxArea)
//  3순위: 구 + 평형대 최근 시세 (price_trends, 재생산 포함)              → 'region'
// 중개사가 직접 입력하지 못하게 하여 할인율 조작을 차단.
export async function resolveReferencePrice({ complexName, gu, areaM2, areaBucket }) {
  if (!gu) {
    return { price: null, source: null, basis: null };
  }

  const fromComplex = (data, approxArea) => {
    const sample = Number(data.sample_size) || 0;
    return {
      price: data.median_price,
      source: 'complex',
      basis: {
        source: 'complex',
        baselinePrice: data.median_price,
        areaM2: data.area_m2,
        requestedAreaM2: Number.isFinite(areaM2) ? areaM2 : null,
        approxArea,
        sampleSize: sample,
        periodStart: data.earliest_year_month ?? null,
        periodEnd: data.latest_year_month ?? null,
        confidence: confidenceOf(sample),
        method: `동일 단지 ${data.area_m2}㎡ · ${periodLabel(data.earliest_year_month, data.latest_year_month)} ${sample}건 중앙값`,
      },
    };
  };

  // ③ 최소 표본 가드 — 같은 단지·타입 거래가 이 수 이상일 때만 기준가로 신뢰.
  //   미만이면 지역 시세로 fallback (1~2건짜리 중앙값을 권위값으로 쓰지 않음).
  const MIN_SAMPLE = 3;
  const enough = (row) => row?.median_price && (Number(row.sample_size) || 0) >= MIN_SAMPLE;

  // 지역(구+평형대) 최근 시세 — 단지 표본이 얇을 때 fallback
  const regionBasis = async () => {
    if (!areaBucket || areaBucket === '미상') return null;
    const { data: trend } = await db
      .from('price_trends')
      .select('price, year_month')
      .eq('gu', gu)
      .eq('area_bucket', areaBucket)
      .order('year_month', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!trend?.price) return null;
    return {
      price: trend.price,
      source: 'region',
      basis: {
        source: 'region',
        baselinePrice: trend.price,
        areaBucket,
        sampleSize: null,
        periodEnd: trend.year_month ?? null,
        confidence: 'region',
        method: `${gu} ${areaBucket} 최근 시세 기준`,
      },
    };
  };

  let exact = null;
  let near = null;
  if (complexName && Number.isFinite(areaM2)) {
    // 1순위: 정확 전용면적 타입 + 표본 충분
    ({ data: exact } = await db
      .from('complex_prices')
      .select('median_price, sample_size, area_m2, earliest_year_month, latest_year_month')
      .eq('complex', complexName)
      .eq('gu', gu)
      .eq('area_m2', areaM2)
      .maybeSingle());
    if (enough(exact)) return fromComplex(exact, false);

    // 2순위: 근접 면적(±2㎡) 중 표본 최다 + 표본 충분
    ({ data: near } = await db
      .from('complex_prices')
      .select('median_price, sample_size, area_m2, earliest_year_month, latest_year_month')
      .eq('complex', complexName)
      .eq('gu', gu)
      .gte('area_m2', areaM2 - 2)
      .lte('area_m2', areaM2 + 2)
      .order('sample_size', { ascending: false })
      .limit(1)
      .maybeSingle());
    if (enough(near)) return fromComplex(near, true);
  }

  // 3순위: 지역 시세 (단지 표본이 MIN_SAMPLE 미만)
  const region = await regionBasis();
  if (region) return region;

  // 4순위(최후): 지역도 없으면 얇은 단지 값이라도 사용 (confidence 'low' 로 표시됨)
  if (exact?.median_price) return fromComplex(exact, false);
  if (near?.median_price) return fromComplex(near, true);

  return { price: null, source: null, basis: null };
}

// 구/시/군 + 평형대로 13개월 실거래가 추이를 조회해 price_history 스냅샷 생성.
// 실제 거래(estimated=false) + 재생산 추정(estimated=true) 구분 플래그 포함.
async function fetchPriceHistory({ gu, areaBucket }) {
  if (!gu || !areaBucket || areaBucket === '미상') return [];
  const { data, error } = await db
    .from('price_trends')
    .select('year_month, price, is_estimated')
    .eq('gu', gu)
    .eq('area_bucket', areaBucket)
    .order('year_month', { ascending: true });
  if (error || !data) {
    if (error) console.warn('price_trends 조회 실패:', error.message);
    return [];
  }
  return data.map((row) => ({
    month: row.year_month.slice(2).replace('-', '.'), // '2025-05' → '25.05'
    yearMonth: row.year_month,
    price: row.price,
    estimated: row.is_estimated,
  }));
}

// 중개사 본인의 승인된 가입 신청서에서 사무소명 조회 (등록 폼에서 입력받지 않고 자동 채움)
async function fetchAgentOfficeName(email) {
  if (!email) return '';
  const { data } = await db
    .from('agent_applications')
    .select('office_name')
    .eq('contact_email', email)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.office_name || '';
}

export async function registerProperty(form, agentProfile) {
  const id = generatePropertyId();
  const now = new Date().toISOString().slice(0, 10);

  // 1) 사진 업로드 + 주소로 좌표/lifestyle 자동 조회 (병렬)
  const photoFiles = Array.isArray(form.photos) ? form.photos.filter(Boolean) : [];
  const [media, lookupResult] = await Promise.all([
    photoFiles.length > 0 ? uploadPropertyPhotos(photoFiles, id) : Promise.resolve([]),
    form.address ? fetchLifestyleAndCoords({ address: form.address }) : Promise.resolve({ lifestyle: null, coordinates: null }),
  ]);

  const lifestyle = lookupResult.lifestyle ?? {
    subway: '', school: '', mart: '', hospital: '', convenience: '', gym: '',
  };
  const coordinates = lookupResult.coordinates ?? null;

  // gu 는 자동완성에서 고른 단지의 gu 우선, 없으면 Geocoding 결과
  const gu = form.complexGu || lookupResult.region?.gu || null;
  const areaBucket = getAreaBucket(Number(form.area));
  const areaM2 = Number.isFinite(Number(form.area)) ? Math.floor(Number(form.area)) : null;

  // 기준 실거래가 자동 산출(단지 면적타입→근접→구 fallback) + 13개월 추이 + 사무소명 자동
  const [reference, priceHistory, officeName] = await Promise.all([
    resolveReferencePrice({ complexName: form.complexName, gu, areaM2, areaBucket }),
    fetchPriceHistory({ gu, areaBucket }),
    fetchAgentOfficeName(agentProfile?.email),
  ]);

  // region 은 입력받지 않고 자동: 단지 시군구 > Geocoding 구 > 주소
  const region = form.complexSigungu || lookupResult.region?.gu || form.address || '';

  // 기준 실거래가: 산출값 우선, 없으면 매도 호가(=할인율 0)
  const marketPrice = reference.price || Number(form.price);
  const sellPrice = Number(form.price);
  const discountRate =
    marketPrice && marketPrice > 0
      ? Number((((marketPrice - sellPrice) / marketPrice) * 100).toFixed(1))
      : 0;

  // ④ 할인율 산출 근거 스냅샷 (감사·표시용)
  const priceBasis = reference.basis
    ? { ...reference.basis, computedAt: now }
    : {
        source: 'asking',
        baselinePrice: marketPrice,
        confidence: 'none',
        method: '기준 실거래가 없음 — 호가 기준(할인율 0)',
        computedAt: now,
      };

  // 2) 매물 INSERT
  const row = {
    id,
    title: form.title,
    address: form.address,
    coordinates,
    region,
    property_type: '아파트',
    price: sellPrice,
    actual_transaction_price: marketPrice,
    discount_rate: discountRate,
    price_basis: priceBasis,
    urgent_score: 0,
    area: Number(form.area),
    supply_area: Number(form.supplyArea) || Math.round(Number(form.area) * 1.33),
    floor: form.floor,
    direction: form.direction || null,
    occupancy_status: form.occupancyStatus || null,
    built_year: Number(form.builtYear) || null,
    image_label: '',
    verified: false, // 관리자 승인 전엔 false
    last_verified_at: now,
    recent_transaction_date: now,
    description: form.description,
    parking: form.parking || '미공개',
    maintenance_fee: Number(form.maintenanceFee) || 0,
    move_in_date: form.moveInDate || '협의',
    rooms: Number(form.rooms),
    bathrooms: Number(form.bathrooms),
    unit_count: Number(form.unitCount) || null,
    agent: {
      name: agentProfile?.full_name || '담당자',
      office: officeName,
      phone: agentProfile?.phone || '',
      email: agentProfile?.email || '',
      verified: true,
    },
    lifestyle,
    price_history: priceHistory,
    media,
  };

  const { data, error } = await db
    .from('properties')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;

  // 로컬 모드: AI 리포트 실시간 생성 백엔드가 없으므로 등록 즉시 완료.
  return { id: data.id };
}

// 운영팀 승인 토글 — properties.verified true/false 변경
export async function setPropertyVerified(propertyId, verified) {
  const { data, error } = await db
    .from('properties')
    .update({ verified, last_verified_at: new Date().toISOString().slice(0, 10) })
    .eq('id', propertyId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('권한이 없거나 매물이 존재하지 않아 변경되지 않았습니다.');
  }
}
