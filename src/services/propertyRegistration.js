/*
 * propertyRegistration.js — 중개사 매물 등록 + 사진 업로드 + AI 리포트 자동 생성.
 *
 * Flow:
 *   1) 사진 파일들이 있으면 Supabase Storage(property-photos) 에 업로드 → public URL 배열
 *   2) properties 테이블에 INSERT (media 컬럼에 URL 배열 저장)
 *   3) /api/property-report?id=newId 호출 → 서버에서 AI 리포트 생성
 *   4) 새 매물 id 반환
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

function generatePropertyId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `gm-${ts}${rand}`;
}

export async function uploadPropertyPhotos(files, propertyId) {
  const photos = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${propertyId}/${Date.now()}-${i}-${safeName}`;
    const { error } = await supabase.storage
      .from('property-photos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });
    if (error) throw new Error(`사진 업로드 실패 (${file.name}): ${error.message}`);

    const { data: pub } = supabase.storage
      .from('property-photos')
      .getPublicUrl(filePath);
    photos.push({
      src: pub.publicUrl,
      label: i === 0 ? '대표 사진' : `사진 ${i + 1}`,
      alt: `${propertyId} 사진 ${i + 1}`,
    });
  }
  return photos;
}

// 좌표가 있으면 그걸로, 없으면 주소로 lookup → 좌표 + lifestyle 한 번에 받음
async function fetchLifestyleAndCoords({ lat, lng, address }) {
  try {
    const params = lat && lng
      ? `lat=${lat}&lng=${lng}`
      : `address=${encodeURIComponent(address)}`;
    const res = await fetch(`/api/lookup-lifestyle?${params}`);
    if (!res.ok) return { lifestyle: null, coordinates: null, nearest: null, region: null };
    const data = await res.json();
    return {
      lifestyle: data.lifestyle,
      coordinates: data.coordinates,
      nearest: data.nearest,
      region: data.region,
    };
  } catch (err) {
    console.warn('lifestyle lookup failed:', err);
    return { lifestyle: null, coordinates: null, nearest: null, region: null };
  }
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

// 기준 실거래가(할인율 계산 기준) 자동 산출.
//  1순위: 단지+구+평형 실거래 중앙값 (complex_prices)  → source 'complex'
//  2순위: 구+평형 최근월 시세 (price_trends, 재생산 포함) → source 'region'
// 중개사가 직접 입력하지 못하게 하여 할인율 조작을 차단.
export async function resolveReferencePrice({ complexName, gu, areaBucket }) {
  if (!isSupabaseConfigured || !gu || !areaBucket || areaBucket === '미상') {
    return { price: null, source: null };
  }
  if (complexName) {
    const { data } = await supabase
      .from('complex_prices')
      .select('median_price')
      .eq('complex', complexName)
      .eq('gu', gu)
      .eq('area_bucket', areaBucket)
      .maybeSingle();
    if (data?.median_price) return { price: data.median_price, source: 'complex' };
  }
  const { data: trend } = await supabase
    .from('price_trends')
    .select('price')
    .eq('gu', gu)
    .eq('area_bucket', areaBucket)
    .order('year_month', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (trend?.price) return { price: trend.price, source: 'region' };
  return { price: null, source: null };
}

// 구/시/군 + 평형대로 13개월 실거래가 추이를 조회해 price_history 스냅샷 생성.
// 실제 거래(estimated=false) + 재생산 추정(estimated=true) 구분 플래그 포함.
async function fetchPriceHistory({ gu, areaBucket }) {
  if (!gu || !areaBucket || areaBucket === '미상') return [];
  const { data, error } = await supabase
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
  const { data } = await supabase
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
  if (!isSupabaseConfigured) {
    throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  }

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

  // 기준 실거래가 자동 산출(단지→구 fallback) + 13개월 추이 스냅샷 + 사무소명 자동
  const [reference, priceHistory, officeName] = await Promise.all([
    resolveReferencePrice({ complexName: form.complexName, gu, areaBucket }),
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

  const { data, error } = await supabase
    .from('properties')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;

  // 3) AI 리포트 백그라운드 생성 (실패해도 등록 자체는 성공)
  triggerReportGeneration(data.id).catch((err) => {
    console.warn('AI 리포트 생성 실패 (등록은 완료됨):', err);
  });

  return { id: data.id };
}

async function triggerReportGeneration(propertyId) {
  const res = await fetch(`/api/property-report?id=${encodeURIComponent(propertyId)}`);
  if (!res.ok) throw new Error(`AI report failed: ${res.status}`);
  return res.json();
}

// 운영팀 승인 토글 — properties.verified true/false 변경
// .select() 로 실제로 업데이트된 row 가져와서 RLS silent 차단 (0 rows) 도 에러로 처리
export async function setPropertyVerified(propertyId, verified) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  }
  const { data, error } = await supabase
    .from('properties')
    .update({ verified, last_verified_at: new Date().toISOString().slice(0, 10) })
    .eq('id', propertyId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('권한이 없거나 매물이 존재하지 않아 변경되지 않았습니다.');
  }
}
