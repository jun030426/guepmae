#!/usr/bin/env node
/*
 * generate-market-report.mjs — AI 시장 분석 리포트 생성 → public/data/ai_market_reports.json
 *
 * 로컬 모드(백엔드 없음)에서는 시장 리포트를 실시간 생성할 수 없으므로,
 * market_snapshots 번들을 입력으로 리포트를 미리 Gemini 로 생성해 번들한다.
 * (옛 api/market-report.js 의 프롬프트·스키마를 그대로 이식, REST 호출로 단순화)
 *
 * 사용:
 *   1) .env.local 에  GOOGLE_GENERATIVE_AI_API_KEY=...  추가 (https://aistudio.google.com/apikey)
 *   2) node scripts/generate-market-report.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

// ── .env.local 에서 API 키 ──
function loadKey() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local 이 없습니다.');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const key = env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      '.env.local 에 GOOGLE_GENERATIVE_AI_API_KEY 가 없습니다.\n'
      + '→ https://aistudio.google.com/apikey 에서 무료 발급 후 추가하세요.',
    );
  }
  return key;
}

// ── 프롬프트 (옛 api/market-report.js 이식) ──
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

// ── Gemini responseSchema (옛 REPORT_SCHEMA zod 정의 이식) ──
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    dataAsOf: {
      type: 'string',
      description: '데이터 기준 월 (예: "2026-05"). 입력 metadata.lastUpdated 에서 정확히 인용.',
    },
    marketMood: {
      type: 'string',
      enum: ['premium-dominant', 'discount-dominant', 'mixed', 'neutral'],
      description:
        '전반적인 시장 무드. 평균 음수(프리미엄) 지역 우세면 premium-dominant, 양수(할인) 우세면 discount-dominant, 비슷하면 mixed, 데이터 부족이면 neutral.',
    },
    insights: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      description:
        '3~5개 인사이트 카드. 다양한 각도로 (시장 무드, 지역별 차이, 평균-중앙값 격차, 면적/단지 패턴 등).',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              '인사이트 한 줄 제목 (12-30자). 데이터에서 관찰된 패턴 요약. 예측·권유 금지. 예: "수도권 평균이 강남 신축 영향으로 음수".',
          },
          body: {
            type: 'string',
            description:
              '2-4문장 본문. 어떤 데이터가 어떻게 보이는지 사실 기술 + 한 줄 함의. 미래 단정·매수 권유 금지. 데이터 기준일을 본문에 자연스럽게 명시 가능.',
          },
          supportNumbers: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string' },
            description:
              '이 인사이트의 근거 수치들. 입력 데이터에서 직접 인용한 형태 (예: "서울 평균 -32.8%", "중앙값 -1.1%"). 새 수치를 만들지 마세요.',
          },
          sourceArea: {
            type: 'string',
            description:
              '이 인사이트가 다루는 영역. 예: "서울", "수도권", "전국", "60-85㎡ 면적대", "급매 단지 Top 10".',
          },
        },
        required: ['title', 'body', 'supportNumbers', 'sourceArea'],
      },
    },
  },
  required: ['dataAsOf', 'marketMood', 'insights'],
};

// ── 사용자 프롬프트 (옛 buildMarketUserPrompt 이식) ──
function buildUserPrompt(market) {
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

async function callGemini(key, model, system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.7,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error('빈 응답');
  return JSON.parse(text);
}

async function generate(key, market) {
  const user = buildUserPrompt(market);
  let lastErr;
  for (const model of MODELS) {
    try {
      const report = await callGemini(key, model, SYSTEM_PROMPT, user);
      return { report, model: `google/${model}` };
    } catch (err) {
      lastErr = err;
      console.warn(`  ↳ ${model} 실패: ${String(err.message).slice(0, 120)}`);
    }
  }
  throw lastErr;
}

async function main() {
  const key = loadKey();
  const snapshotPath = path.join(ROOT, 'public', 'data', 'market_snapshots.json');
  if (!fs.existsSync(snapshotPath)) {
    throw new Error('public/data/market_snapshots.json 이 없습니다. 시장 스냅샷을 먼저 생성하세요.');
  }
  const market = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  const dataAsOf = market.metadata?.lastUpdated || null;

  console.log(`시장 리포트 생성 시작 (기준 ${dataAsOf || '미상'}, 모델 ${MODELS[0]})...`);
  const { report, model } = await generate(key, market);

  const rows = [
    {
      data_as_of: report.dataAsOf || dataAsOf,
      report_data: report,
      status: 'ready',
      model,
      generated_at: new Date().toISOString(),
    },
  ];

  const out = path.join(ROOT, 'public', 'data', 'ai_market_reports.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 0), 'utf-8');
  console.log(
    `\n완료: 인사이트 ${report.insights?.length ?? 0}개 → public/data/ai_market_reports.json (${Math.round(fs.statSync(out).size / 1024)}KB)`,
  );
}

main().catch((err) => {
  console.error('\n실패:', err.message);
  process.exitCode = 1;
});
