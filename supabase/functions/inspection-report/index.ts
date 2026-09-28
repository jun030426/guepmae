/*
 * inspection-report — 매물 사진 기반 AI 점검 체크리스트 생성.
 *
 * POST { propertyId } (JWT 필수 — verify_jwt)
 *  1) 호출자 role 확인: agent(자기 매물만)/admin/owner
 *  2) 매물 사진(media)을 Gemini 멀티모달로 분석 — 수도·배관/가스/전기 등 8개 항목
 *  3) property_inspections 에 upsert 후 리포트 반환
 *
 * 원칙: 사진으로 확인되지 않는 항목은 반드시 '확인 불가' — 추측·과장 금지.
 * 시크릿: GEMINI_API_KEY (대시보드 → Edge Functions → Secrets)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const CHECK_CATEGORIES = [
  '수도·배관',
  '가스',
  '전기·조명',
  '누수·곰팡이',
  '창호·단열',
  '바닥·벽 마감',
  '주방 설비',
  '욕실 설비',
];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '2~3문장 종합 소견. 사진에서 관찰된 사실만. 확인 불가 항목이 많으면 그 한계를 명시.',
    },
    grade: {
      type: 'string',
      enum: ['양호', '보통', '주의 필요', '확인 항목 많음'],
      description: '사진 근거 기반 종합 등급. 확인 불가가 절반 이상이면 반드시 "확인 항목 많음".',
    },
    items: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      description: `8개 점검 항목, 반드시 이 순서: ${CHECK_CATEGORIES.join(' → ')}`,
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CHECK_CATEGORIES },
          status: {
            type: 'string',
            enum: ['양호', '주의', '확인 불가'],
            description: '사진에서 해당 항목이 안 보이면 반드시 "확인 불가".',
          },
          finding: {
            type: 'string',
            description: '어느 사진에서 무엇이 보였는지 1~2문장. 확인 불가면 왜 확인할 수 없는지.',
          },
          action: {
            type: 'string',
            description: '매수자가 현장에서 확인·요청할 일 1문장. 예: "싱크대 하부장 열어 배관 누수 흔적 확인".',
          },
        },
        required: ['category', 'status', 'finding', 'action'],
      },
    },
  },
  required: ['summary', 'grade', 'items'],
};

const SYSTEM_PROMPT = `당신은 아파트 매물 사진으로 설비 상태를 점검하는 신중한 주택 인스펙터입니다.
독자는 이 매물 매수를 검토 중인 일반 매수자이며, 이 플랫폼의 핵심 가치는 "추측·과장 없이 근거로 증명"입니다.

[절대 규칙]
1. 사진에 보이는 것만 판단하세요. 보이지 않는 항목은 반드시 status "확인 불가" — 절대 추측하지 마세요.
2. "주의"는 사진에 구체적 근거(얼룩·부식·균열·곰팡이·노후 흔적 등)가 보일 때만. finding 에 그 근거를 명시하세요.
3. "양호"도 근거가 필요합니다 — 해당 설비가 사진에 실제로 보이고 특이사항이 없을 때만.
4. 수리비·가격·가치 판단 금지. 상태 관찰과 현장 확인 권고만 하세요.
5. 모든 항목의 action 은 매수자가 현장 방문 때 실행할 수 있는 구체적 행동 1가지.

[표본 — 이 톤과 근거 수준을 따르세요]
{
  "category": "누수·곰팡이",
  "status": "주의",
  "finding": "거실 사진(3번째)의 천장 모서리에 갈색 얼룩이 보입니다. 과거 누수 흔적일 수 있으나 사진만으로 현재 진행 여부는 판단할 수 없습니다.",
  "action": "현장에서 해당 천장 모서리를 만져 습기 여부를 확인하고, 윗집 누수 이력을 중개사에게 문의하세요."
}
{
  "category": "가스",
  "status": "확인 불가",
  "finding": "제공된 사진에 가스레인지·보일러·배관이 보이지 않아 상태를 판단할 수 없습니다.",
  "action": "현장에서 보일러 연식 스티커와 가스 밸브 상태를 직접 확인하세요."
}

출력은 주어진 JSON schema 를 정확히 따르고, 8개 항목을 지정된 순서로 모두 채우세요.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

async function toInlinePart(src: string): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  try {
    if (src.startsWith('data:image/')) {
      const match = src.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
      if (!match) return null;
      return { inline_data: { mime_type: match[1], data: match[2] } };
    }
    if (/^https?:\/\//.test(src)) {
      const res = await fetch(src);
      if (!res.ok) return null;
      const mime = res.headers.get('content-type') ?? '';
      if (!mime.startsWith('image/')) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
      return { inline_data: { mime_type: mime.split(';')[0], data: bytesToBase64(buf) } };
    }
    return null;
  } catch {
    return null;
  }
}

async function callGemini(key: string, model: string, photoParts: unknown[], property: { title: string; description: string | null }) {
  const userText = `아래 매물의 사진 ${photoParts.length}장을 점검하세요.

매물: ${property.title}
중개사 제공 설명(검증되지 않은 주장 — 사실로 단정하지 말 것): ${property.description || '(없음)'}

사진은 첨부 순서대로 1번, 2번… 으로 지칭하세요.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userText }, ...photoParts] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.4,
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
  return JSON.parse(text);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST 만 지원합니다.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';

  let propertyId = '';
  try {
    const body = await req.json();
    propertyId = String(body?.propertyId ?? '').trim();
  } catch {
    /* fallthrough */
  }
  if (!propertyId) return json({ error: 'propertyId 가 필요합니다.' }, 400);
  if (!geminiKey) {
    return json({ error: 'GEMINI_API_KEY 시크릿이 아직 설정되지 않았습니다. Supabase 대시보드 → Edge Functions → Secrets 에 추가해주세요.' }, 503);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // 1) 호출자 역할·소유 확인
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ error: '로그인이 필요합니다.' }, 401);

    const { data: profile } = await admin.from('profiles').select('role, email').eq('id', uid).maybeSingle();
    const role = profile?.role ?? 'user';
    if (!['agent', 'admin', 'owner'].includes(role)) {
      return json({ error: '중개사·운영진만 점검 리포트를 생성할 수 있습니다.' }, 403);
    }

    const { data: property } = await admin
      .from('properties')
      .select('id, title, description, media, agent')
      .eq('id', propertyId)
      .maybeSingle();
    if (!property) return json({ error: '매물을 찾을 수 없습니다.' }, 404);

    const agentEmail = (property.agent as { email?: string } | null)?.email ?? '';
    if (role === 'agent' && agentEmail !== profile?.email) {
      return json({ error: '자신이 등록한 매물만 점검 리포트를 생성할 수 있습니다.' }, 403);
    }

    // 2) 사진 수집 (최대 8장)
    const media = Array.isArray(property.media) ? property.media : [];
    const photoParts: unknown[] = [];
    for (const item of media) {
      if (photoParts.length >= 8) break;
      if (!item?.src || (item.type && item.type !== 'photo')) continue;
      const part = await toInlinePart(item.src);
      if (part) photoParts.push(part);
    }
    if (photoParts.length === 0) {
      return json({ error: '이 매물에는 분석할 수 있는 사진이 없습니다. 사진을 먼저 등록해주세요.' }, 400);
    }

    // 3) 생성 (락 → Gemini → 저장)
    await admin.from('property_inspections').upsert({
      property_id: propertyId,
      report_data: {},
      status: 'generating',
      photo_count: photoParts.length,
    });

    let report: unknown = null;
    let usedModel = '';
    let lastError: Error | null = null;
    for (const model of MODELS) {
      try {
        report = await callGemini(geminiKey, model, photoParts, property);
        usedModel = `google/${model}`;
        break;
      } catch (err) {
        lastError = err as Error;
      }
    }
    if (!report) {
      await admin.from('property_inspections').upsert({
        property_id: propertyId,
        report_data: { error: String(lastError?.message ?? '알 수 없는 오류').slice(0, 300) },
        status: 'failed',
        photo_count: photoParts.length,
      });
      return json({ error: `AI 분석 실패: ${String(lastError?.message).slice(0, 200)}` }, 502);
    }

    await admin.from('property_inspections').upsert({
      property_id: propertyId,
      report_data: report,
      status: 'ready',
      model: usedModel,
      photo_count: photoParts.length,
      generated_at: new Date().toISOString(),
    });

    return json({ report, model: usedModel, photoCount: photoParts.length });
  } catch (err) {
    return json({ error: `점검 리포트 생성 실패: ${String((err as Error).message).slice(0, 300)}` }, 500);
  }
});
