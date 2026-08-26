/*
 * dataClient.js — 데이터 어댑터 (로컬 모드 + 하이브리드 모드).
 *
 * 서비스 코드는 `db.from(...)` / `db.auth.*` / `db.storage.*` 만 호출하고
 * 어떤 모드인지 모른다. 모드는 이 파일 한 곳에서만 결정된다.
 *
 * [로컬 모드]  (기본 — env 없이 clone → npm run dev 만으로 전체 앱 동작)
 *   - 읽기: public/data/*.json 번들
 *   - 쓰기·인증: 브라우저 localStorage (mock)
 *
 * [하이브리드 모드]  (VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY 설정 시)
 *   - 매물·시세·리포트 읽기: 번들 그대로 + Supabase 매물 오버레이(신규·수정분, id 충돌 시 Supabase 우선)
 *   - 인증(가입·로그인·세션)과 쓰기(매물 등록·중개사 신청·회원 관리): 실제 Supabase
 *   - Supabase 접속 실패(무료 티어 슬립 등): 읽기는 번들만으로 정상 동작, 쓰기는 오류 반환
 */

const SUPA_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPA_KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
export const isHybrid = Boolean(SUPA_URL && SUPA_KEY);

// ── 실제 Supabase 클라이언트 (하이브리드 전용, 동적 로드 — 로컬 모드 번들 불변) ──
let _supaPromise = null;
function supa() {
  if (!isHybrid) return Promise.resolve(null);
  if (!_supaPromise) {
    _supaPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(SUPA_URL, SUPA_KEY))
      .catch(() => null);
  }
  return _supaPromise;
}
if (isHybrid) supa(); // 앱 부팅과 병렬로 미리 로드

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

// ───────────────────────── localStorage 헬퍼 (로컬 모드) ─────────────────────────
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

// 데모 계정 시드 (로컬 모드 최초 1회) — 로그인해서 중개사/운영 포털 체험용
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

// ───────────────────────── 하이브리드: Supabase 매물 오버레이 캐시 ─────────────────────────
const REMOTE_PROPS_TTL = 60 * 1000;
let _remoteProps = null; // { at, promise }
function remotePropertiesRows() {
  const now = Date.now();
  if (_remoteProps && now - _remoteProps.at < REMOTE_PROPS_TTL) return _remoteProps.promise;
  const promise = supa()
    .then((c) => (c ? c.from('properties').select('*') : { data: null }))
    .then(({ data }) => data || [])
    .catch(() => []);
  _remoteProps = { at: now, promise };
  return promise;
}
function invalidateRemoteProperties() { _remoteProps = null; }

// 번들 + Supabase 병합: id 충돌 시 Supabase 행이 이김 (수정분 반영), 신규 행은 앞에.
async function hybridPropertiesRows() {
  const [base, remote] = await Promise.all([bundle('properties'), remotePropertiesRows()]);
  const baseRows = base || [];
  if (!remote.length) return baseRows;
  const remoteIds = new Set(remote.map((r) => r.id));
  const bundleOnly = baseRows.filter((r) => !remoteIds.has(r.id));
  const bundleIds = new Set(baseRows.map((r) => r.id));
  const remoteNew = remote.filter((r) => !bundleIds.has(r.id));
  const remoteKnown = remote.filter((r) => bundleIds.has(r.id));
  return [...remoteNew, ...remoteKnown, ...bundleOnly];
}

