#!/usr/bin/env node
/*
 * generate-reports.mjs — 대표 매물 AI 리포트 샘플 생성 → public/data/property_reports.json
 *
 * 로컬 모드(백엔드 없음)에서는 매물 상세의 AI 리포트를 실시간 생성할 수 없으므로,
 * 대표 매물 N개의 리포트를 미리 Gemini로 생성해 번들한다.
 * (옛 api/property-report.js 의 프롬프트·스키마를 그대로 이식, REST 호출로 단순화)
 *
 * 사용:
 *   1) .env.local 에  GOOGLE_GENERATIVE_AI_API_KEY=...  추가 (https://aistudio.google.com/apikey)
 *   2) node scripts/generate-reports.mjs            # 기본 15개
 *      node scripts/generate-reports.mjs 20         # 개수 지정
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COUNT = Number(process.argv[2]) || 15;
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

// ── 프롬프트 (옛 api/property-report.js 이식) ──
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

function buildUserPrompt(property, nearby) {
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
    .filter(([k, v]) => v && k !== 'stationArea')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- (확인된 주변 시설 정보 없음)';

  return `아래 데이터로 5개 파트 리포트를 작성하세요.

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

## 📍 생활권 (학군 정보는 포함되지 않음)
- 역세권 분류: ${property.lifestyle?.stationArea || classifyStationArea(property.lifestyle?.subway)}
${lifestyleLines}

## 📊 같은 지역(${property.region}) 다른 급매 매물 (가격 비교용 참고)
${nearby.length
    ? nearby.map((n) => `- ${n.title} (${n.area}㎡, ${n.built_year ?? '?'}년): 매도가 ${n.price.toLocaleString()}원 / 기준가 ${n.actual_transaction_price?.toLocaleString() ?? '?'}원 / 할인 ${n.discount_rate}%`).join('\n')
    : '- (비교 매물 없음)'}

규칙: 가격은 위 "검증된 가격 데이터"만 인용. 학군·역거리·권리·호재 등 위에 없는 정보는 "확인되지 않음"으로. 중개사 주장은 claimCheck에서 검증. 미래 가격 예측 금지.`;
}

// ── Gemini responseSchema (REPORT_SCHEMA 의 텍스트 파트만, 사진 제외) ──
const S = (description) => ({ type: 'STRING', description });
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

async function generate(key, property, nearby) {
  const user = buildUserPrompt(property, nearby);
  let lastErr;
  for (const model of MODELS) {
    try {
      const report = await callGemini(key, model, SYSTEM_PROMPT, user);
      return { report, model: `google/${model}` };
    } catch (err) {
      lastErr = err;
      console.warn(`    ↳ ${model} 실패: ${String(err.message).slice(0, 120)}`);
    }
  }
  throw lastErr;
}

// ── 대표 매물 선정: 추이 데이터 있고 할인율 높은 순, 지역당 최대 5개 ──
function pickRepresentative(all, count) {
  const eligible = all
    .filter((p) => Array.isArray(p.price_history) && p.price_history.length >= 2 && p.actual_transaction_price)
    .sort((a, b) => (b.discount_rate || 0) - (a.discount_rate || 0));
  const perRegion = {};
  const picked = [];
  for (const p of eligible) {
    const region = (p.region || '').split(' ')[0] || '기타';
    perRegion[region] = (perRegion[region] || 0) + 1;
    if (perRegion[region] > 5) continue;
    picked.push(p);
    if (picked.length >= count) break;
  }
  return picked;
}

function nearbyFor(all, property) {
  const region = (property.region || '').split(' ')[0];
  return all
    .filter((n) => n.id !== property.id && (n.region || '').startsWith(region))
    .sort((a, b) => (b.discount_rate || 0) - (a.discount_rate || 0))
    .slice(0, 10);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const key = loadKey();
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'properties.json'), 'utf-8'));
  const targets = pickRepresentative(all, COUNT);
  console.log(`대표 매물 ${targets.length}개 리포트 생성 시작 (모델 ${MODELS[0]})...`);

  const rows = [];
  for (let i = 0; i < targets.length; i += 1) {
    const p = targets[i];
    process.stdout.write(`[${i + 1}/${targets.length}] ${p.title} (${p.region}, ${p.discount_rate}%) ... `);
    try {
      const { report, model } = await generate(key, p, nearbyFor(all, p));
      rows.push({
        property_id: p.id,
        report_data: report,
        status: 'ready',
        model,
        generated_at: new Date().toISOString(),
      });
      console.log('✓');
    } catch (err) {
      console.log(`✗ ${String(err.message).slice(0, 100)}`);
    }
    await sleep(1500); // 무료 한도(RPM) 보호
  }

  const out = path.join(ROOT, 'public', 'data', 'property_reports.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 0), 'utf-8');
  console.log(`\n완료: ${rows.length}/${targets.length}건 → public/data/property_reports.json (${Math.round(fs.statSync(out).size / 1024)}KB)`);
}

main().catch((err) => {
  console.error('\n실패:', err.message);
  process.exit(1);
});
