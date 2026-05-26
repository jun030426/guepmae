/*
 * propertyRegistration.js — 중개사 매물 등록 + AI 리포트 자동 생성.
 *
 * Flow:
 *   1) properties 테이블에 INSERT (agent role 의 RLS 통과)
 *   2) /api/property-report?id=newId 호출 → 서버에서 AI 리포트 생성 + property_reports 저장
 *   3) 새 매물 id 반환
 *
 * AI 리포트 생성 실패는 fatal 아님 — 매물은 등록되지만 리포트 없는 상태.
 * (사용자가 매물 상세에서 다시 클릭하면 그때 생성됨)
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

function generatePropertyId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `gm-${ts}${rand}`;
}

export async function registerProperty(form, agentProfile) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  }

  const id = generatePropertyId();
  const now = new Date().toISOString().slice(0, 10);

  // 폼 → DB row (snake_case)
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
    urgent_score: 0, // AI 리포트가 score 계산
    area: Number(form.area),
    supply_area: Number(form.supplyArea) || Math.round(Number(form.area) * 1.33),
    floor: form.floor,
    built_year: Number(form.builtYear) || null,
    image_label: '',
    verified: false, // 운영팀 검토 전엔 false (RLS 정책에서 verified=true 만 노출하면 자동 숨김)
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
      verified: true,
    },
    lifestyle: {
      // 매도 사유는 description 에 녹이고, lifestyle 은 비워둠 — AI 가 좌표로 추정
      subway: '',
      school: '',
      mart: '',
      hospital: '',
      park: '',
      commute: '',
    },
    price_history: [],
  };

  const { data, error } = await supabase
    .from('properties')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;

  // AI 리포트 백그라운드 생성 시도 (실패해도 등록 자체는 성공)
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
