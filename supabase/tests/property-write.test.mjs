import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { propertyChange, createPropertyWriteHandler } from '../functions/_shared/propertyWrite.js';

// PostgreSQL/RLS via PGlite. Auth/Storage schemas are fixtures; the property
// migration, handler, pricing algorithm and commit function are production code.
const pg = new PGlite();
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGENT = uid(1), OTHER = uid(2), ADMIN = uid(3), OWNER = uid(4), USER = uid(5), SUSPENDED = uid(6);
const storageUrl = 'https://test.supabase.co';
const migration = (name) => fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.app_role as enum ('user', 'agent', 'admin', 'owner');
    create table public.profiles(id uuid primary key, email text not null, full_name text, phone text,
      role public.app_role not null, suspended boolean not null default false);
    grant select on public.profiles to authenticated;
    grant all on public.profiles to service_role;
    create schema storage;
    create table storage.objects(id int generated always as identity, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant all on storage.objects to authenticated;
    grant usage, select on all sequences in schema storage to authenticated;
    create policy old_permissive_storage on storage.objects for all to authenticated using (true) with check (true);
    create table public.agent_applications(contact_email text, office_name text, status text, created_at timestamptz);
    create table public.complex_prices(complex text, gu text, area_m2 int, median_price bigint,
      sample_size int, earliest_year_month text, latest_year_month text);
    create table public.complex_trades(complex text, gu text, area_m2 int, latest_year_month text, trades jsonb);
    grant all on public.agent_applications, public.complex_prices, public.complex_trades to service_role;
  `);
  const initial = await migration('20260514000000_initial_real_estate_schema.sql');
  await pg.exec(initial.split('create table if not exists public.property_submissions')[0].replace('create extension if not exists pgcrypto;', ''));
  for (const name of ['20260530040000_property_direction_occupancy.sql', '20260624010000_properties_price_basis.sql', '20260930110000_properties_discount_rate_nullable.sql']) {
    await pg.exec(await migration(name));
  }
  await pg.exec(`grant insert, update on public.properties to authenticated;
    grant update (verified) on public.properties to authenticated;
    create policy legacy_broad_writes on public.properties for all to authenticated using (true) with check (true);`);
  await pg.exec(await migration('20261013061805_secure_property_writes.sql'));
  const metrics = await migration('20260930150000_pilot_metrics.sql');
  await pg.exec(metrics.slice(0, metrics.indexOf('create table if not exists public.agent_pricing_intents')));
  await pg.exec(await migration('20261015090544_complete_property_cycle.sql'));
  await pg.exec(`alter table public.profiles enable row level security;
    create policy profiles_read on public.profiles for select to authenticated
    using (id = auth.uid() or public.current_user_role()::text in ('admin','owner'));`);
  for (const [n, role] of [[1, 'agent'], [2, 'agent'], [3, 'admin'], [4, 'owner'], [5, 'user'], [6, 'agent']]) {
    await pg.query('insert into profiles values ($1,$2,$3,$4,$5,$6)', [uid(n), `actor${n}@example.test`, `actor${n}`, '010-0000-0000', role, n === 6]);
  }
  await pg.exec(`insert into complex_prices values ('테스트단지','서울특별시 강남구',84,1000000000,5,'2025-10','2026-09');`);
});
after(() => pg.close());

async function asRole(role, actor, sql, params = []) {
  return pg.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [actor || '']);
    return tx.query(sql, params);
  });
}
// PostgREST-shaped fixture: every query actually executes against PostgreSQL.
const admin = {
  from(table) {
    const filters = [], params = []; let single = false; let limit = ''; let order = '';
    const b = {
      select() { return b; },
      eq(key, value) { params.push(value); filters.push(`${key} = $${params.length}`); return b; },
      gte(key, value) { params.push(value); filters.push(`${key} >= $${params.length}`); return b; },
      lte(key, value) { params.push(value); filters.push(`${key} <= $${params.length}`); return b; },
      order(key, { ascending }) { order = `order by ${key} ${ascending ? 'asc' : 'desc'}`; return b; },
      limit(n) { limit = `limit ${n}`; return b; },
      maybeSingle() { single = true; return b; },
      async then(resolve, reject) {
        try {
          const { rows } = await asRole('service_role', null, `select * from public.${table} ${filters.length ? `where ${filters.join(' and ')}` : ''} ${order} ${limit}`, params);
          return resolve({ data: single ? rows[0] || null : rows, error: null });
        } catch (error) { return reject(error); }
      },
    }; return b;
  },
  async rpc(name, p) {
    try {
      const { rows } = await asRole('service_role', null, `select public.${name}($1,$2,$3,$4,$5) as result`, [p.p_actor, p.p_action, p.p_id, p.p_expected_revision, JSON.stringify(p.p_row)]);
      return { data: rows[0].result, error: null };
    } catch (error) { return { data: null, error }; }
  },
};
const base = () => ({ title: '테스트 매물', address: '서울특별시 강남구 테스트로', region: '서울 강남구', complex_name: '테스트단지', complex_gu: '서울특별시 강남구', price: 900000000, area: 84, floor: '3층', contact_phone: '010-0000-0000', media: [] });
const change = (actorId, body, client = admin) => propertyChange({ admin: client, actorId, body, storageUrl });
const create = (id, actor = AGENT, input = base()) => change(actor, { action: 'create', id, input });
const row = async (id) => (await pg.query('select * from properties where id = $1', [id])).rows[0];
const denied = (fn, status = 403) => assert.rejects(fn, (e) => e.status === status);

test('create computes trusted evidence; pending rows are visible only to author/staff', async () => {
  const saved = await create('private');
  assert.equal(saved.revision, 1);
  const p = await row('private');
  assert.equal(p.created_by, AGENT);
  assert.equal(p.verified, false);
  assert.equal(p.last_verified_at, null);
  assert.equal(p.recent_transaction_date, null);
  assert.equal(p.actual_transaction_price, 1000000000);
  assert.equal(Number(p.discount_rate), 10);
  assert.equal(p.agent.email, 'actor1@example.test');
  assert.equal(p.agent.verified, false);
  for (const [actor, expected] of [[null, 0], [OTHER, 0], [USER, 0], [SUSPENDED, 0], [AGENT, 1], [ADMIN, 1], [OWNER, 1]]) {
    const result = await asRole(actor ? 'authenticated' : 'anon', actor, "select id from properties where id = 'private'");
    assert.equal(result.rows.length, expected, `read scope ${actor}`);
  }
});

test('crafted direct writes and service-only RPC calls fail for every browser role', async () => {
  for (const actor of [AGENT, ADMIN, OWNER, USER, SUSPENDED]) {
    for (const sql of ["update properties set verified = true where id = 'private'", "insert into properties(id,title,address,region,property_type,price) values('forged','t','a','r','아파트',1)", `select commit_property_change('${actor}', 'verify', 'private', 1, '{"verified":true}')`]) {
      await assert.rejects(() => asRole('authenticated', actor, sql), (e) => e.code === '42501');
    }
  }
});

test('clients cannot submit approval, owner, agent identity or price evidence', async () => {
  for (const [key, value] of Object.entries({ verified: true, created_by: OTHER, agent: { email: 'fake' }, actual_transaction_price: 999, discount_rate: 40, price_basis: {} })) {
    await denied(() => create(`tamper-${key}`, AGENT, { ...base(), [key]: value }), 400);
  }
  for (const actor of [USER, SUSPENDED]) await denied(() => create('blocked', actor));
  for (const price of [-1, 0, '900000000', Infinity]) await denied(() => create('invalid', AGENT, { ...base(), price }), 400);
});

test('only staff approve; edits recompute evidence, hide the row and reject stale approvals', async () => {
  await create('workflow');
  await denied(() => change(AGENT, { action: 'verify', id: 'workflow', expectedRevision: 1, input: { verified: true } }));
  await change(ADMIN, { action: 'verify', id: 'workflow', expectedRevision: 1, input: { verified: true } });
  assert.equal((await asRole('anon', null, "select id from properties where id='workflow'")).rows.length, 1);
  await change(AGENT, { action: 'edit', id: 'workflow', expectedRevision: 2, input: { price: 800000000, floor: '12층' } });
  const p = await row('workflow');
  assert.equal(Number(p.discount_rate), 20);
  assert.equal(p.price_basis.baselinePrice, p.actual_transaction_price);
  assert.equal(p.verified, false);
  assert.equal(p.last_verified_at, null);
  assert.equal((await asRole('anon', null, "select id from properties where id='workflow'")).rows.length, 0);
  await denied(() => change(ADMIN, { action: 'verify', id: 'workflow', expectedRevision: 2, input: { verified: true } }), 409);
  await change(OWNER, { action: 'verify', id: 'workflow', expectedRevision: 3, input: { verified: true } });
});

test('contact edits preserve agent identity, need reapproval, and reject invalid numbers', async () => {
  await create('contact');
  await change(ADMIN, { action: 'verify', id: 'contact', expectedRevision: 1, input: { verified: true } });
  const identity = (await row('contact')).agent;
  await change(AGENT, { action: 'edit', id: 'contact', expectedRevision: 2, input: { contact_phone: '033-123-4567' } });
  const p = await row('contact');
  assert.deepEqual(p.agent, { ...identity, phone: '033-123-4567' });
  assert.equal(p.verified, false);
  assert.equal(p.revision, 3);
  for (const contact_phone of ['', '123', 'letters', 'javascript:12345678', null]) {
    await denied(() => change(AGENT, { action: 'edit', id: 'contact', expectedRevision: 3, input: { contact_phone } }), 400);
    await denied(() => create('invalid-contact', AGENT, { ...base(), contact_phone }), 400);
  }
  await denied(() => change(OTHER, { action: 'edit', id: 'contact', expectedRevision: 3, input: { contact_phone: '02-1234-5678' } }));
  await change(ADMIN, { action: 'verify', id: 'contact', expectedRevision: 3, input: { verified: true } });
  await change(ADMIN, { action: 'verify', id: 'contact', expectedRevision: 4, input: { verified: false } });
  assert.equal((await asRole('anon', null, "select id from properties where id='contact'")).rows.length, 0);
});

test('inquiries count only public listings and exclude staff and the immutable owner', async () => {
  await create('metrics');
  const track = async (actor, event = 'view') => (await asRole(actor ? 'authenticated' : 'anon', actor,
    "select track_property_event('metrics',$1) as tracked", [event])).rows[0].tracked;
  assert.equal(await track(null), false);
  await change(ADMIN, { action: 'verify', id: 'metrics', expectedRevision: 1, input: { verified: true } });
  for (const actor of [AGENT, ADMIN, OWNER, SUSPENDED]) assert.equal(await track(actor), false);
  const originalEmail = (await pg.query('select email from profiles where id=$1', [AGENT])).rows[0].email;
  await pg.query('update profiles set email=$1 where id=$2', ['new-email@example.test', AGENT]);
  assert.equal(await track(AGENT), false);
  await pg.query('update profiles set email=$1 where id=$2', [originalEmail, AGENT]);
  assert.equal(await track(null), true);
  assert.equal(await track(USER, 'inquiry_tel'), true);
  assert.equal(await track(null, 'inquiry_email'), true);
  assert.equal(await track(null, 'invalid'), false);
  const stats = (await asRole('authenticated', AGENT, 'select property_stats() as stats')).rows[0].stats;
  assert.equal(stats.scope, 'own');
  assert.equal(stats.listings.find(p => p.property_id === 'metrics').inquiry_tel, 1);
  assert.equal((await asRole('authenticated', OTHER, 'select property_stats() as stats')).rows[0].stats.listings.length, 0);
  await change(AGENT, { action: 'edit', id: 'metrics', expectedRevision: 2, input: { title: '수정됨' } });
  assert.equal(await track(null, 'inquiry_tel'), false);
  assert.equal((await pg.query("select views from property_daily_stats where property_id='metrics'")).rows[0].views, 1);
});

test('email changes do not transfer ownership; other users cannot edit/delete pending rows', async () => {
  await create('ownership');
  await pg.query('update profiles set email = $1 where id = $2', ['changed@example.test', AGENT]);
  await change(AGENT, { action: 'edit', id: 'ownership', expectedRevision: 1, input: { title: '수정' } });
  await denied(() => change(OTHER, { action: 'edit', id: 'ownership', expectedRevision: 2, input: { title: '도용' } }));
  assert.equal((await asRole('authenticated', OTHER, "delete from properties where id='ownership' returning id")).rows.length, 0);
  assert.equal((await asRole('authenticated', AGENT, "delete from properties where id='ownership' returning id")).rows.length, 1);
});

test('commit rechecks suspension and revision after server calculations', async () => {
  await create('race');
  const beforeCommit = (fn) => ({ ...admin, async rpc(name, args) { await fn(); return admin.rpc(name, args); } });
  await denied(() => change(AGENT, { action: 'edit', id: 'race', expectedRevision: 1, input: { price: 1 } }, beforeCommit(() => pg.query('update profiles set suspended = true where id=$1', [AGENT]))));
  assert.equal((await row('race')).price, 900000000);
  assert.equal((await asRole('authenticated', AGENT, "delete from properties where id='race' returning id")).rows.length, 0);
  await pg.query('update profiles set suspended = false where id=$1', [AGENT]);
  await denied(() => change(ADMIN, { action: 'verify', id: 'race', expectedRevision: 1, input: { verified: true } }, beforeCommit(() => pg.exec("update properties set title = '수정됨' where id='race'"))), 409);
  assert.equal((await row('race')).verified, false);
});

test('missing data stays insufficient; a DB outage must not persist as no-data', async () => {
  await create('no-data', AGENT, { ...base(), complex_name: '미등록 단지' });
  const p = await row('no-data');
  assert.equal(p.discount_rate, null);
  assert.equal(p.actual_transaction_price, null);
  assert.equal(p.price_basis.status, 'insufficient');
  const broken = { ...admin, from(table) { return table === 'complex_trades' ? { select() { return this; }, eq() { return this; }, then(resolve) { return resolve({ data: null, error: new Error('DB unavailable') }); } } : admin.from(table); } };
  await assert.rejects(() => change(AGENT, { action: 'create', id: 'db-down', input: base() }, broken), /DB unavailable/);
  assert.equal(await row('db-down'), undefined);
});

test('floor changes and approval refresh the baseline from trusted individual trades', async () => {
  const trades = [1, 2, 3, 10, 11, 12].map((floor) => ['2026-09', 1, floor < 10 ? 1000000000 : 2000000000, floor, 'b']);
  await pg.query('insert into complex_trades values($1,$2,$3,$4,$5)', ['층별단지', '서울특별시 강남구', 84, '2026-09', JSON.stringify(trades)]);
  await create('floor-change', AGENT, { ...base(), complex_name: '층별단지', floor: '3층' });
  assert.equal((await row('floor-change')).actual_transaction_price, 1000000000);
  await change(AGENT, { action: 'edit', id: 'floor-change', expectedRevision: 1, input: { floor: '12층' } });
  const edited = await row('floor-change');
  assert.equal(edited.actual_transaction_price, 2000000000);
  assert.equal(edited.price_basis.floorAdjusted, true);
  assert.equal(Number(edited.discount_rate), 55);
  const refreshed = trades.map((t) => [t[0], t[1], t[2] + 100000000, t[3], t[4]]);
  await pg.query('update complex_trades set trades=$1 where complex=$2', [JSON.stringify(refreshed), '층별단지']);
  await change(ADMIN, { action: 'verify', id: 'floor-change', expectedRevision: 2, input: { verified: true } });
  assert.equal((await row('floor-change')).actual_transaction_price, 2100000000);
});

test('legacy email is not adopted as ownership; suspended staff lose pending access', async () => {
  await create('legacy');
  await pg.exec("update properties set created_by=null where id='legacy'");
  await denied(() => change(AGENT, { action: 'edit', id: 'legacy', expectedRevision: 2, input: { title: '탈취' } }));
  assert.equal((await asRole('authenticated', AGENT, "select id from properties where id='legacy'")).rows.length, 0);
  await pg.query('update profiles set suspended=true where id=$1', [ADMIN]);
  await denied(() => change(ADMIN, { action: 'verify', id: 'legacy', expectedRevision: 2, input: { verified: true } }));
  assert.equal((await asRole('authenticated', ADMIN, "select id from properties where id='legacy'")).rows.length, 0);
  await pg.query('update profiles set suspended=false where id=$1', [ADMIN]);
});

test('media writes require own folder; public media remains readable', async () => {
  const name = `${AGENT}/private/photo-1.jpg`;
  await asRole('authenticated', AGENT, 'insert into storage.objects(bucket_id,name) values($1,$2)', ['property-photos', name]);
  assert.equal((await asRole('authenticated', OTHER, 'select * from storage.objects where name=$1', [name])).rows.length, 1);
  for (const actor of [OTHER, SUSPENDED]) {
    await assert.rejects(() => asRole('authenticated', actor, 'insert into storage.objects(bucket_id,name) values($1,$2)', ['property-photos', `${AGENT}/forged.jpg`]), (e) => e.code === '42501');
    assert.equal((await asRole('authenticated', actor, 'delete from storage.objects where name=$1 returning id', [name])).rows.length, 0);
  }
  await assert.rejects(() => asRole('authenticated', AGENT, 'update storage.objects set name=$1 where name=$2', [`${OTHER}/moved.jpg`, name]), (e) => e.code === '42501');
  await denied(() => create('bad-media', AGENT, { ...base(), media: [{ src: 'http://127.0.0.1/private' }] }), 400);
  await change(ADMIN, { action: 'verify', id: 'private', expectedRevision: 1, input: { verified: true } });
  assert.equal((await asRole('authenticated', AGENT, 'delete from storage.objects where name=$1 returning id', [name])).rows.length, 0);
  assert.equal((await asRole('authenticated', AGENT, 'update storage.objects set name=name where name=$1 returning id', [name])).rows.length, 0);
  // Editing an approved listing can still upload a new image before resubmission.
  await asRole('authenticated', AGENT, 'insert into storage.objects(bucket_id,name) values($1,$2)', ['property-photos', `${AGENT}/private/new-photo.jpg`]);
});

test('HTTP rejects invalid auth/JSON/large requests and runs a valid write', async () => {
  const handler = createPropertyWriteHandler({ admin, storageUrl, authenticate: async (req) => req.headers.get('Authorization') === 'Bearer fixture' ? { id: AGENT } : null });
  const request = (body, token = true) => new Request('https://test/property-write', { method: 'POST', headers: token ? { Authorization: 'Bearer fixture' } : {}, body });
  assert.equal((await handler(request('{}', false))).status, 401);
  assert.equal((await handler(request('invalid'))).status, 400);
  assert.equal((await handler(request('x'.repeat(262145)))).status, 413);
  const response = await handler(request(JSON.stringify({ action: 'create', id: 'http', input: base() })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verified, false);
});

test('legacy 3D storage is subject to the same owner and approval guard', async () => {
  const name = `${AGENT}/private/model.glb`;
  await asRole('authenticated', AGENT, 'insert into storage.objects(bucket_id,name) values($1,$2)', ['property-3d', name]);
  for (const actor of [OTHER, SUSPENDED, AGENT]) {
    assert.equal((await asRole('authenticated', actor, 'update storage.objects set name=name where name=$1 returning id', [name])).rows.length, 0);
    assert.equal((await asRole('authenticated', actor, 'delete from storage.objects where name=$1 returning id', [name])).rows.length, 0);
  }
  await assert.rejects(() => asRole('authenticated', OTHER, 'insert into storage.objects(bucket_id,name) values($1,$2)', ['property-3d', `${AGENT}/private/forged.glb`]), (e) => e.code === '42501');
});
