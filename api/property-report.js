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
 *   SUPABASE_URL             — public URL (이미 VITE_SUPABASE_URL 있음)
 *   SUPABASE_SERVICE_ROLE_KEY — service_role 키 (Settings → API → service_role)
 *   GEMINI_MODEL             — (선택) 모델 override. 기본 gemini-2.5-flash, 예: gemini-2.5-pro
 *
 *   [모델 제공자 — 둘 중 하나]
 *   (A) Vertex AI (GCP 크레딧 사용, 우선):
 *       GCP_PROJECT_ID, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY, GCP_LOCATION(예: asia-northeast3)
 *       → 서비스계정(JSON 키) 값. 4개 다 있으면 Vertex 사용.
 *   (B) Fallback — AI Studio:
 *       AI_GATEWAY_API_KEY (또는 GOOGLE_GENERATIVE_AI_API_KEY)
 *       → 위 GCP_* 가 없으면 이걸로 동작.
 */

import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { z } from 'zod';

const REPORT_SCHEMA = z.object({
  summary: z.object({
    headline: z.string().describe('이 매물 한 줄 핵심 요약 (간결하게). 제공된 할인율·추세 등 "검증된 데이터"에만 근거. 예: "강남구 84㎡, 실거래가 대비 8% 급매 · 최근 1년 보합 · 학군은 직접 확인 필요"'),
    merits: z.array(z.string()).min(3).max(6).describe('매수 시 핵심 메리트. 각 항목을 충분히 구체적으로(여러 문장 가능) 서술. 반드시 제공된 데이터(할인율/추세/면적/연식/향/역세권 등)에 근거. 추측·과장 금지.'),
    cautions: z.array(z.string()).min(3).max(6).describe('매수 시 주의사항/약점. 각 항목 구체적으로. 데이터 공백(학군·권리관계 미확인 등)도 솔직히 약점으로 포함.'),
  }),
  basic: z.object({
    summaryText: z.string().describe('매물 개요. 길이 제한 없이 충분히 상세하게 — 제공된 사실(연식·면적·층·향·거주상태·세대수·주차)을 풍부하게 엮어 서술. 없는 정보는 언급하지 말 것.'),
    rightsAnalysis: z.string().describe('권리관계. 등기부 데이터가 없으므로 반드시 "본 리포트는 등기부등본 미확인 상태이며, 융자·근저당·임차권 등은 계약 전 반드시 직접 확인이 필요합니다" 취지로 명시. 매수자가 확인해야 할 권리 항목들을 구체적으로 안내해도 좋음.'),
  }),
  priceAnalysis: z.object({
    competitivenessText: z.string().describe('가격 경쟁력 분석. 길이 제한 없이 깊고 상세하게. 제공된 "기준 실거래가·할인율·같은 지역 비교 매물"을 구체적으로 인용·비교. 새로운 적정시세를 추정하지 말 것 — 제공된 기준 실거래가가 유일한 비교 기준.'),
    trendText: z.string().describe('최근 1년 실거래 추이 분석. 상세하게. 제공된 월별 추이 수치/변동률을 인용하고 흐름을 해석. 추이는 "지나온 관찰"로만 — 미래 가격을 예측하지 말 것.'),
    claimCheck: z.string().describe('중개사가 제공한 매물 설명/매도 사유(미검증 주장)를 검증된 데이터와 대조한 중립 코멘트. 상세하게. 과장(예: "초급매"라는데 할인율이 낮음)이 보이면 담담히 지적. 데이터로 확인 가능한 부분과 불가능한 부분을 구분.'),
    downsideRisk: z.enum(['낮음', '보통', '높음']).describe('추가 하락 위험도 (할인율·추세 근거)'),
    downsideText: z.string().describe('하방 위험 분석. 상세하게 — 왜 그 등급인지 데이터로 설명하고, 어떤 조건에서 위험이 커지는지도 서술.'),
  }),
  location: z.object({
    transport: z.string().describe('교통 — 제공된 "생활권(지하철 최근접)"과 "역세권 분류" 데이터를 사용해 상세히 서술(예: "○○역 도보 N분 = 역세권"). 데이터 없으면 "공개 데이터로 확인되지 않음 — 직접 확인 필요". 역명·거리를 지어내지 말 것.'),
    amenities: z.string().describe('생활편의 — 제공된 생활권(마트/병원/편의점/체육시설) 데이터를 구체적으로 엮어 상세히. 없으면 확인 불가로 명시.'),
    school: z.string().describe('학교 — 제공된 생활권의 "학교"(최근접) 데이터가 있으면 "인근 학교: ○○ (도보/차량 N분)" 사실로 서술. 단 "배정 학교·학군 등급/평가"는 데이터가 없으므로 단정하지 말고 "배정 학교와 학군 평가는 직접 확인이 필요합니다"로 명시. 학교명·배정·등급을 지어내지 말 것.'),
    marketTrend: z.string().describe('지역 시장 흐름 — 제공된 "같은 지역 비교 매물"과 "1년 추이" 범위 안에서 상세히 서술. 미확인 개발 호재·전망을 단정하지 말 것.'),
  }),
  // 사진이 제공된 경우에만 채움. 사진 없으면 생략(.optional()).
  photoAnalysis: z
    .object({
      overall: z.string().describe('사진으로 본 전반적인 컨디션 요약 1단락 — 보이는 것만, 상세하게.'),
      lighting: z.string().describe('채광/창 방향·자연광 들어오는 정도. 사진에 보이는 범위 내에서만.'),
      interior: z.string().describe('내부 구조·마감(바닥/벽/주방·욕실 마감재 등) — 사진에 보이는 그대로 기술.'),
      renovation: z.string().describe('리모델링·수리 흔적(새 마감재·교체된 가전·도배 상태 등). 단정하지 말고 "~로 보임" 형태로.'),
      concerns: z.string().describe('눈에 띄는 하자·관리 상태(균열·곰팡이·노후·정리 정돈 등). 보이지 않는 결함을 추정하지 말 것.'),
    })
    .optional()
    .describe('사진 기반 컨디션 분석. 사진이 제공된 경우에만 채우고, 없으면 비워둘 것. 사진에 실제로 보이는 시각적 요소만 기술하고, 보이지 않는 부분은 절대 추측하지 말 것.'),

  opinion: z.object({
    score: z.number().min(0).max(100).describe('종합 점수. 가격 합리성(할인율) 중심 + 사실 데이터. 데이터 공백이 많으면 보수적으로 낮게.'),
    grade: z.enum(['S', 'A', 'B', 'C', 'D']).describe('등급. S=90+, A=80+, B=70+, C=60+, D=60-'),
    buyRecommendation: z.number().min(0).max(5).describe('매수 권장도 (0~5점). 1자리 소수점.'),
    finalOpinion: z.string().describe('최종 종합 의견. 길이 제한 없이 깊고 길게 — 강점·약점·데이터 한계·매수 시 체크포인트를 균형있게 풍부하게. 어떤 매수자에게 적합한지. 과장·홍보 금지.'),
    targetBuyer: z.string().describe('가장 적합한 매수자 한 문장 (예: "강남 출퇴근 직장인 신혼부부").'),
  }),
});

