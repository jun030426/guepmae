/*
 * /api/market-report — 시장 분석 AI 리포트 생성/캐싱/반환.
 *
 * GET  → ai_market_reports 에 캐시 있으면 즉시 반환 (RLS allows anon).
 *        없으면 { status: 'no-report' } — 클라이언트는 "분석 준비 중" 표시.
 *        secret 불필요. 누구나 read.
 *
 * GET ?force=true&secret=xxx  → 캐시 무시하고 새로 생성.
 *        env MARKET_REPORT_SECRET 와 일치해야 트리거 가능 (비용 보호).
 *        Vercel 대시보드 → Project Settings → Environment Variables 에 추가 필요.
 *
 * 패턴은 api/property-report.js 그대로 베껴왔음 — 모델 분기·zod schema 강제·락·캐시.
 * 차이: 입력이 시장 데이터(market_snapshots), 트리거 보호(secret) 추가.
 *
 * 환경변수: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (기존)
 *           GCP_* 또는 AI_GATEWAY_API_KEY (기존, 매물 AI 와 공유)
 *           MARKET_REPORT_SECRET (신규) — force 트리거 보호용
 */

import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { z } from 'zod';

/* ============================================================
 * REPORT_SCHEMA — 3~5개 인사이트 카드
 * ============================================================ */
const REPORT_SCHEMA = z.object({
  dataAsOf: z
    .string()
    .describe('데이터 기준 월 (예: "2026-05"). 입력 metadata.lastUpdated 에서 정확히 인용.'),
  marketMood: z
    .enum(['premium-dominant', 'discount-dominant', 'mixed', 'neutral'])
    .describe(
      '전반적인 시장 무드. 평균 음수(프리미엄) 지역 우세면 premium-dominant, 양수(할인) 우세면 discount-dominant, 비슷하면 mixed, 데이터 부족이면 neutral.',
    ),
  insights: z
    .array(
      z.object({
        title: z
          .string()
          .describe(
            '인사이트 한 줄 제목 (12-30자). 데이터에서 관찰된 패턴 요약. 예측·권유 금지. 예: "수도권 평균이 강남 신축 영향으로 음수".',
          ),
        body: z
          .string()
          .describe(
            '2-4문장 본문. 어떤 데이터가 어떻게 보이는지 사실 기술 + 한 줄 함의. 미래 단정·매수 권유 금지. 데이터 기준일을 본문에 자연스럽게 명시 가능.',
          ),
        supportNumbers: z
          .array(z.string())
          .min(1)
          .max(4)
          .describe(
            '이 인사이트의 근거 수치들. 입력 데이터에서 직접 인용한 형태 (예: "서울 평균 -32.8%", "중앙값 -1.1%"). 새 수치를 만들지 마세요.',
          ),
        sourceArea: z
          .string()
          .describe(
            '이 인사이트가 다루는 영역. 예: "서울", "수도권", "전국", "60-85㎡ 면적대", "급매 단지 Top 10".',
          ),
      }),
    )
    .min(3)
    .max(5)
    .describe(
      '3~5개 인사이트 카드. 다양한 각도로 (시장 무드, 지역별 차이, 평균-중앙값 격차, 면적/단지 패턴 등).',
    ),
});

/* ============================================================
 * SYSTEM_PROMPT — 예측·권유 절대 금지
 * ============================================================ */
const SYSTEM_PROMPT = `당신은 한국 부동산 시장 데이터를 분석하는 신중한 분석가입니다.
독자는 급매 매물 매수를 검토 중인 일반 사용자이며, 이 플랫폼의 핵심 가치는 "데이터로 검증된 진단"입니다.
한국어로, 주어진 데이터에만 근거한 객관적 진단을 작성하세요.

[절대 규칙 — 어기면 안 됨]
1. 주어진 데이터(지역/월별/면적/단지/인사이트)만 사용하세요. 외부 지식·뉴스·시장 전망을 인용하지 마세요.
2. **미래 가격 예측 절대 금지**. "오를 것"·"내릴 것"·"전망"·"예상"·"~할 가능성" 같은 미래 단정 표현을 쓰지 마세요. 과거 데이터의 관찰된 패턴만 서술하세요.
3. **매수 권유·투자 권유 절대 금지**. "사세요"·"매수 적기"·"기회입니다"·"추천합니다" 같은 권유 표현을 쓰지 마세요. 데이터가 보여주는 사실만 중립적으로 서술하세요.
4. 모든 숫자는 주어진 데이터에서 정확히 인용하세요. 새 수치를 만들거나 외삽하지 마세요.
5. 데이터 기준 시점(예: "2026-05")을 인사이트 본문에 자연스럽게 한 번 명시하세요. 그 이후 시점은 모릅니다.

[톤] 데이터 저널리스트처럼 — 사실 기술 + 패턴 지적 + 한계 솔직히 인정. 친근하지만 냉정한 전문가. 과장·미사여구·홍보 톤 금지.

[강조점] 다음 같은 진단이 좋은 인사이트입니다:
- "어느 지역이 프리미엄 우세(평균 음수)고 어느 지역이 할인 우세(양수)인가"
- "평균과 중앙값 차이가 큰 지역은 무엇이고 이는 무엇을 의미하는가" (소수 고가 거래가 평균을 흔든 것)
- "면적대별로 가격·할인이 어떻게 분포하는가"
- "급매 집중 단지 Top 10 의 공통점·지역 분포"
- "13개월 추이에서 관찰되는 거래량·급매 비율 변화"

출력 형식은 주어진 JSON schema 를 정확히 따르세요.`;

