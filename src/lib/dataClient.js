/*
 * dataClient.js — 로컬 데이터 어댑터 (백엔드 없이 동작).
 *
 * 이 프로젝트는 원래 Supabase(Postgres + Auth + Storage)에 의존했으나,
 * 백엔드 없이 누구나 clone → `npm run dev` 로 전체 앱이 작동하도록 로컬 모드로 전환됨.
 *
 * - 읽기 데이터: public/data/*.json 번들 (국토부 실거래가로 만든 매물·시세 스냅샷)
 * - 쓰기(매물 등록/수정/삭제·중개사 신청·유저·인증): 브라우저 localStorage
 * - 기존 코드가 `db.from(...).select()...` / `db.auth.*` 를 그대로 호출할 수 있도록
 *   Supabase 클라이언트 인터페이스의 사용 부분만 모방.
 */

// ───────────────────────── 번들 로더 (public/data/*.json) ─────────────────────────
const _bundleCache = {};
async function bundle(name) {
  if (name in _bundleCache) return _bundleCache[name];
  try {
    const res = await fetch(`/data/${name}.json`);
    _bundleCache[name] = res.ok ? await res.json() : null;
  } catch {
    _bundleCache[name] = null;
  }
  return _bundleCache[name];
}

// ───────────────────────── localStorage 헬퍼 ─────────────────────────
const LS = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const setLS = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
};

const K_PROPS = 'geupmae:properties';   // { created:[row], edits:{id:patch}, deleted:[id] }
const K_APPS = 'geupmae:applications';  // [application]
const K_USERS = 'geupmae:users';        // [profile]
const K_SESSION = 'geupmae:session';    // { user, ... } | null

const propsOverlay = () => LS(K_PROPS, { created: [], edits: {}, deleted: [] });

// 데모 계정 시드 (최초 1회) — 로그인해서 중개사/운영 포털 체험용
function seedUsers() {
  let users = LS(K_USERS, null);
  if (users) return users;
  users = [
    { id: 'owner-demo', email: 'owner@geupmae.local', full_name: '대표 데모', role: 'owner', phone: '', favorite_region: '', suspended: false, created_at: '2026-01-01T00:00:00Z' },
    { id: 'agent-demo', email: 'agent@geupmae.local', full_name: '중개사 데모', role: 'agent', phone: '', favorite_region: '', suspended: false, created_at: '2026-01-01T00:00:00Z' },
  ];
  setLS(K_USERS, users);
  return users;
}

// ───────────────────────── 테이블 → 행 배열 ─────────────────────────
async function tableRows(table) {
  switch (table) {
    case 'properties': {
      const base = (await bundle('properties')) || [];
      const ov = propsOverlay();
      return [...ov.created, ...base]
        .filter((p) => !ov.deleted.includes(p.id))
        .map((p) => (ov.edits[p.id] ? { ...p, ...ov.edits[p.id] } : p));
    }
    case 'property_reports': return (await bundle('property_reports')) || [];
    case 'complex_prices': return (await bundle('complex_prices')) || [];
    case 'ai_market_reports': return (await bundle('ai_market_reports')) || [];
    case 'market_snapshots': {
      const obj = (await bundle('market_snapshots')) || {};
      return Object.entries(obj).map(([key, data]) => ({ key, data }));
    }
    case 'agent_applications': return LS(K_APPS, []);
    case 'profiles': return seedUsers();
    case 'price_trends': return []; // 로컬: 시계열 미번들 (신규 등록 매물은 빈 추이)
    default: return [];
  }
}

