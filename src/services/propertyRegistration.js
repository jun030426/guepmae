/*
 * propertyRegistration.js — 중개사 매물 등록 + 사진 업로드.
 *
 * 로컬 모드 Flow:
 *   1) 사진 파일들을 브라우저에서 data URL 로 읽어 media 배열 구성
 *   2) properties 에 INSERT (localStorage 오버레이에 저장)
 *   3) 새 매물 id 반환
 */

import { db, isHybrid } from '../lib/dataClient.js';
import { geocodeAddress, hasKakaoKey } from '../utils/kakaoLoader.js';
import { processPanoramaFile } from '../utils/panoramaImage.js';
import { panoramaMediaItem } from '../utils/panoramaTour.js';
import {
  basisFromComplexRow,
  computePriceBasis,
  expandTradeRow,
  heldBasis,
  MIN_SAMPLE as BASIS_MIN_SAMPLE,
} from '../utils/priceBasis.js';

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

/*
 * 3D 모델(.glb/.gltf) 업로드 — Storage 전용 (하이브리드 모드에서만).
 * 사진과 달리 수 MB~수십 MB 라 data URL 로 매물 행에 넣을 수 없다.
 * 반환: media 항목 { type: '3d', src, label } 또는 null.
 */
export const canUpload3DModel = isHybrid;

