/*
 * propertyRegistration.js — 중개사 매물 등록 + 사진·360 업로드.
 *
 * Flow:
 *   1) 사진은 브라우저에서 긴 변 1600px JPEG 로 줄여 Storage(하이브리드) / IndexedDB(로컬)에 올리고 URL 만 media 에 담는다
 *   2) 기준 실거래가·할인율을 판정 함수로 구하고 properties 에 INSERT (로컬은 localStorage 오버레이)
 *   3) 새 매물 id 반환
 */

import { db, isHybrid } from '../lib/dataClient.js';
import { writeManagedProperty, verifyProperty } from './propertyMutations.js';
import { geocodeAddress, hasKakaoKey } from '../utils/kakaoLoader.js';
import { processPanoramaFile } from '../utils/panoramaImage.js';
import { processPhotoFile } from '../utils/photoImage.js';
import { uploadMediaSelection } from './propertyMediaUpload.js';
import { heldBasis } from '../utils/priceBasis.js';
import { resolveReferencePrice as resolveWithClient } from '../../supabase/functions/_shared/resolveReferencePrice.js';

function generatePropertyId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `gm-${ts}${rand}`;
}

async function uploadPrefix(propertyId) {
  if (!isHybrid) return `properties/${propertyId}`;
  const { data, error } = await db.auth.getSession();
  if (error || !data?.session?.user?.id) throw new Error('로그인이 필요합니다.');
  return `${data.session.user.id}/${propertyId}`;
}


export async function uploadPropertyMedia(photos, panoramas, propertyId, { onProgress } = {}) {
  return uploadMediaSelection({ storage: db.storage, prefix: await uploadPrefix(propertyId),
    photos, panoramas, processPhoto: processPhotoFile, processPanorama: processPanoramaFile, onProgress });
}