// ───────────────────────── 쿼리 빌더 (thenable) ─────────────────────────
function from(table) {
  const filters = [];
  let _order = null;
  let _limit = null;
  let _single = 0; // 0=list, 1=single, 2=maybeSingle
  let _mutation = null; // { type, payload }

  const builder = {
    select() { return builder; },
    eq(col, val) { filters.push((r) => r[col] === val); return builder; },
    in(col, vals) { filters.push((r) => vals.includes(r[col])); return builder; },
    gte(col, val) { filters.push((r) => r[col] >= val); return builder; },
    lte(col, val) { filters.push((r) => r[col] <= val); return builder; },
    ilike(col, pat) {
      const needle = String(pat).replace(/%/g, '').toLowerCase();
      filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle));
      return builder;
    },
    order(col, opts) { _order = { col, asc: opts?.ascending !== false }; return builder; },
    limit(n) { _limit = n; return builder; },
    single() { _single = 1; return builder; },
    maybeSingle() { _single = 2; return builder; },
    insert(payload) { _mutation = { type: 'insert', payload }; return builder; },
    update(payload) { _mutation = { type: 'update', payload }; return builder; },
    delete() { _mutation = { type: 'delete' }; return builder; },
    upsert(payload) { _mutation = { type: 'upsert', payload }; return builder; },
    then(resolve, reject) { return exec().then(resolve, reject); },
  };

  async function exec() {
    try {
      if (_mutation) return await execMutation();
      let rows = (await tableRows(table)).filter((r) => filters.every((f) => f(r)));
      if (_order) {
        rows = [...rows].sort((a, b) => {
          const x = a[_order.col], y = b[_order.col];
          const c = x < y ? -1 : x > y ? 1 : 0;
          return _order.asc ? c : -c;
        });
      }
      if (_limit != null) rows = rows.slice(0, _limit);
      if (_single) return { data: rows[0] ?? null, error: _single === 1 && !rows[0] ? { message: 'No rows' } : null };
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async function execMutation() {
    const list = Array.isArray(_mutation.payload) ? _mutation.payload : [_mutation.payload];
    if (table === 'properties') {
      const ov = propsOverlay();
      if (_mutation.type === 'insert' || _mutation.type === 'upsert') {
        list.forEach((row) => { ov.created.unshift(row); });
        setLS(K_PROPS, ov);
        return { data: list.map((r) => ({ id: r.id })), error: null };
      }
      if (_mutation.type === 'update') {
        const targets = (await tableRows('properties')).filter((r) => filters.every((f) => f(r)));
        targets.forEach((t) => { ov.edits[t.id] = { ...(ov.edits[t.id] || {}), ..._mutation.payload }; });
        setLS(K_PROPS, ov);
        return { data: targets.map((t) => ({ id: t.id })), error: null };
      }
      if (_mutation.type === 'delete') {
        const targets = (await tableRows('properties')).filter((r) => filters.every((f) => f(r)));
        targets.forEach((t) => { ov.deleted.push(t.id); });
        setLS(K_PROPS, ov);
        return { data: targets.map((t) => ({ id: t.id })), error: null };
      }
    }
    if (table === 'agent_applications') {
      const apps = LS(K_APPS, []);
      if (_mutation.type === 'insert') {
        list.forEach((a) => apps.unshift({ id: `app-${Date.now()}-${apps.length}`, status: 'pending', created_at: new Date().toISOString(), ...a }));
        setLS(K_APPS, apps); return { data: null, error: null };
      }
      if (_mutation.type === 'update') {
        const next = apps.map((a) => (filters.every((f) => f(a)) ? { ...a, ..._mutation.payload } : a));
        setLS(K_APPS, next); return { data: null, error: null };
      }
    }
    if (table === 'profiles') {
      const users = seedUsers();
      if (_mutation.type === 'update') {
        const next = users.map((u) => (filters.every((f) => f(u)) ? { ...u, ..._mutation.payload } : u));
        setLS(K_USERS, next); return { data: null, error: null };
      }
    }
    return { data: null, error: null };
  }

  return builder;
}

// ───────────────────────── Auth (mock) ─────────────────────────
let _authCb = null;
function roleFor(email) {
  const e = String(email || '').toLowerCase();
  if (e.includes('owner')) return 'owner';
  if (e.includes('admin')) return 'admin';
  if (e.includes('agent')) return 'agent';
  return 'user';
}
function findOrCreateUser(email, meta = {}) {
  const users = seedUsers();
  let u = users.find((x) => x.email === email);
  if (!u) {
    u = {
      id: `u-${Date.now()}`,
      email,
      full_name: meta.full_name || String(email).split('@')[0],
      phone: meta.phone || '',
      role: meta.requested_role && meta.requested_role !== 'user' ? meta.requested_role : roleFor(email),
      favorite_region: meta.favorite_region || '',
      suspended: false,
      created_at: new Date().toISOString(),
    };
    users.unshift(u);
    setLS(K_USERS, users);
  }
  return u;
}
function makeSession(user) {
  const session = { user: { id: user.id, email: user.email }, access_token: 'local', expires_at: 9999999999 };
  setLS(K_SESSION, session);
  if (_authCb) setTimeout(() => _authCb('SIGNED_IN', session), 0);
  return session;
}

const auth = {
  async getSession() { return { data: { session: LS(K_SESSION, null) }, error: null }; },
  onAuthStateChange(cb) {
    _authCb = cb;
    return { data: { subscription: { unsubscribe() { _authCb = null; } } } };
  },
  async signInWithPassword({ email }) {
    const user = findOrCreateUser(email);
    return { data: { session: makeSession(user), user: { id: user.id, email } }, error: null };
  },
  async signUp({ email, options }) {
    const user = findOrCreateUser(email, options?.data || {});
    return { data: { session: makeSession(user), user: { id: user.id, email } }, error: null };
  },
  async verifyOtp({ email }) {
    const user = findOrCreateUser(email);
    return { data: { session: makeSession(user), user: { id: user.id, email } }, error: null };
  },
  async resend() { return { error: null }; },
  async resetPasswordForEmail() { return { error: null }; },
  async updateUser() {
    const session = LS(K_SESSION, null);
    return { data: { user: session?.user ?? null }, error: null };
  },
  async signInWithOAuth() {
    return { error: { message: '로컬 데모 모드에서는 소셜 로그인이 비활성화되어 있습니다. 이메일로 로그인해주세요.' } };
  },
  async signOut() {
    localStorage.removeItem(K_SESSION);
    if (_authCb) setTimeout(() => _authCb('SIGNED_OUT', null), 0);
    return { error: null };
  },
};

// ───────────────────────── Storage (mock) ─────────────────────────
const storage = {
  from() {
    return {
      async upload() { return { data: { path: '' }, error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: path } }; },
      // 로컬 모드: 서명 URL 개념 없음 — 신청서 첨부 문서 보기는 비활성(빈 URL).
      async createSignedUrl() { return { data: { signedUrl: '' }, error: null }; },
    };
  },
};

export const db = { from, auth, storage };
