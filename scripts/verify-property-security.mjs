// Explicit production smoke test: creates isolated fixtures and always removes them.
// Run only when authorized: node --env-file=<private env> scripts/verify-property-security.mjs --run
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--run')) throw new Error('Explicit --run is required; this test creates temporary production fixtures.');
const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
assert.equal(url, 'https://oormfipegcfbhvctikfl.supabase.co', 'Only the authorized guepmae project may be tested.');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(key && service, 'Credentials must be supplied privately.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, options);
const anon = createClient(url, key, options);
const run = `security-${randomUUID()}`;
const users = [], properties = [], uploads = [];
let checks = 0;
const pass = (label) => { checks++; console.log(`PASS ${label}`); };
const ok = ({ data, error }) => { if (error) throw new Error(`${error.code || error.status || ''}: ${error.message}`); return data; };
async function actor(role, suspended = false) {
  const password = `${randomUUID()}aA1!`;
  const email = `${run}-${users.length}@example.invalid`;
  const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: '보안 검증 임시 계정' } })).user;
  users.push(user.id);
  ok(await admin.from('profiles').update({ role, suspended }).eq('id', user.id));
  const client = createClient(url, key, options);
  const { session } = ok(await client.auth.signInWithPassword({ email, password }));
  return { id: user.id, client, token: session.access_token };
}
async function write(actor, body, expected = 200) {
  const response = await fetch(`${url}/functions/v1/property-write`, {
    method: 'POST', headers: { apikey: key, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `property-write: ${JSON.stringify(data)}`);
  return data;
}
const input = { title: '보안 검증 임시 매물 — 실제 거래 대상 아님', address: '보안 검증용 가상 주소', region: '검증', price: 900000000, area: 84, floor: '12층', contact_phone: '000-0000-0000', media: [], complex_name: null, complex_gu: null };
const read = async (client, id) => ok(await client.from('properties').select('*').eq('id', id));
async function upload(actor, bucket, path, upsert = false) {
  // Tiny, synthetic image; never a user photo.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRncAAAAASUVORK5CYII=', 'base64');
  return actor.client.storage.from(bucket).upload(path, bytes, { contentType: 'image/png', upsert });
}
try {
  const a = await actor('agent'), b = await actor('agent'), staff = await actor('admin'), user = await actor('user'), suspended = await actor('agent', true);
  const id = `${run}-listing`; properties.push(id);
  await write(null, { action: 'create', id, input }, 401); pass('unauthenticated Edge request rejected');
  for (const subject of [user, suspended]) await write(subject, { action: 'create', id, input }, 403);
  pass('ordinary and suspended accounts cannot create');
  for (const extra of [{ verified: true }, { created_by: b.id }, { discount_rate: 40 }, { actual_transaction_price: 999 }, { agent: { email: 'forged@example.invalid' } }]) {
    await write(a, { action: 'create', id, input: { ...input, ...extra } }, 400);
  }
  pass('approval, owner, price evidence and agent identity cannot be forged');
  const path = `${a.id}/${id}/photo.png`;
  ok(await upload(a, 'property-photos', path)); uploads.push(['property-photos', path]);
  const photo = `${url}/storage/v1/object/public/property-photos/${path}`;
  assert.ok((await upload(b, 'property-photos', path, true)).error);
  assert.ok((await upload(suspended, 'property-photos', `${suspended.id}/${id}/blocked.png`)).error);
  pass('own photo upload allowed, foreign/suspended overwrite denied');
  const saved = await write(a, { action: 'create', id, input: { ...input, media: [{ src: photo, label: '검증 이미지' }] } });
  assert.equal(saved.verified, false); assert.equal(saved.revision, 1);
  const row = (await read(a.client, id))[0];
  assert.equal(row.created_by, a.id); assert.equal(row.actual_transaction_price, null); assert.equal(row.discount_rate, null); assert.equal(row.last_verified_at, null);
  pass('create persists authoritative ownership and pending/no-data state');
  for (const client of [anon, user.client, b.client, suspended.client]) assert.equal((await read(client, id)).length, 0);
  assert.equal((await read(staff.client, id)).length, 1); pass('pending listing visible only to author and staff');
  for (const subject of [a, b, staff, user]) {
    assert.ok((await subject.client.from('properties').update({ verified: true }).eq('id', id)).error);
    assert.ok((await subject.client.from('properties').insert({ id: `${id}-forged`, ...input })).error);
    assert.ok((await subject.client.rpc('commit_property_change', { p_actor: subject.id, p_action: 'verify', p_id: id, p_expected_revision: 1, p_row: { verified: true } })).error);
  }
  pass('direct browser writes and privileged RPC blocked for all roles');
  await write(b, { action: 'edit', id, expectedRevision: 1, input: { title: '탈취' } }, 403);
  assert.equal(ok(await b.client.from('properties').delete().eq('id', id).select('id')).length, 0);
  await write(a, { action: 'verify', id, expectedRevision: 1, input: { verified: true } }, 403); pass('foreign edit/delete and agent self-approval denied');
  for (const subject of [b, suspended, user]) {
    const res = await fetch(`${url}/functions/v1/inspection-report`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${subject.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: id }) });
    assert.equal(res.status, 403, `inspection authorization: ${await res.text()}`);
  }
  pass('inspection report rejects foreign, suspended and ordinary accounts before AI usage');
  await write(staff, { action: 'verify', id, expectedRevision: 1, input: { verified: true } });
  assert.equal((await read(anon, id)).length, 1); pass('staff approval makes listing public');
  assert.ok((await upload(a, 'property-photos', path, true)).error);
  ok(await a.client.storage.from('property-photos').remove([path]));
  assert.equal((await fetch(photo)).status, 200); pass('approved photo cannot be overwritten or deleted by its author');
  await write(a, { action: 'edit', id, expectedRevision: 2, input: { price: 800000000 } });
  assert.equal((await read(anon, id)).length, 0); assert.equal((await read(a.client, id))[0].last_verified_at, null);
  await write(staff, { action: 'verify', id, expectedRevision: 2, input: { verified: true } }, 409);
  pass('edit returns listing to private review; stale approval rejected');
  ok(await admin.from('profiles').update({ suspended: true }).eq('id', a.id));
  await write(a, { action: 'edit', id, expectedRevision: 3, input: { price: 700000000 } }, 403);
  assert.equal((await read(a.client, id)).length, 0); pass('existing session loses write and pending-read permission immediately on suspension');
  // Use an existing real aggregate only for a private row; do not alter price data.
  const candidate = ok(await admin.from('complex_prices').select('complex,gu,area_m2').gte('sample_size', 3).limit(1))[0];
  if (candidate) {
    const pricingId = `${run}-pricing`; properties.push(pricingId);
    await write(b, { action: 'create', id: pricingId, input: { ...input, complex_name: candidate.complex, complex_gu: candidate.gu, area: candidate.area_m2 } });
    const priced = (await read(b.client, pricingId))[0];
    assert.equal(priced.verified, false);
    assert.equal(priced.actual_transaction_price, priced.price_basis.baselinePrice);
    if (priced.actual_transaction_price != null) assert.equal(Number(priced.discount_rate), Math.round((priced.actual_transaction_price - priced.price) / priced.actual_transaction_price * 1000) / 10);
    pass(`real DB price evidence consistent (${priced.price_basis.status})`);
  }
  console.log(`Completed ${checks} live security scenarios.`);
} finally {
  // Delete only IDs created by this invocation, never existing users or listings.
  for (const [bucket, path] of uploads) ok(await admin.storage.from(bucket).remove([path]));
  if (properties.length) ok(await admin.from('properties').delete().in('id', properties));
  for (const id of users) {
    // Admin delete removes auth sessions; role-dependent checks also reject missing profiles.
    ok(await admin.auth.admin.deleteUser(id));
  }
  if (properties.length) assert.equal(ok(await admin.from('properties').select('id').in('id', properties)).length, 0);
  console.log('Temporary users, properties and uploads removed.');
}
