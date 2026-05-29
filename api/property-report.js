/*
 * /api/property-report — 매물 ID 받아서 AI 리포트를 생성/캐싱/반환.
 *
 * GET ?id=gm-001
 *   → property_reports 테이블에 캐시 있으면 즉시 반환
 *   → 없으면 Gemini (via Vercel AI Gateway) 호출 → 저장 → 반환
 *
 * POST { id: 'gm-001', force: true }
 *   → 캐시 무시하고 항상 새로 생성 (관리자용 batch 생성에 사용)
 *
 * POST { id: 'gm-001', invalidate: true }
 *   → 캐시된 리포트 삭제만 (재생성 X). 매물 수정 시 호출 → 다음 조회 때 새 데이터로 재생성.
 *
 * 환경변수:
 *   AI_GATEWAY_API_KEY       — Vercel AI Gateway 키 (Vercel Dashboard에서 생성)
 *   SUPABASE_URL             — public URL (이미 VITE_SUPABASE_URL 있음)
 *   SUPABASE_SERVICE_ROLE_KEY — service_role 키 (Settings → API → service_role)
 */

import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const REPORT_SCHEMA = z.object({
  summary: z.object({
    headline: z.string().describe('이 매물 한 줄 요약 (50자 이내). 예: "강남 출퇴근 30분, 시세 대비 8% 저렴, 학군은 약점"'),
    merits: z.array(z.string()).length(3).describe('매수 시 핵심 메리트 3가지. 각 한 문장.'),
    cautions: z.array(z.string()).length(3).describe('매수 시 주의사항 3가지. 각 한 문장.'),
  }),
  basic: z.object({
    summaryText: z.string().describe('매물 개요 한 단락 (단지 연식, 세대수, 본 매물 위치 등)'),
    rightsAnalysis: z.string().describe('권리관계 요약. 실제 등기부등본 데이터가 없으므로 "본 리포트는 등기부등본 미확인 상태이며, 계약 전 반드시 확인 필요" 라고 명시'),
  }),
  priceAnalysis: z.object({
    vaiPrice: z.number().describe('AI 적정시세 (원 단위 정수). 인근 거래 + 단지 평균 + 지역 트렌드 종합'),
    discountAmount: z.number().describe('할인 금액 (원). vaiPrice - 매도가'),
    discountPct: z.number().describe('할인율 (%). 양수면 시세보다 저렴'),
    competitivenessText: z.string().describe('단지 내 가격 경쟁력 분석 한 단락 (예: 같은 평형 매물 중 하위 X% 위치)'),
    trendText: z.string().describe('최근 가격 추이 분석 한 단락. 인근 단지/지역 변동 포함'),
    downsideRisk: z.enum(['낮음', '보통', '높음']).describe('추가 하락 위험도'),
    downsideText: z.string().describe('하방경직성 분석 (왜 그 위험도인가)'),
  }),
  location: z.object({
    marketTrend: z.string().describe('해당 시/군/구 시장 흐름 (최근 추세, 지역 호재 등)'),
    transport: z.string().describe('교통 접근성 (가까운 지하철역, 주요 업무지구까지 시간 등)'),
    school: z.string().describe('학군 (배정 초/중/고, 학군 평가)'),
    amenities: z.string().describe('생활편의 및 호재 (마트, 병원, 공원, 개발 호재)'),
  }),
  opinion: z.object({
    score: z.number().min(0).max(100).describe('AI 종합 점수 (0~100). 가격 합리성+입지+컨디션 종합'),
    grade: z.enum(['S', 'A', 'B', 'C', 'D']).describe('등급. S=90+, A=80+, B=70+, C=60+, D=60-'),
    buyRecommendation: z.number().min(0).max(5).describe('매수 권장도 (0~5점). 1자리 소수점'),
    finalOpinion: z.string().describe('최종 종합 의견 2~3 단락. 매물의 강점, 약점, 어떤 사용자에게 적합한지 명시'),
    targetBuyer: z.string().describe('이 매물이 가장 적합한 매수자 페르소나 한 문장 (예: "강남 출퇴근 직장인 신혼부부")'),
  }),
});

const SYSTEM_PROMPT = `당신은 한국 부동산 시장의 급매 매물을 분석하는 전문 분석가입니다.
사용자는 매물 정보와 인근 실거래 데이터를 줍니다. 이 데이터만 기반으로 객관적이고 보수적인 리포트를 한국어로 작성하세요.

원칙:
- 데이터에 없는 사실을 만들어내지 말 것 (특히 단지 제원, 권리관계, 학교명, 지하철역 거리 등)
- 모르는 정보는 "공개 데이터 기준으로는 확인되지 않음" 으로 표기
- 매도 사유는 매물 데이터에서 추론할 수 있는 만큼만 작성
- 가격 분석은 제공된 인근 거래 데이터를 인용하며 작성
- 톤: 일반인이 이해 가능한 친근한 전문가 톤. 너무 딱딱하지 않게.

출력 형식은 주어진 JSON schema 를 정확히 따르세요.`;

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function getGoogleProvider() {
  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY 또는 GOOGLE_GENERATIVE_AI_API_KEY 환경변수가 필요합니다.');
  }
  // Vercel AI Gateway 우선. 게이트웨이가 OpenAI HTTP 호환이면 baseURL 변경 가능하지만,
  // 가장 안정적인 건 Google 공식 API 직접 호출 (Gemini Flash 무료 한도).
  return createGoogleGenerativeAI({ apiKey });
}

