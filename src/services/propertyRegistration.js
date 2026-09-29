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
        media.push(panoramaMediaItem({ id: item.id, src: item.src, label: item.label, order, yawOffset: item.yawOffset ?? 0, links: item.links }));
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
      media.push(panoramaMediaItem({ id: item.id, src: pub.publicUrl, label: item.label, order }));
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
