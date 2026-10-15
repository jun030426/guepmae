import { resolveReferencePrice } from './resolveReferencePrice.js';
import { isValidContactPhone } from './contactPhone.js';

export class PropertyWriteError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new PropertyWriteError(message, status); };
const STAFF = ['admin', 'owner'];
const EDIT_FIELDS = ['title', 'price', 'floor', 'direction', 'occupancy_status', 'rooms', 'bathrooms', 'parking', 'description', 'media', 'contact_phone'];
export const CREATE_FIELDS = [...EDIT_FIELDS, 'address', 'region', 'complex_name', 'complex_gu', 'area', 'supply_area', 'built_year', 'maintenance_fee', 'move_in_date', 'unit_count', 'coordinates'];

export function assertPropertyActor(profile, action, property) {
  if (!profile || profile.suspended !== false || !['agent', ...STAFF].includes(profile.role)) {
    fail('매물을 관리할 권한이 없습니다.', 403);
  }
  if (action === 'verify' && !STAFF.includes(profile.role)) fail('운영진만 승인할 수 있습니다.', 403);
  if (action !== 'create' && profile.role === 'agent' && property?.created_by !== profile.id) {
    fail('자신이 등록한 매물만 수정할 수 있습니다.', 403);
  }
}

function string(value, label, max, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${label} 값을 확인해주세요.`);
  return value.trim();
}
function number(value, label, { min = 0, max = 1e12, integer = false, nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(`${label} 값을 확인해주세요.`);
  }
  return value;
}

export function validatePropertyInput(input, { action, id, actorId, storageUrl, existing }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('입력값이 필요합니다.');
  const fields = action === 'create' ? CREATE_FIELDS : EDIT_FIELDS;
  if (Object.keys(input).some((key) => !fields.includes(key))) fail('변경할 수 없는 항목이 포함되어 있습니다.');
  const row = { ...input };
  const strings = { title: 200, floor: 40, direction: 40, occupancy_status: 40, parking: 100, description: 10000, address: 300, region: 100, complex_name: 200, complex_gu: 100, move_in_date: 100, contact_phone: 40 };
  const required = action === 'create' ? ['title', 'address', 'region', 'contact_phone'] : [];
  for (const key of required) if (!(key in row)) fail(`${key} 값이 필요합니다.`);
  for (const [key, max] of Object.entries(strings)) {
    if (key in row) row[key] = string(row[key], key, max, required.includes(key) || key === 'title');
  }
  if ('contact_phone' in row && !isValidContactPhone(row.contact_phone)) fail('문의 연락처에 올바른 전화번호를 입력해주세요.');
  if (action === 'create' || 'price' in row) row.price = number(row.price, '가격', { min: 1, integer: true });
  if (action === 'create' || 'area' in row) row.area = number(row.area, '전용면적', { min: 1, max: 10000 });
  for (const key of ['supply_area', 'maintenance_fee', 'rooms', 'bathrooms', 'unit_count', 'built_year']) {
    if (key in row) row[key] = number(row[key], key, { max: key === 'maintenance_fee' ? 1e8 : 100000, integer: key !== 'supply_area', nullable: true });
  }
  if (row.coordinates != null) {
    if (typeof row.coordinates !== 'object' || Array.isArray(row.coordinates)) fail('좌표 값을 확인해주세요.');
    row.coordinates = {
      lat: number(row.coordinates.lat, '위도', { min: -90, max: 90 }),
      lng: number(row.coordinates.lng, '경도', { min: -180, max: 180 }),
    };
  }
  if ('media' in row) {
    if (!Array.isArray(row.media) || row.media.length > 40) fail('사진은 최대 40개까지 저장할 수 있습니다.');
    const oldUrls = new Set((existing?.media || []).map((m) => m.src));
    row.media = row.media.map((item) => {
      if (!item || typeof item.src !== 'string' || item.src.length > 2000) fail('사진 주소를 확인해주세요.');
      const validUpload = ['property-photos', 'property-360'].some((bucket) => {
        const prefix = `${storageUrl}/storage/v1/object/public/${bucket}/${actorId}/${id}/`;
        if (!item.src.startsWith(prefix)) return false;
        const file = item.src.slice(prefix.length);
        return /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(file);
      });
      if (!oldUrls.has(item.src) && !validUpload) fail('이 매물에 업로드한 사진만 사용할 수 있습니다.');
      if (JSON.stringify(item).length > 10000) fail('사진 정보가 너무 큽니다.');
      return item;
    });
  }
  return row;
}

export async function propertyChange({ admin, actorId, body, storageUrl }) {
  const { action, id, input, expectedRevision } = body || {};
  if (!['create', 'edit', 'verify'].includes(action)) fail('잘못된 작업입니다.');
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) fail('매물 ID를 확인해주세요.');
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('id, role, suspended, email, full_name, phone').eq('id', actorId).maybeSingle();
  if (profileError) throw profileError;
  // Do not look up private rows until the caller's current role is verified.
  assertPropertyActor(profile, action === 'verify' ? 'verify' : 'create');
  let existing = null;
  if (action !== 'create') {
    const { data, error } = await admin.from('properties').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) fail('매물을 찾을 수 없습니다.', 404);
    existing = data;
    assertPropertyActor(profile, action, existing);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== existing.revision) {
      fail('매물이 변경되었습니다. 새로고침 후 다시 확인해주세요.', 409);
    }
  }
  let row;
  if (action === 'verify') {
    if (!input || Object.keys(input).length !== 1 || typeof input.verified !== 'boolean') fail('승인 값을 확인해주세요.');
    row = { verified: input.verified };
  } else {
    row = validatePropertyInput(input, { action, id, actorId, storageUrl, existing });
  }
  if (action === 'create') {
    const { data: application, error } = await admin.from('agent_applications').select('office_name')
      .eq('contact_email', profile.email).eq('status', 'approved').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    row.agent = { name: profile.full_name || '담당자', office: application?.office_name || '', phone: row.contact_phone, email: profile.email, verified: Boolean(application) };
    delete row.contact_phone;
    row.property_type = '아파트';
    row.recent_transaction_date = null; // Registration date is not a transaction date.
  } else if (action === 'edit' && 'contact_phone' in row) {
    // Only the number is editable, never the agent identity or certification.
    row.agent = { ...existing.agent, phone: row.contact_phone };
    delete row.contact_phone;
  }
  const next = { ...existing, ...row };
  // Read trusted DB data again on EVERY create/edit/approval. No client baseline,
  // discount, evidence, owner, agent identity, or approval date is accepted.
  const reference = await resolveReferencePrice(admin, {
    complexName: next.complex_name, gu: next.complex_gu, areaM2: next.area, floor: next.floor, price: next.price,
  });
  const { discountRate, ...basis } = reference.basis;
  row.actual_transaction_price = reference.price;
  row.discount_rate = reference.price == null ? null : discountRate;
  row.price_basis = { ...basis, complexName: next.complex_name || null, gu: next.complex_gu || null };
  const { data, error } = await admin.rpc('commit_property_change', {
    p_actor: actorId, p_action: action, p_id: id, p_expected_revision: expectedRevision ?? null, p_row: row,
  });
  if (error) {
    const statuses = { '42501': 403, '40001': 409, '23505': 409, P0002: 404, '22023': 400 };
    if (statuses[error.code]) fail(error.code === '23505' ? '이미 등록된 매물입니다.' : error.message, statuses[error.code]);
    throw error;
  }
  return data;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export function createPropertyWriteHandler({ authenticate, admin, storageUrl }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST만 지원합니다.' }, 405);
    try {
      const user = await authenticate(req);
      if (!user?.id) return json({ error: '로그인이 필요합니다.' }, 401);
      // Bound JSON memory even if Content-Length is missing or false.
      const reader = req.body?.getReader();
      if (!reader) fail('입력값이 필요합니다.');
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) { await reader.cancel(); fail('요청 크기가 너무 큽니다.', 413); }
        chunks.push(value);
      }
      let body;
      try { body = JSON.parse(await new Blob(chunks).text()); } catch { fail('JSON 입력값을 확인해주세요.'); }
      return json(await propertyChange({ admin, actorId: user.id, body, storageUrl }));
    } catch (error) {
      if (error instanceof PropertyWriteError) return json({ error: error.message }, error.status);
      console.error('property-write failed', error?.code || 'unexpected');
      return json({ error: '매물 저장에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 503);
    }
  };
}