async function fetchPropertyContext(supabase, propertyId) {
  const { data: property, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw error;
  if (!property) throw new Error(`Property not found: ${propertyId}`);

  // 같은 지역 (시군구 첫 토큰 기준) 다른 매물 5건
  const region = (property.region || '').split(' ')[0];
  const { data: nearby } = await supabase
    .from('properties')
    .select('id, title, price, actual_transaction_price, discount_rate, area, region, built_year')
    .neq('id', propertyId)
    .ilike('region', `${region}%`)
    .order('discount_rate', { ascending: false })
    .limit(10);

  return { property, nearby: nearby ?? [] };
}

function buildUserPrompt({ property, nearby }) {
  return `# 분석 대상 매물

- ID: ${property.id}
- 단지명/타입: ${property.title}
- 주소: ${property.address}
- 지역: ${property.region}
- 전용면적: ${property.area}㎡ (공급 ${property.supply_area}㎡)
- 층/방/욕실: ${property.floor} / 방 ${property.rooms}개 / 욕실 ${property.bathrooms}개
- 건축연도: ${property.built_year}년
- 세대수: ${property.unit_count ?? '미공개'}세대
- 매도호가: ${property.price.toLocaleString()}원
- 기준 실거래가: ${property.actual_transaction_price.toLocaleString()}원
- 할인율: ${property.discount_rate}%
- 최근 확인일: ${property.last_verified_at}
- 검증 상태: ${property.verified ? '검증 완료' : '검증 진행 중'}
- 매물 설명: ${property.description}
- 주차: ${property.parking}
- 관리비: 월 ${property.maintenance_fee?.toLocaleString() ?? '미공개'}원
- 입주 가능: ${property.move_in_date}

# 생활권 정보 (참고 — 검증되지 않은 추정치일 수 있음)
${Object.entries(property.lifestyle || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

# 최근 가격 추이 (단지 자체 또는 유사 매물)
${(property.price_history ?? []).map((p) => `- ${p.month}: ${p.price.toLocaleString()}원`).join('\n')}

# 같은 지역(${property.region}) 다른 급매 매물 (참고)
${nearby.map((n) => `- ${n.title} (${n.region}, ${n.area}㎡, ${n.built_year}년) : 매도가 ${n.price.toLocaleString()}원 / 시세 ${n.actual_transaction_price.toLocaleString()}원 / -${n.discount_rate}%`).join('\n')}

위 데이터만 활용해서 5개 파트 리포트를 JSON 형식으로 작성해 주세요.`;
}

// 모델은 환경변수 GEMINI_MODEL 로 오버라이드 가능. 기본값: 최신 stable 모델.
// 1.5-flash 는 2026년 deprecated. 2.5-flash 가 현행 플래그십.
// 만약 무료 한도(quota) 부족이면 GEMINI_MODEL=gemini-2.5-flash-lite 로 설정 가능 (더 가벼움 + 무료 한도 큼).
const DEFAULT_MODEL = 'gemini-2.5-flash';

async function generateReport({ property, nearby }) {
  const google = getGoogleProvider();
  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const result = await generateObject({
    model: google(modelName),
    schema: REPORT_SCHEMA,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({ property, nearby }),
  });
  return {
    report: result.object,
    usage: result.usage,
    model: modelName,
  };
}

export default async function handler(req, res) {
  const id = (req.method === 'GET' ? req.query.id : req.body?.id);
  const force = req.method === 'POST' && req.body?.force === true;
  const invalidate = req.method === 'POST' && req.body?.invalidate === true;
  if (!id) {
    return res.status(400).json({ error: 'id 파라미터가 필요합니다.' });
  }

  try {
    const supabase = getServiceClient();

    // 캐시 무효화 — 매물 수정 시 호출. 삭제만 하고 재생성은 다음 조회(경로 B)에 맡김.
    if (invalidate) {
      const { error: delError } = await supabase
        .from('property_reports')
        .delete()
        .eq('property_id', id);
      if (delError) throw delError;
      return res.status(200).json({ invalidated: true });
    }

    if (!force) {
      const { data: cached } = await supabase
        .from('property_reports')
        .select('*')
        .eq('property_id', id)
        .maybeSingle();
      if (cached) {
        return res.status(200).json({ ...cached, cached: true });
      }
    }

    const context = await fetchPropertyContext(supabase, id);
    const { report, usage, model } = await generateReport(context);

    const { data: saved, error: saveError } = await supabase
      .from('property_reports')
      .upsert({
        property_id: id,
        report_data: report,
        model: `google/${model}`,
        generated_at: new Date().toISOString(),
        prompt_token_count: usage?.promptTokens ?? null,
        completion_token_count: usage?.completionTokens ?? null,
      })
      .select('*')
      .single();
    if (saveError) throw saveError;

    return res.status(200).json({ ...saved, cached: false });
  } catch (err) {
    console.error('[property-report] failed:', err);
    return res.status(500).json({ error: err.message || 'unknown error' });
  }
}