export async function uploadProperty3DModel(file, propertyId) {
  if (!isHybrid || !file) return null;
  const isGltfJson = /\.gltf$/i.test(file.name);
  const ext = isGltfJson ? 'gltf' : 'glb';
  const path = `properties/${propertyId}/model-${Date.now()}.${ext}`;
  const { error } = await db.storage.from('property-3d').upload(path, file, {
    contentType: isGltfJson ? 'model/gltf+json' : 'model/gltf-binary',
    upsert: true,
  });
  if (error) {
    throw new Error(`3D 모델 업로드 실패: ${error.message}`);
  }
  const { data } = db.storage.from('property-3d').getPublicUrl(path);
  return { type: '3d', src: data.publicUrl, label: '3D 모델' };
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

/*
 * 360 파노라마 업로드 — 검증·축소(4096×2048 JPEG) 후 Storage(하이브리드) 또는 IndexedDB(로컬)에 저장.
 * items: [{ id, label, file?, src?, yawOffset?, links? }] — 배열 순서가 투어 이동 순서(order).
 *   file 이 있으면 새로 처리·업로드, src 만 있으면(수정 폼의 기존 항목) 순서·라벨만 갱신.
 * onProgress({ done, total, label }) 로 진행률을 알린다. 한 장이 실패해도 나머지는 계속 처리한다.
 * 반환: { media: [360 media 항목...], failures: [{ label, message }] }
 */
export async function uploadPropertyPanoramas(items, propertyId, { onProgress } = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const media = [];
  const failures = [];
  const total = list.filter((item) => item.file).length;
  let done = 0;

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const order = media.length + 1;
    if (!item.file) {
      if (item.src) {
        media.push(panoramaMediaItem({ id: item.id, src: item.src, label: item.label, order, yawOffset: item.yawOffset ?? 0, links: item.links, stitched: item.stitched }));
      }
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const { blob } = await processPanoramaFile(item.file);
      const path = `properties/${propertyId}/pano-${order}-${Date.now()}.jpg`;
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await db.storage
        .from('property-360')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message || '업로드 실패');
      const { data: pub } = db.storage.from('property-360').getPublicUrl(data?.path ?? path);
      media.push(panoramaMediaItem({ id: item.id, src: pub.publicUrl, label: item.label, order, stitched: item.stitched }));
    } catch (error) {
      failures.push({ label: item.label || item.file.name || `지점 ${i + 1}`, message: error.message || '처리 실패' });
    } finally {
      done += 1;
      onProgress?.({ done, total, label: item.label || item.file?.name || '' });
    }
  }
  return { media, failures };
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
export async function resolveReferencePrice({ complexName, gu, areaM2, floor, price }) {
  const today = new Date().toISOString().slice(0, 10);
  const requested = Number.isFinite(Number(areaM2)) ? Math.floor(Number(areaM2)) : null;
  if (!gu || !complexName || requested == null) {
    return { price: null, source: null, basis: heldBasis('no_data', { requestedAreaM2: requested, areaM2: requested, computedAt: today }) };
  }

  // 1순위: 개별 실거래 (요청 면적 ±2㎡ 행만)
  const { data: tradeRows } = await db
    .from('complex_trades')
    .select('area_m2, trades, latest_year_month')
    .eq('complex', complexName)
    .eq('gu', gu);
  const rows = Array.isArray(tradeRows)
    ? tradeRows.filter((row) => Math.abs(Number(row.area_m2) - requested) <= 2)
    : [];
  if (rows.length > 0) {
    const trades = rows.flatMap(expandTradeRow);
    const asOf = rows.map((row) => row.latest_year_month).filter(Boolean).sort().pop() ?? undefined;
    const basis = computePriceBasis({ trades, areaM2: requested, floor, price, asOf, computedAt: today });
    return { price: basis.baselinePrice, source: basis.status === 'ok' ? 'complex' : null, basis };
  }

  // 2순위: 중앙값 테이블 — 동일 면적 → 근접 면적(±2㎡, 표본 최다)
  const columns = 'median_price, sample_size, area_m2, earliest_year_month, latest_year_month';
  const enough = (row) => row?.median_price && (Number(row.sample_size) || 0) >= BASIS_MIN_SAMPLE;
  const { data: exact } = await db
    .from('complex_prices')
    .select(columns)
    .eq('complex', complexName)
    .eq('gu', gu)
    .eq('area_m2', requested)
    .maybeSingle();
  if (enough(exact)) {
    const basis = basisFromComplexRow(exact, { requestedAreaM2: requested, approxArea: false, price, computedAt: today });
    return { price: basis.baselinePrice, source: 'complex', basis };
  }
  const { data: near } = await db
    .from('complex_prices')
    .select(columns)
    .eq('complex', complexName)
    .eq('gu', gu)
    .gte('area_m2', requested - 2)
    .lte('area_m2', requested + 2)
    .order('sample_size', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (enough(near)) {
    const basis = basisFromComplexRow(near, { requestedAreaM2: requested, approxArea: true, price, computedAt: today });
    return { price: basis.baselinePrice, source: 'complex', basis };
  }

  // 판정 보류 — 표본이 얇은 값(1~2건)을 기준가로 쓰지 않는다
  const thin = exact ?? near;
  const basis = thin
    ? heldBasis('low_sample', {
        requestedAreaM2: requested,
        areaM2: Number(thin.area_m2),
        approxArea: Number(thin.area_m2) !== requested,
        totalSample36: Number(thin.sample_size) || 0,
        dataAsOf: thin.latest_year_month ?? null,
        computedAt: today,
        method: `동일 단지 ${thin.area_m2}㎡ 실거래 ${Number(thin.sample_size) || 0}건 — 표본 부족(${BASIS_MIN_SAMPLE}건 미만)으로 판정 보류`,
      })
    : heldBasis('no_data', { requestedAreaM2: requested, areaM2: requested, computedAt: today });
  return { price: null, source: null, basis };
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

  // 1) 사진·3D·360 파노라마 업로드 + 주소로 좌표 자동 조회 (병렬)
  const photoFiles = Array.isArray(form.photos) ? form.photos.filter(Boolean) : [];
  const panoramaItems = Array.isArray(form.panoramas) ? form.panoramas.filter(Boolean) : [];
  const [photoMedia, model3d, lookupResult, panoramaResult] = await Promise.all([
    photoFiles.length > 0 ? uploadPropertyPhotos(photoFiles, id) : Promise.resolve([]),
    form.model3d ? uploadProperty3DModel(form.model3d, id) : Promise.resolve(null),
    form.address ? fetchLifestyleAndCoords({ address: form.address }) : Promise.resolve({ lifestyle: null, coordinates: null }),
    panoramaItems.length > 0
      ? uploadPropertyPanoramas(panoramaItems, id, { onProgress: onPanoramaProgress })
      : Promise.resolve({ media: [], failures: [] }),
  ]);
  const media = [...photoMedia, ...(model3d ? [model3d] : []), ...panoramaResult.media];

  const lifestyle = lookupResult.lifestyle ?? {
    subway: '', school: '', mart: '', hospital: '', convenience: '', gym: '',
  };
  const coordinates = lookupResult.coordinates ?? null;

  // gu 는 자동완성에서 고른 단지의 gu 우선, 없으면 Geocoding 결과
  const gu = form.complexGu || lookupResult.region?.gu || null;
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
  const priceBasis = { ...basisRest, computedAt: now };

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

  // 처리하지 못한 360 사진은 호출 측(등록 폼)이 배너로 알린다.
  return { id: data.id, panoramaFailures: panoramaResult.failures };
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