/* ============================================================
 * 모델 분기 — property-report.js 와 동일 (env 공유)
 * ============================================================ */
const DEFAULT_MODEL = 'gemini-2.5-flash';
const STALE_LOCK_MS = 3 * 60 * 1000;

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

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
          private_key: GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
      },
    });
    return { model: vertex(modelName), label: `vertex/${modelName}` };
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Vertex(GCP_*) 또는 AI_GATEWAY_API_KEY 환경변수가 필요합니다.');
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return { model: google(modelName), label: `google/${modelName}` };
}

/* ============================================================
 * 시장 데이터 fetch + 프롬프트 빌드
 * ============================================================ */
async function fetchMarketContext(supabase) {
  const { data, error } = await supabase.from('market_snapshots').select('key, data');
  if (error) throw error;
  const result = {};
  for (const row of data ?? []) {
    result[row.key] = row.data;
  }
  return result;
}

function buildMarketUserPrompt(market) {
  const md = market.metadata || {};
  const regional = market.regional || [];
  const monthly = market.monthly || [];
  const areaType = market.area_type || [];
  const topUrgent = market.top_urgent || [];
  const insights = market.insights || [];

  const regionalLines = regional
    .map(
      (r) =>
        `- ${r.region}: 평균 ${r.averageDiscount}% / 중앙값 ${r.medianDiscount ?? '?'}% / 거래 ${r.transactionVolume?.toLocaleString() ?? '?'}건 / 급매비율 ${r.urgentRatio != null ? (r.urgentRatio * 100).toFixed(0) + '%' : '?'}`,
    )
    .join('\n');

  const monthlyLines = monthly
    .map(
      (m) =>
        `- ${m.month}: 거래 ${m.transactionVolume?.toLocaleString() ?? '?'}건 / 급매 ${m.urgentCount?.toLocaleString() ?? '?'}건 / 평균할인 ${m.averageDiscount}%`,
    )
    .join('\n');

  const areaLines = areaType
    .map(
      (a) =>
        `- ${a.bucket}: 평균 거래가 ${a.averageDealPrice != null ? (a.averageDealPrice / 100000000).toFixed(2) + '억원' : '?'} / 평균할인 ${a.averageDiscount}% / 거래량 ${a.transactionVolume?.toLocaleString() ?? '?'}건`,
    )
    .join('\n');

  const topLines = topUrgent
    .map(
      (t) =>
        `${t.rank}. ${t.complex} (${t.region}): 급매 ${t.dealCount}/${t.sampleSize}건 / 평균할인 ${t.averageDiscount}%`,
    )
    .join('\n');

  const insightLines = insights
    .map((i) => `- ${i.label}: ${i.value} (${i.delta}, ${i.note})`)
    .join('\n');

  return `아래 데이터로 3~5개 인사이트 카드를 작성하세요.

## 📅 데이터 기준
- 기준 월: ${md.lastUpdated || '미상'}
- 출처: ${md.name || '미상'}
- 총 거래 표본: ${md.totalRows?.toLocaleString() || '?'}건
- 집계 기간: ${md.months?.[0] || '?'} ~ ${md.months?.[md.months.length - 1] || '?'} (${md.months?.length || '?'}개월)
- 공시 지연: ${md.disclosureLag || '미상'}

## 🗺️ 17개 시도 평균/중앙값 (음수 = 또래 시세보다 비싸게 거래 = 프리미엄, 양수 = 할인)
${regionalLines}

## 📈 13개월 월별 추이
${monthlyLines}

## 📐 면적대별
${areaLines}

## 🏘️ 급매 집중 단지 Top 10
${topLines}

## 💡 시장 종합 인사이트 (이미 계산된 값 — 참고용)
${insightLines}

규칙 (재강조):
- 위 데이터만 사용. 외부 지식/뉴스/예측 금지.
- **미래 가격 단정 절대 금지** ("오를"·"내릴"·"전망"·"예상" 등). 과거 패턴만 서술.
- **매수·투자 권유 절대 금지** ("사세요"·"기회"·"추천" 등). 사실 기술만.
- 숫자는 위에서 정확히 인용. 새 수치 만들지 말 것.
- 데이터 기준 ${md.lastUpdated || '미상'}임을 인사이트 본문 또는 dataAsOf 필드에 명시.

좋은 인사이트는 다음 같은 진단:
- "서울 평균 -32.8% vs 중앙값 -1.1%"의 의미 (소수 고가 거래가 평균을 흔든 것, 일반 매물은 거의 시세대로)
- 프리미엄 우세 지역 vs 할인 우세 지역의 분포 패턴
- 면적대별 가격·할인 차이 (소형 vs 대형)
- Top 10 단지의 지역적 분포·공통점
- 13개월 거래량·급매 추이의 관찰된 변화`;
}

