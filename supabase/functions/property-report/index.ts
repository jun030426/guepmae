/*
 * property-report — 매물 AI 리포트(5파트) 실시간 생성.
 *
 * POST { propertyId, force? }
 *  - 리포트가 없으면 누구나 생성할 수 있다 (매물당 1건, 생성 완료 후에는 캐시만 반환).
 *  - force(다시 생성)는 중개사(자기 매물)·운영진만.
 *  - 검증 전(verified=false) 매물은 중개사(자기 매물)·운영진만 생성할 수 있다.
 *  - 기준 실거래가가 없는 매물(판정 보류)은 가격 분석이 불가능하므로 생성하지 않는다.
 *
 * 흐름: 권한 확인 → 캐시/락 확인 → 같은 지역 비교 매물 수집 → Gemini(텍스트) → property_reports upsert
 * 프롬프트·스키마는 scripts/generate-reports.mjs(로컬 번들 생성기)와 같다 — 둘을 같이 고친다.
 * 시크릿: GEMINI_API_KEY (대시보드 → Edge Functions → Secrets)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const LOCK_TTL_MS = 3 * 60 * 1000; // 'generating' 락이 이보다 오래되면 죽은 것으로 본다

const SYSTEM_PROMPT = `당신은 한국 부동산 급매 매물을 분석하는 신중한 분석가입니다.
독자는 이 매물 매수를 검토 중인 일반 매수자이며, 이 플랫폼의 핵심 가치는 "국토부 실거래가로 검증된 급매"입니다.
한국어로, 데이터에 근거한 객관적 리포트를 작성하세요.

[가장 중요한 규칙 — 어기면 안 됨]
1. 가격 숫자를 새로 만들지 마세요. 제공된 "검증된 가격 데이터"(매도 호가·기준 실거래가·할인율·1년 추이)만 인용하세요. 별도의 "적정시세"를 추정·계산하지 마세요. 기준 실거래가가 유일한 가격 기준입니다.
2. 미래 가격을 예측하지 마세요. 가격 추이는 "지나온 관찰"로만 서술하고, "오를 것/내릴 것" 같은 단정을 하지 마세요.
3. "생활권" 블록에 제공된 최근접 시설(지하철·학교·마트·병원 등)은 사실로 인용해도 됩니다. 단, 거기 없는 정보 — 배정 학교·학군 등급/평가·권리관계·개발 호재 등 — 는 절대 지어내지 말고 "공개 데이터로 확인되지 않음 — 직접 확인 필요"로 표기하세요.
4. "중개사 제공 정보"(매물 설명·매도 사유)는 검증되지 않은 주장입니다. 사실로 단정하지 말고, 검증된 데이터와 대조해 claimCheck 필드에 중립적으로 평가하세요.
5. 영업·홍보 톤 금지. 약점과 불확실성을 숨기지 말고 솔직하게 쓰세요. 신뢰가 최우선입니다.

[강조점] "왜 이 매물이 급매인지(가격 메리트와 매도 시급도)"를 핵심으로 다루되, 근거는 항상 데이터에서 인용하세요.
[톤] 일반인이 이해하기 쉬운, 친근하지만 냉정한 전문가. 과장·미사여구 자제.
[분량] 각 항목은 충분히 상세하게. 단, 분량을 채우려고 추측·반복·과장을 하지 말고, 제공된 데이터 범위 안에서만 깊게 쓰세요.

출력은 주어진 JSON schema 를 정확히 따르세요.`;

const S = (description: string) => ({ type: 'STRING', description });
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'OBJECT',
      properties: {
        headline: S('이 매물 한 줄 핵심 요약. 검증된 데이터에만 근거.'),
        merits: { type: 'ARRAY', items: S('매수 시 핵심 메리트 1개. 데이터 근거, 구체적으로.'), description: '2~6개' },
        cautions: { type: 'ARRAY', items: S('주의사항/약점 1개. 데이터 공백도 솔직히.'), description: '2~6개' },
      },
      required: ['headline', 'merits', 'cautions'],
    },
    basic: {
      type: 'OBJECT',
      properties: {
        summaryText: S('매물 개요. 제공된 사실(연식·면적·층·향·거주상태·세대수·주차)을 풍부하게 엮어 상세히.'),
        rightsAnalysis: S('권리관계. 등기부 미확인 상태이며 융자·근저당·임차권 등은 계약 전 직접 확인 필요함을 명시.'),
      },
      required: ['summaryText', 'rightsAnalysis'],
    },
    priceAnalysis: {
      type: 'OBJECT',
      properties: {
        competitivenessText: S('가격 경쟁력. 제공된 기준 실거래가·할인율·비교 매물을 인용. 새 적정시세 추정 금지.'),
        trendText: S('최근 1년 실거래 추이 분석. 제공된 수치를 인용·해석. 미래 예측 금지.'),
        claimCheck: S('중개사 주장을 검증 데이터와 대조한 중립 코멘트.'),
        downsideRisk: { type: 'STRING', enum: ['낮음', '보통', '높음'], description: '추가 하락 위험도' },
        downsideText: S('하방 위험 분석. 왜 그 등급인지 데이터로 설명.'),
      },
      required: ['competitivenessText', 'trendText', 'claimCheck', 'downsideRisk', 'downsideText'],
    },
    location: {
      type: 'OBJECT',
      properties: {
        transport: S('교통 — 제공된 생활권/역세권 데이터로. 없으면 확인 불가로 명시. 역명·거리 지어내지 말 것.'),
        amenities: S('생활편의 — 제공된 생활권(마트/병원/편의점/체육) 데이터로. 없으면 확인 불가.'),
        school: S('학교 — 제공된 최근접 학교만 사실로. 배정·학군 등급은 직접 확인 필요로 명시. 지어내지 말 것.'),
        marketTrend: S('지역 시장 흐름 — 제공된 비교 매물·1년 추이 범위 안에서. 미확인 호재 단정 금지.'),
      },
      required: ['transport', 'amenities', 'school', 'marketTrend'],
    },
    opinion: {
      type: 'OBJECT',
      properties: {
        score: { type: 'NUMBER', description: '종합 점수 0~100. 가격 합리성 중심, 데이터 공백 많으면 보수적으로.' },
        grade: { type: 'STRING', enum: ['S', 'A', 'B', 'C', 'D'], description: 'S=90+,A=80+,B=70+,C=60+,D=60-' },
        buyRecommendation: { type: 'NUMBER', description: '매수 권장도 0~5 (소수점 1자리)' },
        finalOpinion: S('최종 종합 의견. 강점·약점·데이터 한계·체크포인트를 균형있게 풍부하게.'),
        targetBuyer: S('가장 적합한 매수자 한 문장.'),
      },
      required: ['score', 'grade', 'buyRecommendation', 'finalOpinion', 'targetBuyer'],
    },
  },
  required: ['summary', 'basic', 'priceAnalysis', 'location', 'opinion'],
};

type PricePoint = { month?: string; price?: number; estimated?: boolean };
type PropertyRow = {
  id: string;
  title: string;
  address: string | null;
  region: string | null;
  price: number;
  actual_transaction_price: number | null;
  discount_rate: number | string | null;
  price_basis: { status?: string; method?: string } | null;
  area: number | null;
  supply_area: number | null;
  floor: string | null;
  rooms: number | null;
  bathrooms: number | null;
  built_year: number | null;
  unit_count: number | null;
  direction: string | null;
  occupancy_status: string | null;
  parking: string | null;
  description: string | null;
  lifestyle: Record<string, string> | null;
  price_history: PricePoint[] | null;
  verified: boolean;
  agent: { email?: string } | null;
};
type NearbyRow = {
  title: string;
  area: number | null;
  built_year: number | null;
  price: number;
  actual_transaction_price: number | null;
  discount_rate: number | string | null;
};

const won = (value: number | null | undefined) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR') : '?');
const show = (value: unknown, fallback: string) => (value == null || value === '' ? fallback : String(value));

function classifyStationArea(subwayLabel: string | undefined) {
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

function buildUserPrompt(property: PropertyRow, nearby: NearbyRow[]) {
  const ph = Array.isArray(property.price_history) ? property.price_history : [];
  let trendLine = '데이터 없음';
  if (ph.length >= 2) {
    const first = ph[0];
    const last = ph[ph.length - 1];
    const firstPrice = Number(first.price) || 0;
    const lastPrice = Number(last.price) || 0;
    const pct = firstPrice > 0 ? (((lastPrice - firstPrice) / firstPrice) * 100).toFixed(1) : '0';
    const estCount = ph.filter((p) => p.estimated).length;
    trendLine = `${first.month} ${won(firstPrice)}원 → ${last.month} ${won(lastPrice)}원 (1년 변동 ${pct}%)`
      + (estCount > 0 ? ` ※ ${ph.length}개월 중 ${estCount}개월은 거래가 없어 주변 시세로 추정된 값` : '');
  }

  const lifestyle = property.lifestyle ?? {};
  const lifestyleLines = Object.entries(lifestyle)
    .filter(([k, v]) => v && k !== 'stationArea')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- (확인된 주변 시설 정보 없음)';

  const basisMethod = property.price_basis?.method ? `\n- 기준 실거래가 산출 방식: ${property.price_basis.method}` : '';

  return `아래 데이터로 5개 파트 리포트를 작성하세요.

## ✅ 검증된 가격 데이터 (국토부 실거래가 기반 — 가격은 이 숫자만 사용, 새로 만들지 말 것)
- 매도 호가: ${won(property.price)}원
- 기준 실거래가: ${won(property.actual_transaction_price)}원
- 할인율: ${Number(property.discount_rate)}% (양수면 실거래가보다 저렴)${basisMethod}
- 최근 1년 실거래 추이: ${trendLine}

## ✅ 검증된 매물 사실
- 단지/타입: ${property.title}
- 주소/지역: ${show(property.address, '미상')} (${show(property.region, '미상')})
- 전용면적: ${show(property.area, '?')}㎡ (공급 ${show(property.supply_area, '?')}㎡)
- 층 / 방 / 욕실: ${show(property.floor, '미상')} / ${show(property.rooms, '?')}개 / ${show(property.bathrooms, '?')}개
- 건축연도: ${show(property.built_year, '미상')}년 · 세대수: ${show(property.unit_count, '미공개')}
- 향: ${show(property.direction, '미상')} · 현재 거주 상태: ${show(property.occupancy_status, '미상')}
- 주차: ${show(property.parking, '미공개')}

## ⚠️ 중개사 제공 정보 (미검증 주장 — 사실로 단정 말고 claimCheck에서 데이터와 대조)
${property.description || '(중개사 설명 없음)'}

## 📍 생활권 (학군 정보는 포함되지 않음)
- 역세권 분류: ${lifestyle.stationArea || classifyStationArea(lifestyle.subway)}
${lifestyleLines}

## 📊 같은 지역(${show(property.region, '미상')}) 다른 급매 매물 (가격 비교용 참고)
${nearby.length
    ? nearby.map((n) => `- ${n.title} (${show(n.area, '?')}㎡, ${show(n.built_year, '?')}년): 매도가 ${won(n.price)}원 / 기준가 ${won(n.actual_transaction_price)}원 / 할인 ${Number(n.discount_rate)}%`).join('\n')
    : '- (비교 매물 없음)'}

규칙: 가격은 위 "검증된 가격 데이터"만 인용. 학군·역거리·권리·호재 등 위에 없는 정보는 "확인되지 않음"으로. 중개사 주장은 claimCheck에서 검증. 미래 가격 예측 금지.`;
}

type GeminiResult = { report: unknown; promptTokens: number | null; completionTokens: number | null };

async function callGemini(key: string, model: string, userText: string): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.7,
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${model}: ${res.status} ${body.slice(0, 180)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? '';
  if (!text) throw new Error(`${model}: 빈 응답`);
  const usage = data?.usageMetadata ?? {};
  return {
    report: JSON.parse(text),
    promptTokens: Number.isFinite(usage.promptTokenCount) ? usage.promptTokenCount : null,
    completionTokens: Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : null,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const REPORT_COLUMNS = 'property_id, report_data, status, model, generated_at';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST 만 지원합니다.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';

  let propertyId = '';
  let force = false;
  try {
    const body = await req.json();
    propertyId = String(body?.propertyId ?? '').trim();
    force = body?.force === true;
  } catch {
    /* fallthrough */
  }
  if (!propertyId) return json({ error: 'propertyId 가 필요합니다.' }, 400);
  if (!geminiKey) {
    return json({ error: 'GEMINI_API_KEY 시크릿이 아직 설정되지 않았습니다. Supabase 대시보드 → Edge Functions → Secrets 에 추가해주세요.' }, 503);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // 1) 호출자 — 로그인하지 않았으면 익명(일반 방문자)
    let role = 'user';
    let callerEmail = '';
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader.startsWith('Bearer ')) {
      const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: userData } = await caller.auth.getUser();
      const uid = userData?.user?.id;
      if (uid) {
        const { data: profile } = await admin.from('profiles').select('role, email').eq('id', uid).maybeSingle();
        role = profile?.role ?? 'user';
        callerEmail = profile?.email ?? '';
      }
    }

    // 2) 매물
    const { data: property } = await admin
      .from('properties')
      .select('id, title, address, region, price, actual_transaction_price, discount_rate, price_basis, area, supply_area, floor, rooms, bathrooms, built_year, unit_count, direction, occupancy_status, parking, description, lifestyle, price_history, verified, agent')
      .eq('id', propertyId)
      .maybeSingle<PropertyRow>();
    if (!property) return json({ error: '매물을 찾을 수 없습니다.' }, 404);

    const isStaff = role === 'admin' || role === 'owner';
    const isOwnAgent = role === 'agent' && Boolean(callerEmail) && property.agent?.email === callerEmail;
    if (!property.verified && !isStaff && !isOwnAgent) {
      return json({ error: '검증 전 매물의 리포트는 담당 중개사·운영진만 생성할 수 있습니다.' }, 403);
    }
    if (force && !isStaff && !isOwnAgent) {
      return json({ error: '리포트 다시 생성은 담당 중개사·운영진만 할 수 있습니다.' }, 403);
    }

    const held = property.actual_transaction_price == null
      || property.discount_rate == null
      || property.price_basis?.status === 'insufficient';
    if (held) {
      return json({ error: '기준 실거래가가 산출되지 않은 매물(판정 보류)은 가격 분석을 할 수 없어 AI 리포트를 만들지 않습니다.' }, 422);
    }

    // 3) 캐시·락 — 완료된 리포트는 force 가 아니면 그대로 돌려준다
    const { data: existing } = await admin
      .from('property_reports')
      .select(REPORT_COLUMNS)
      .eq('property_id', propertyId)
      .maybeSingle();
    const existingStatus = existing?.status ?? 'ready';
    const existingAge = existing?.generated_at ? Date.now() - new Date(existing.generated_at).getTime() : Infinity;
    if (existing && existingStatus === 'ready' && !force) {
      return json({ report: existing, cached: true });
    }
    if (existing && existingStatus === 'generating' && existingAge < LOCK_TTL_MS) {
      return json({ generating: true }, 202);
    }

    // 락 선점 — 행이 없으면 insert, 있으면 '생성 중이 아닌' 조건으로 update (동시 요청 중 하나만 통과)
    const lockRow = { property_id: propertyId, report_data: {}, status: 'generating', generated_at: new Date().toISOString() };
    if (!existing) {
      const { error: insertError } = await admin.from('property_reports').insert(lockRow);
      if (insertError) {
        if (insertError.code === '23505') return json({ generating: true }, 202);
        throw insertError;
      }
    } else {
      const staleBefore = new Date(Date.now() - LOCK_TTL_MS).toISOString();
      const { data: locked } = await admin
        .from('property_reports')
        .update(lockRow)
        .eq('property_id', propertyId)
        .or(`status.neq.generating,generated_at.lt.${staleBefore}`)
        .select('property_id');
      if (!locked || locked.length === 0) return json({ generating: true }, 202);
    }

    // 4) 같은 지역(시·도) 비교 매물 — 검증 완료·기준가 있는 것만, 할인율 높은 순 10건
    const regionPrefix = (property.region ?? '').split(' ')[0];
    let nearby: NearbyRow[] = [];
    if (regionPrefix) {
      const { data: nearbyRows } = await admin
        .from('properties')
        .select('title, area, built_year, price, actual_transaction_price, discount_rate')
        .eq('verified', true)
        .neq('id', propertyId)
        .like('region', `${regionPrefix}%`)
        .not('actual_transaction_price', 'is', null)
        .not('discount_rate', 'is', null)
        .order('discount_rate', { ascending: false })
        .limit(10);
      nearby = (nearbyRows ?? []) as NearbyRow[];
    }

    // 5) 생성 (모델 폴백) → 저장
    const userText = buildUserPrompt(property, nearby);
    let result: GeminiResult | null = null;
    let usedModel = '';
    let lastError: Error | null = null;
    for (const model of MODELS) {
      try {
        result = await callGemini(geminiKey, model, userText);
        usedModel = `google/${model}`;
        break;
      } catch (err) {
        lastError = err as Error;
      }
    }
    if (!result) {
      // 실패한 락은 풀어 둔다 — 다음 요청이 다시 시도할 수 있게
      await admin.from('property_reports').update({
        report_data: { error: String(lastError?.message ?? '알 수 없는 오류').slice(0, 300) },
        status: 'failed',
        generated_at: new Date().toISOString(),
      }).eq('property_id', propertyId);
      return json({ error: `AI 리포트 생성 실패: ${String(lastError?.message).slice(0, 200)}` }, 502);
    }

    const saved = {
      property_id: propertyId,
      report_data: result.report,
      status: 'ready',
      model: usedModel,
      generated_at: new Date().toISOString(),
      prompt_token_count: result.promptTokens,
      completion_token_count: result.completionTokens,
    };
    const { error: saveError } = await admin.from('property_reports').update(saved).eq('property_id', propertyId);
    if (saveError) throw saveError;

    return json({
      report: {
        property_id: saved.property_id,
        report_data: saved.report_data,
        status: saved.status,
        model: saved.model,
        generated_at: saved.generated_at,
      },
    });
  } catch (err) {
    return json({ error: `AI 리포트 생성 실패: ${String((err as Error).message).slice(0, 300)}` }, 500);
  }
});