const SYSTEM_PROMPT = `당신은 한국 부동산 급매 매물을 분석하는 신중한 분석가입니다.
독자는 이 매물 매수를 검토 중인 일반 매수자이며, 이 플랫폼의 핵심 가치는 "국토부 실거래가로 검증된 급매"입니다.
한국어로, 데이터에 근거한 객관적 리포트를 작성하세요.

[가장 중요한 규칙 — 어기면 안 됨]
1. 가격 숫자를 새로 만들지 마세요. 제공된 "검증된 가격 데이터"(매도 호가·기준 실거래가·할인율·1년 추이)만 인용하세요. 별도의 "적정시세"를 추정·계산하지 마세요. 기준 실거래가가 유일한 가격 기준입니다.
2. 미래 가격을 예측하지 마세요. 가격 추이는 "지나온 관찰"로만 서술하고, "오를 것/내릴 것" 같은 단정을 하지 마세요.
3. "생활권" 블록에 제공된 최근접 시설(지하철·학교·마트·병원 등)은 사실로 인용해도 됩니다(예: "인근 ○○초 도보 5분"). 단, 거기 없는 정보 — 배정 학교·학군 등급/평가·권리관계·개발 호재 등 — 는 절대 지어내지 말고 "공개 데이터로 확인되지 않음 — 직접 확인 필요"로 표기하세요.
4. "중개사 제공 정보"(매물 설명·매도 사유)는 검증되지 않은 주장입니다. 사실로 단정하지 말고, 검증된 데이터와 대조해 claimCheck 필드에 중립적으로 평가하세요. 과장이 보이면 담담히 지적하세요.
5. 영업·홍보 톤 금지. 약점과 불확실성을 숨기지 말고 솔직하게 쓰세요. 신뢰가 최우선입니다.
6. **사진이 첨부된 경우** photoAnalysis 섹션을 채우세요. 단, **사진에 실제로 보이는 시각적 요소만** 기술하고(공간 마감·채광·구조·하자 흔적 등), 사진에 안 보이는 것(배관·전기·소음 등)은 절대 추측하지 마세요. 단정 표현 대신 "~로 보임"처럼 신중하게. **사진이 첨부되지 않으면 photoAnalysis는 비워두세요.**

[강조점] "왜 이 매물이 급매인지(가격 메리트와 매도 시급도)"를 핵심으로 다루되, 근거는 항상 데이터에서 인용하세요.
[톤] 일반인이 이해하기 쉬운, 친근하지만 냉정한 전문가. 과장·미사여구 자제.
[분량] 각 항목은 분량 제한 없이 충분히 상세하고 풍부하게 작성하세요 — 정보가 많을수록 좋습니다. 단, 분량을 채우려고 추측·반복·과장을 하지 말고, 제공된 데이터 범위 안에서만 깊게 쓰세요.

출력 형식은 주어진 JSON schema 를 정확히 따르세요.`;

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// 모델 선택: GCP 서비스계정 env 가 있으면 Vertex AI(크레딧 사용), 없으면 AI Studio 키로 fallback.
// → 서비스계정 env 넣기 전까지는 기존 방식대로 동작해서 배포해도 안 깨짐.
function getModel() {
  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const { GCP_PROJECT_ID, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY, GCP_LOCATION } = process.env;

  if (GCP_PROJECT_ID && GCP_CLIENT_EMAIL && GCP_PRIVATE_KEY) {
    const vertex = createVertex({
      project: GCP_PROJECT_ID,
      location: GCP_LOCATION || 'us-central1',
      googleAuthOptions: {
        credentials: {
          client_email: GCP_CLIENT_EMAIL,
          // Vercel 환경변수에 \n 이 이스케이프돼 들어올 수 있어 실제 줄바꿈으로 복원
          private_key: GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
      },
    });
    return { model: vertex(modelName), label: `vertex/${modelName}` };
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Vertex(GCP_PROJECT_ID 등) 또는 AI_GATEWAY_API_KEY 환경변수가 필요합니다.');
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return { model: google(modelName), label: `google/${modelName}` };
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

// 지하철 최근접 시설 라벨("○○역 도보 5분")로 역세권 등급 분류
function classifyStationArea(subwayLabel) {
  if (!subwayLabel) return '확인되지 않음 (도보권 내 지하철역 데이터 없음)';
  const minutesMatch = String(subwayLabel).match(/(\d+)\s*분/);
  const minutes = minutesMatch ? Number(minutesMatch[1]) : null;
  const isWalk = /도보/.test(subwayLabel);
  if (isWalk && minutes != null) {
    if (minutes <= 5) return `초역세권 — ${subwayLabel} (도보 5분 이내)`;
    if (minutes <= 10) return `역세권 — ${subwayLabel} (도보 10분 이내)`;
    return `역 도보 다소 거리 — ${subwayLabel}`;
  }
  if (!isWalk) return `비역세권 — 도보권 내 역 없음 (${subwayLabel})`;
  return subwayLabel;
}

function buildUserPrompt({ property, nearby }) {
  const ph = Array.isArray(property.price_history) ? property.price_history : [];
  let trendLine = '데이터 없음';
  if (ph.length >= 2) {
    const first = ph[0];
    const last = ph[ph.length - 1];
    const pct = first.price > 0 ? (((last.price - first.price) / first.price) * 100).toFixed(1) : '0';
    const estCount = ph.filter((p) => p.estimated).length;
    trendLine = `${first.month} ${first.price.toLocaleString()}원 → ${last.month} ${last.price.toLocaleString()}원 (1년 변동 ${pct}%)`
      + (estCount > 0 ? ` ※ ${ph.length}개월 중 ${estCount}개월은 거래가 없어 주변 시세로 추정된 값` : '');
  }

  const lifestyleLines = Object.entries(property.lifestyle || {})
    .filter(([k, v]) => v && k !== 'stationArea') // stationArea 는 역세권 줄에서 별도 표기
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- (확인된 주변 시설 정보 없음)';

  return `아래 데이터로 5개 파트 리포트를 작성하세요. **각 블록의 신뢰도 등급을 반드시 지키세요.**

## ✅ 검증된 가격 데이터 (국토부 실거래가 기반 — 가격은 이 숫자만 사용, 새로 만들지 말 것)
- 매도 호가: ${property.price.toLocaleString()}원
- 기준 실거래가: ${property.actual_transaction_price.toLocaleString()}원
- 할인율: ${property.discount_rate}% (양수면 실거래가보다 저렴)
- 최근 1년 실거래 추이: ${trendLine}

## ✅ 검증된 매물 사실
- 단지/타입: ${property.title}
- 주소/지역: ${property.address} (${property.region})
- 전용면적: ${property.area}㎡ (공급 ${property.supply_area}㎡)
- 층 / 방 / 욕실: ${property.floor} / ${property.rooms}개 / ${property.bathrooms}개
- 건축연도: ${property.built_year ?? '미상'}년 · 세대수: ${property.unit_count ?? '미공개'}
- 향: ${property.direction ?? '미상'} · 현재 거주 상태: ${property.occupancy_status ?? '미상'}
- 주차: ${property.parking ?? '미공개'}

## ⚠️ 중개사 제공 정보 (미검증 주장 — 사실로 단정 말고 claimCheck에서 데이터와 대조)
${property.description || '(중개사 설명 없음)'}

## 📍 생활권 (Places + 실제 도보/차량 거리 기반 — 학군 정보는 포함되지 않음)
- 역세권 분류: ${property.lifestyle?.stationArea || classifyStationArea(property.lifestyle?.subway)}
${lifestyleLines}

## 📊 같은 지역(${property.region}) 다른 급매 매물 (가격 비교용 참고)
${nearby.length
  ? nearby.map((n) => `- ${n.title} (${n.area}㎡, ${n.built_year ?? '?'}년): 매도가 ${n.price.toLocaleString()}원 / 기준가 ${n.actual_transaction_price?.toLocaleString() ?? '?'}원 / 할인 ${n.discount_rate}%`).join('\n')
  : '- (비교 매물 없음)'}

## 📷 매물 사진 (별도 첨부됨)
${Array.isArray(property.media) && property.media.length > 0
  ? `이 매물엔 ${property.media.length}장의 사진이 첨부됐고, 별도 이미지로 함께 제공됩니다. photoAnalysis 섹션은 사진에 보이는 것만으로 채우세요.`
  : '사진이 첨부되지 않았습니다. photoAnalysis 섹션은 비워두세요.'}

규칙: 가격은 위 "검증된 가격 데이터"만 인용. 학군·역거리·권리·호재 등 위에 없는 정보는 "확인되지 않음"으로. 중개사 주장은 claimCheck에서 검증. 미래 가격 예측 금지. 사진은 보이는 것만 photoAnalysis에 기술.`;
}

// 모델은 환경변수 GEMINI_MODEL 로 오버라이드 가능. 기본값: 최신 stable 모델.
// 1.5-flash 는 2026년 deprecated. 2.5-flash 가 현행 플래그십.
// 만약 무료 한도(quota) 부족이면 GEMINI_MODEL=gemini-2.5-flash-lite 로 설정 가능 (더 가벼움 + 무료 한도 큼).
const DEFAULT_MODEL = 'gemini-2.5-flash';

// 'generating' 락이 이 시간보다 오래되면 죽은 요청으로 보고 다른 요청이 탈취 가능
const STALE_LOCK_MS = 3 * 60 * 1000;

async function generateReport({ property, nearby }) {
  const { model, label } = getModel();
  const userText = buildUserPrompt({ property, nearby });

  // 사진(media)이 있으면 멀티모달 메시지로 전달 — Gemini가 직접 사진을 보고 photoAnalysis 채움.
  // 토큰/비용 관리 위해 최대 6장으로 제한.
  const photos = Array.isArray(property.media) ? property.media : [];
  const imageParts = photos
    .filter((p) => p && typeof p.src === 'string')
    .slice(0, 6)
    .map((p) => ({ type: 'image', image: p.src }));

  const userContent = imageParts.length > 0
    ? [{ type: 'text', text: userText }, ...imageParts]
    : [{ type: 'text', text: userText }];

  const result = await generateObject({
    model,
    schema: REPORT_SCHEMA,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });
  return {
    report: result.object,
    usage: result.usage,
    model: label, // 'vertex/gemini-2.5-pro' 또는 'google/gemini-2.5-flash'
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

    // ----- 락 단계: 한 요청만 AI 를 호출하도록 'generating' 로우를 선점 -----
    let claimedLock = false;
    if (!force) {
      const { data: existing } = await supabase
        .from('property_reports')
        .select('property_id, status, generated_at')
        .eq('property_id', id)
        .maybeSingle();

      if (existing) {
        if (existing.status !== 'generating') {
          // 이미 완성된 리포트 → 그대로 반환
          const { data: full } = await supabase
            .from('property_reports')
            .select('*')
            .eq('property_id', id)
            .maybeSingle();
          return res.status(200).json({ ...full, cached: true });
        }
        // 다른 요청이 생성 중
        const age = Date.now() - new Date(existing.generated_at).getTime();
        if (age < STALE_LOCK_MS) {
          return res.status(202).json({ status: 'generating' });
        }
        // 락이 오래됨(죽은 요청) → 원자적 탈취 (조건부 update)
        const { data: taken } = await supabase
          .from('property_reports')
          .update({ status: 'generating', generated_at: new Date().toISOString() })
          .eq('property_id', id)
          .eq('status', 'generating')
          .lt('generated_at', new Date(Date.now() - STALE_LOCK_MS).toISOString())
          .select('property_id');
        if (!taken || taken.length === 0) {
          return res.status(202).json({ status: 'generating' });
        }
        claimedLock = true;
      } else {
        // 로우 없음 → insert 로 선점 (PK 유니크라 동시 요청 중 하나만 성공)
        const { error: claimError } = await supabase
          .from('property_reports')
          .insert({ property_id: id, report_data: {}, status: 'generating' });
        if (claimError) {
          // 충돌 = 다른 요청이 먼저 선점함 → 중복 호출 방지
          return res.status(202).json({ status: 'generating' });
        }
        claimedLock = true;
      }
    }

    try {
      const context = await fetchPropertyContext(supabase, id);
      const { report, usage, model } = await generateReport(context);

      const { data: saved, error: saveError } = await supabase
        .from('property_reports')
        .upsert({
          property_id: id,
          report_data: report,
          status: 'ready',
          model, // generateReport 가 이미 'vertex/...' 또는 'google/...' 라벨 반환
          generated_at: new Date().toISOString(),
          prompt_token_count: usage?.promptTokens ?? null,
          completion_token_count: usage?.completionTokens ?? null,
        })
        .select('*')
        .single();
      if (saveError) throw saveError;

      return res.status(200).json({ ...saved, cached: false });
    } catch (genError) {
      // 생성 실패 시 우리가 잡은 락 정리 → 다음 조회가 즉시 재시도 가능 (TTL 안 기다림)
      if (claimedLock) {
        await supabase
          .from('property_reports')
          .delete()
          .eq('property_id', id)
          .eq('status', 'generating')
          .then(() => {}, () => {});
      }
      throw genError;
    }
  } catch (err) {
    console.error('[property-report] failed:', err);
    return res.status(500).json({ error: err.message || 'unknown error' });
  }
}
