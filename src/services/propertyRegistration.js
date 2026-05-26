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

async function uploadPropertyPhotos(files, propertyId) {
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

async function fetchLifestyleByCoords(lat, lng) {
  try {
    const res = await fetch(`/api/lookup-lifestyle?lat=${lat}&lng=${lng}`);
    if (!res.ok) return { lifestyle: null, nearest: null };
    const data = await res.json();
    return { lifestyle: data.lifestyle, nearest: data.nearest };
  } catch (err) {
    console.warn('lifestyle lookup failed:', err);
    return { lifestyle: null, nearest: null };
  }
}

export async function registerProperty(form, agentProfile) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  }

  const id = generatePropertyId();
  const now = new Date().toISOString().slice(0, 10);

  // 1) 사진 업로드 + 좌표 있으면 Kakao 로 lifestyle 조회 (병렬)
  const photoFiles = Array.isArray(form.photos) ? form.photos.filter(Boolean) : [];
  const hasCoords = form.lat && form.lng;
  const [media, lifestyleResult] = await Promise.all([
    photoFiles.length > 0 ? uploadPropertyPhotos(photoFiles, id) : Promise.resolve([]),
    hasCoords ? fetchLifestyleByCoords(form.lat, form.lng) : Promise.resolve({ lifestyle: null }),
  ]);

  const lifestyle = lifestyleResult.lifestyle ?? {
    subway: '', school: '', mart: '', hospital: '', convenience: '', gym: '',
  };

  // 2) 매물 INSERT
  const row = {
    id,
    title: form.title,
    address: form.address,
    coordinates: form.lat && form.lng ? { lat: Number(form.lat), lng: Number(form.lng) } : null,
    region: form.region,
    property_type: '아파트',
    price: Number(form.price),
    actual_transaction_price: Number(form.actualTransactionPrice) || Number(form.price),
    discount_rate: calculateDiscount(form),
    urgent_score: 0,
    area: Number(form.area),
    supply_area: Number(form.supplyArea) || Math.round(Number(form.area) * 1.33),
    floor: form.floor,
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
      office: form.agencyName || '',
      phone: agentProfile?.phone || form.agentPhone || '',
      email: agentProfile?.email || '',
      verified: true,
    },
    lifestyle,
    price_history: [],
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

function calculateDiscount(form) {
  const price = Number(form.price);
  const market = Number(form.actualTransactionPrice);
  if (!price || !market || market <= 0) return 0;
  const pct = ((market - price) / market) * 100;
  return Number(pct.toFixed(1));
}

async function triggerReportGeneration(propertyId) {
  const res = await fetch(`/api/property-report?id=${encodeURIComponent(propertyId)}`);
  if (!res.ok) throw new Error(`AI report failed: ${res.status}`);
  return res.json();
}

// 운영팀 승인 토글 — properties.verified true/false 변경
export async function setPropertyVerified(propertyId, verified) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  }
  const { error } = await supabase
    .from('properties')
    .update({ verified, last_verified_at: new Date().toISOString().slice(0, 10) })
    .eq('id', propertyId);
  if (error) throw error;
}