// ───────────────────────── 테이블 → 행 배열 (읽기) ─────────────────────────
async function tableRows(table) {
  switch (table) {
    case 'properties': {
      if (isHybrid) return hybridPropertiesRows();
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
    case 'price_trends': return []; // 시계열 미번들 (신규 등록 매물은 빈 추이)
    default: return [];
  }
}

// 하이브리드에서 통째로 Supabase 에 위임하는 테이블 (인증·운영 데이터)
const REMOTE_TABLES = new Set(['profiles', 'agent_applications', 'seller_verifications']);

// ───────────────────────── 쿼리 빌더 (thenable) ─────────────────────────
const BUILDER_METHODS = [
  'select', 'eq', 'in', 'gte', 'lte', 'ilike', 'order', 'limit',
  'single', 'maybeSingle', 'insert', 'update', 'delete', 'upsert',
];

// 하이브리드: 호출 체인을 기록해 두었다가 실제 Supabase 빌더에 재생.
function remoteFrom(table, { onMutate } = {}) {
  const calls = [];
  let hasMutation = false;
  const builder = {
    then(resolve, reject) {
      return supa()
        .then((c) => {
          if (!c) return { data: null, error: { message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' } };
          let q = c.from(table);
          for (const [m, args] of calls) q = q[m](...args);
          return q;
        })
        .then((result) => {
          if (hasMutation && !result?.error && onMutate) onMutate();
          return result;
        })
        .then(resolve, reject);
    },
  };
  for (const m of BUILDER_METHODS) {
    builder[m] = (...args) => {
      if (m === 'insert' || m === 'update' || m === 'delete' || m === 'upsert') hasMutation = true;
      calls.push([m, args]);
      return builder;
    };
  }
  return builder;
}

// 로컬(및 하이브리드 번들 읽기): 미니 쿼리 엔진
function localFrom(table) {
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

// 하이브리드 properties: 읽기는 로컬 엔진(번들+오버레이 병합) / 쓰기는 Supabase.
// 첫 mutation 메서드 호출 시점에 원격 빌더로 전환하고 이전 체인을 재생한다.
function hybridPropertiesFrom() {
  const replay = [];
  let target = null; // null = 아직 읽기 경로(로컬 엔진)
  const local = localFrom('properties');

  const builder = {
    then(resolve, reject) {
      return (target ?? local).then(resolve, reject);
    },
  };
  for (const m of BUILDER_METHODS) {
    builder[m] = (...args) => {
      if (target) { target[m](...args); return builder; }
      if (m === 'insert' || m === 'update' || m === 'delete' || m === 'upsert') {
        target = remoteFrom('properties', { onMutate: invalidateRemoteProperties });
        for (const [pm, pargs] of replay) target[pm](...pargs);
        target[m](...args);
        return builder;
      }
      replay.push([m, args]);
      local[m](...args);
      return builder;
    };
  }
  return builder;
}

function from(table) {
  if (isHybrid && REMOTE_TABLES.has(table)) return remoteFrom(table);
  if (isHybrid && table === 'properties') return hybridPropertiesFrom();
  return localFrom(table);
}

// ───────────────────────── Auth ─────────────────────────
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

const CONNECT_FAIL = { message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' };

// 하이브리드: 실 Supabase auth 에 위임. 클라이언트 로드 실패 시 읽기성 호출은
// 빈 세션, 쓰기성 호출은 오류를 돌려줘 앱이 읽기 전용으로 살아있게 한다.
const hybridAuth = {
  async getSession() {
    const c = await supa();
    return c ? c.auth.getSession() : { data: { session: null }, error: null };
  },
  onAuthStateChange(cb) {
    let real = null;
    let dead = false;
    supa().then((c) => {
      if (!c || dead) return;
      const { data } = c.auth.onAuthStateChange(cb);
      real = data.subscription;
    });
    return { data: { subscription: { unsubscribe() { dead = true; real?.unsubscribe(); } } } };
  },
  async signInWithPassword(creds) {
    const c = await supa();
    return c ? c.auth.signInWithPassword(creds) : { data: {}, error: CONNECT_FAIL };
  },
  async signUp(payload) {
    const c = await supa();
    return c ? c.auth.signUp(payload) : { data: {}, error: CONNECT_FAIL };
  },
  async verifyOtp(payload) {
    const c = await supa();
    return c ? c.auth.verifyOtp(payload) : { data: {}, error: CONNECT_FAIL };
  },
  async resend(payload) {
    const c = await supa();
    return c ? c.auth.resend(payload) : { error: CONNECT_FAIL };
  },
  async resetPasswordForEmail(email, opts) {
    const c = await supa();
    return c ? c.auth.resetPasswordForEmail(email, opts) : { error: CONNECT_FAIL };
  },
  async updateUser(attrs) {
    const c = await supa();
    return c ? c.auth.updateUser(attrs) : { data: { user: null }, error: CONNECT_FAIL };
  },
  async signInWithOAuth(payload) {
    const c = await supa();
    return c ? c.auth.signInWithOAuth(payload) : { error: CONNECT_FAIL };
  },
  async signOut() {
    const c = await supa();
    return c ? c.auth.signOut() : { error: null };
  },
};

const localAuth = {
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

const auth = isHybrid ? hybridAuth : localAuth;

// ───────────────────────── Storage ─────────────────────────
const hybridStorage = {
  from(bucketName) {
    return {
      async upload(path, file, opts) {
        const c = await supa();
        if (!c) return { data: null, error: CONNECT_FAIL };
        return c.storage.from(bucketName).upload(path, file, opts);
      },
      // supabase-js 와 동일한 공개 URL 형식을 동기적으로 구성 (클라이언트 로드 불필요)
      getPublicUrl(path) {
        return { data: { publicUrl: `${SUPA_URL}/storage/v1/object/public/${bucketName}/${path}` } };
      },
      async createSignedUrl(path, expiresIn) {
        const c = await supa();
        if (!c) return { data: { signedUrl: '' }, error: CONNECT_FAIL };
        return c.storage.from(bucketName).createSignedUrl(path, expiresIn);
      },
    };
  },
};

const localStorageMock = {
  from() {
    return {
      async upload() { return { data: { path: '' }, error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: path } }; },
      // 로컬 모드: 서명 URL 개념 없음 — 신청서 첨부 문서 보기는 비활성(빈 URL).
      async createSignedUrl() { return { data: { signedUrl: '' }, error: null }; },
    };
  },
};

const storage = isHybrid ? hybridStorage : localStorageMock;

export const db = { from, auth, storage };