async function generateMarketReport(market) {
  const { model, label } = getModel();
  const userText = buildMarketUserPrompt(market);
  const result = await generateObject({
    model,
    schema: REPORT_SCHEMA,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  });
  return { report: result.object, usage: result.usage, model: label };
}

/* ============================================================
 * Handler
 * ============================================================ */
export default async function handler(req, res) {
  const isGet = req.method === 'GET';
  const force =
    (isGet ? req.query.force : req.body?.force) === 'true' || req.body?.force === true;

  try {
    const supabase = getServiceClient();
    const market = await fetchMarketContext(supabase);
    const dataAsOf = market.metadata?.lastUpdated || 'unknown';

    // ----- READ (force 아닐 때) — 캐시 lookup only, 누구나 가능 -----
    if (!force) {
      const { data: existing } = await supabase
        .from('ai_market_reports')
        .select('*')
        .eq('data_as_of', dataAsOf)
        .maybeSingle();

      if (existing?.status === 'ready') {
        return res.status(200).json({ ...existing, cached: true });
      }
      if (existing?.status === 'generating') {
        const age = Date.now() - new Date(existing.generated_at).getTime();
        if (age < STALE_LOCK_MS) {
          return res.status(202).json({ status: 'generating', dataAsOf });
        }
        // stale — 빈 응답으로 폴백 (force=true 트리거 안내)
      }
      return res.status(200).json({
        status: 'no-report',
        dataAsOf,
        message: '아직 분석이 생성되지 않았습니다. 관리자가 force=true 로 트리거해야 합니다.',
      });
    }

    // ----- WRITE (force=true) — secret 검증 -----
    const providedSecret = isGet ? req.query.secret : req.body?.secret;
    const expectedSecret = process.env.MARKET_REPORT_SECRET;
    if (!expectedSecret) {
      return res.status(503).json({
        error:
          'MARKET_REPORT_SECRET 환경변수가 미설정되어 force 트리거가 비활성 상태입니다. Vercel 대시보드에서 추가하세요.',
      });
    }
    if (providedSecret !== expectedSecret) {
      return res.status(401).json({ error: 'secret 불일치.' });
    }

    // 락 선점 (force 라 stale 무시하고 덮어씀)
    await supabase.from('ai_market_reports').upsert({
      data_as_of: dataAsOf,
      report_data: {},
      status: 'generating',
      generated_at: new Date().toISOString(),
    });

    try {
      const { report, usage, model } = await generateMarketReport(market);

      const { data: saved, error: saveError } = await supabase
        .from('ai_market_reports')
        .upsert({
          data_as_of: dataAsOf,
          report_data: report,
          status: 'ready',
          model,
          generated_at: new Date().toISOString(),
          prompt_token_count: usage?.promptTokens ?? null,
          completion_token_count: usage?.completionTokens ?? null,
        })
        .select('*')
        .single();
      if (saveError) throw saveError;

      return res.status(200).json({ ...saved, cached: false });
    } catch (genError) {
      // 생성 실패 → 락 정리 (다음 force=true 트리거가 즉시 가능)
      await supabase
        .from('ai_market_reports')
        .delete()
        .eq('data_as_of', dataAsOf)
        .eq('status', 'generating')
        .then(
          () => {},
          () => {},
        );
      throw genError;
    }
  } catch (err) {
    console.error('[market-report] failed:', err);
    return res.status(500).json({ error: err.message || 'unknown error' });
  }
}