// 주소 → 좌표: 카카오 지오코딩(VITE_KAKAO_APP_KEY 있을 때). 좌표가 있어야 지도 탭·집 앞 로드뷰가 동작한다.
// 생활권(역·학교 거리) 자동 조회 백엔드는 없어 빈 값. 실패해도 등록은 계속된다(좌표 null).
async function fetchLifestyleAndCoords({ address }) {
  if (!hasKakaoKey || !address) return { lifestyle: null, coordinates: null, nearest: null, region: null };
  const coordinates = await geocodeAddress(address);
  return { lifestyle: null, coordinates, nearest: null, region: null };
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

/*
 * 기준 실거래가(할인율 계산 기준) + 산출 근거 자동 산출. 중개사가 직접 입력하지 못하게 하여 조작을 차단.
 * 규칙: docs/superpowers/specs/2026-09-29-price-basis-judgment-design.md
 *  1순위: 단지 개별 실거래(complex_trades — 하이브리드 Supabase / 로컬 번들) → 판정 함수
 *         (해제·직거래 제외 → 최근 12/24/36개월 → 같은 층 구간 → 중앙값)
 *  2순위: 단지×면적 36개월 중앙값(complex_prices) — 근거에 "전체 기간 · 층 보정 없음" 명시
 *  없음:  판정 보류(status 'insufficient') — 지역 시세·얇은 표본으로 숫자를 만들지 않는다
 * 반환: { price: number|null, source: 'complex'|null, basis }
 */
export function resolveReferencePrice(input) {
  return resolveWithClient(db, input);
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

export async function registerProperty(form, agentProfile, { onPanoramaProgress } = {}) {
  // 연락처 없는 매물은 상세 페이지에서 문의 경로가 사라진다 — 등록 단계에서 막는다.
  const contactPhone = (form.contactPhone || agentProfile?.phone || '').trim();
  if (!contactPhone) {
    throw new Error('매수자 문의 연락처를 입력해주세요. 연락처 없이는 매물을 등록할 수 없습니다.');
  }

  const id = generatePropertyId();
  const now = new Date().toISOString().slice(0, 10);

  // 1) 사진·360 파노라마 업로드 + 주소로 좌표 자동 조회 (병렬)
  const photoFiles = Array.isArray(form.photos) ? form.photos.filter(Boolean) : [];
  const panoramaItems = Array.isArray(form.panoramas) ? form.panoramas.filter(Boolean) : [];
  const [media, lookupResult] = await Promise.all([
    uploadPropertyMedia(photoFiles, panoramaItems, id, { onProgress: onPanoramaProgress }),
    form.address ? fetchLifestyleAndCoords({ address: form.address }) : Promise.resolve({ lifestyle: null, coordinates: null }),
  ]);

  const lifestyle = lookupResult.lifestyle ?? {
    subway: '', school: '', mart: '', hospital: '', convenience: '', gym: '',
  };
  const coordinates = lookupResult.coordinates ?? null;

  // gu 는 자동완성에서 고른 단지의 gu 우선, 없으면 Geocoding 결과
  const gu = form.complexGu || lookupResult.region?.gu || null;
  // Production accepts source fields only. Price evidence, approval and owner
  // are determined by property-write and the database, never by this browser.
  if (isHybrid) {
    const data = await writeManagedProperty({ action: 'create', id, input: {
      title: form.title, address: form.address, coordinates,
      region: form.complexSigungu || lookupResult.region?.gu || form.address || '',
      complex_name: form.complexName || null, complex_gu: gu,
      price: Number(form.price), area: Number(form.area),
      supply_area: Number(form.supplyArea) || Math.round(Number(form.area) * 1.33),
      floor: form.floor, direction: form.direction || null, occupancy_status: form.occupancyStatus || null,
      built_year: Number(form.builtYear) || null, description: form.description,
      parking: form.parking || '미공개', maintenance_fee: Number(form.maintenanceFee) || 0,
      move_in_date: form.moveInDate || '협의', rooms: Number(form.rooms), bathrooms: Number(form.bathrooms),
      unit_count: Number(form.unitCount) || null, contact_phone: contactPhone, media,
    } });
    return { id: data.id, panoramaFailures: [] };
  }
  const areaBucket = getAreaBucket(Number(form.area));
  const areaM2 = Number.isFinite(Number(form.area)) ? Math.floor(Number(form.area)) : null;

  // 기준 실거래가 자동 산출(개별 실거래 판정 → 중앙값 폴백 → 보류) + 13개월 추이 + 사무소명 자동
  const [reference, priceHistory, officeName] = await Promise.all([
    resolveReferencePrice({ complexName: form.complexName, gu, areaM2, floor: form.floor, price: Number(form.price) }),
    fetchPriceHistory({ gu, areaBucket }),
    fetchAgentOfficeName(agentProfile?.email),
  ]);

  // region 은 입력받지 않고 자동: 단지 시군구 > Geocoding 구 > 주소
  const region = form.complexSigungu || lookupResult.region?.gu || form.address || '';

  // 기준 실거래가·할인율: 판정 결과. 보류(status 'insufficient')면 null 로 저장해 급매로 보이지 않게 한다.
  // (예전처럼 호가를 기준가로 삼아 0% 를 만들지 않는다 — 가짜 지표)
  const sellPrice = Number(form.price);
  const held = !reference.basis || reference.basis.status === 'insufficient' || !reference.price;
  const marketPrice = held ? null : reference.price;
  const discountRate = held ? null : Number((((marketPrice - sellPrice) / marketPrice) * 100).toFixed(1));

  // ④ 할인율 산출 근거 스냅샷 (감사·표시용) — 판정 함수의 discountRate 는 행 컬럼과 중복이라 뺀다
  const { discountRate: _basisDiscount, ...basisRest } = reference.basis ?? heldBasis('no_data', { requestedAreaM2: areaM2, areaM2 });
  // 단지 정식명·구를 함께 남긴다 — 관심 단지 알림 매칭과 재계산의 키
  const priceBasis = { ...basisRest, complexName: form.complexName || null, gu: gu || null, computedAt: now };

  // 2) 매물 INSERT
  const row = {
    id,
    created_by: agentProfile?.id,
    revision: 1,
    complex_name: form.complexName || null,
    complex_gu: gu,
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
    last_verified_at: null,
    recent_transaction_date: null,
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
      // 연락처 없는 매물은 매수자에게 막다른 길이 된다 — 폼에서 입력받은 값을 우선 사용
      phone: contactPhone,
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

  // 모든 사진이 처리된 경우에만 등록을 완료한다.
  return { id: data.id, panoramaFailures: [] };
}

// 운영팀 승인 토글 — properties.verified true/false 변경
export async function setPropertyVerified(property, verified) {
  return verifyProperty(property, verified);
}
