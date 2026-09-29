// 리허설용 가짜 Supabase — Storage(목록·올리기·내려받기)와 PostgREST(행 수·삽입·upsert·삭제)의
// 스크립트가 쓰는 부분만 메모리에서 흉내 낸다. 실제 프로젝트와는 아무 연결이 없다.
// 사용: node fake-supabase.mjs <portFile> <key>
//   GET  /__state            테이블 행 수 · 객체 목록 · 쓰기 요청 기록
//   POST /__seed/<table>     행 배열을 그대로 넣는다 (중개사 등록 매물 흉내)
//   POST /__clear/<table>    테이블 비우기
//   POST /__reset-log        요청 기록 비우기
//   POST /__stop
import fs from 'node:fs';
import http from 'node:http';

const [portFile, KEY] = process.argv.slice(2);
const PRIMARY = {
  properties: ['id'],
  complex_trades: ['complex', 'gu', 'area_m2'],
  complex_prices: null, // 일련번호 id — 번들 행에는 없다
};
const tables = new Map(); // table → Map(key → row)
const objects = new Map(); // 'bucket/path' → Buffer
let log = [];
let serial = 0;

const table = (name) => {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
};
const keyOf = (name, row, cols) => {
  const pk = cols ?? PRIMARY[name];
  if (!pk) { serial += 1; return `#${serial}`; }
  return pk.map((c) => String(row[c])).join('');
};

function parseInList(value) {
  // in.("a","b") → ['a','b']
  const inner = value.replace(/^in\.\(/, '').replace(/\)$/, '');
  return [...inner.matchAll(/"([^"]*)"|([^,]+)/g)].map((m) => m[1] ?? m[2]);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    const send = (status, payload = '', headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(payload);
    };

    if (pathname === '/__state') {
      return send(200, JSON.stringify({
        tables: Object.fromEntries([...tables].map(([n, m]) => [n, m.size])),
        objects: Object.fromEntries([...objects].map(([n, b]) => [n, b.length])),
        log,
      }));
    }
    if (pathname.startsWith('/__rows/')) {
      return send(200, JSON.stringify([...table(pathname.slice(8)).values()]));
    }
    if (pathname.startsWith('/__object/')) {
      const data = objects.get(pathname.slice(10));
      return data ? send(200, data, { 'Content-Type': 'application/octet-stream' }) : send(404, '{}');
    }
    if (pathname.startsWith('/__seed/')) {
      const name = pathname.slice(8);
      for (const row of JSON.parse(body.toString('utf-8'))) table(name).set(keyOf(name, row), row);
      return send(200, '{}');
    }
    if (pathname.startsWith('/__clear/')) { table(pathname.slice(9)).clear(); return send(200, '{}'); }
    if (pathname === '/__reset-log') { log = []; return send(200, '{}'); }
    if (pathname === '/__stop') { send(200, '{}'); return server.close(); }

    if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) {
      log.push({ method: req.method, path: pathname, status: 401 });
      return send(401, JSON.stringify({ message: 'Invalid API key' }));
    }

    // ── Storage ──
    if (pathname.startsWith('/storage/v1/object/list/') && req.method === 'POST') {
      const bucket = pathname.slice('/storage/v1/object/list/'.length);
      const { prefix = '' } = JSON.parse(body.toString('utf-8'));
      const head = `${bucket}/${prefix}`;
      const rows = [...objects].filter(([n]) => n.startsWith(head))
        .map(([n, b]) => ({ name: n.slice(head.length), id: n, metadata: { size: b.length } }));
      return send(200, JSON.stringify(rows));
    }
    if (pathname.startsWith('/storage/v1/object/')) {
      const name = pathname.slice('/storage/v1/object/'.length);
      if (req.method === 'POST') {
        if (objects.has(name) && req.headers['x-upsert'] !== 'true') {
          return send(409, JSON.stringify({ error: 'Duplicate' }));
        }
        objects.set(name, body);
        log.push({ method: 'POST', path: pathname, bytes: body.length });
        return send(200, JSON.stringify({ Key: name }));
      }
      if (req.method === 'GET') {
        const data = objects.get(name);
        if (!data) return send(400, JSON.stringify({ statusCode: '404', error: 'not_found' }));
        return send(200, data, { 'Content-Type': 'application/octet-stream' });
      }
    }

    // ── PostgREST ──
    if (pathname.startsWith('/rest/v1/')) {
      const name = pathname.slice('/rest/v1/'.length);
      const rows = table(name);
      if (req.method === 'GET') {
        return send(200, '[]', { 'Content-Range': `0-0/${rows.size}` });
      }
      if (req.method === 'POST') {
        const incoming = JSON.parse(body.toString('utf-8'));
        const conflict = url.searchParams.get('on_conflict');
        const merge = /resolution=merge-duplicates/.test(req.headers.prefer ?? '');
        const cols = conflict ? conflict.split(',') : null;
        if (cols && PRIMARY[name] && cols.join() !== PRIMARY[name].join()) {
          return send(400, JSON.stringify({ message: `no unique constraint on (${conflict})` }));
        }
        const seen = new Set();
        for (const row of incoming) {
          const key = keyOf(name, row, cols);
          if (seen.has(key)) {
            // 실제 Postgres: ON CONFLICT DO UPDATE command cannot affect row a second time
            return send(500, JSON.stringify({ code: '21000', message: `duplicate key in one request: ${key}` }));
          }
          seen.add(key);
          if (rows.has(key) && !(cols && merge)) {
            return send(409, JSON.stringify({ code: '23505', message: `duplicate key ${key}` }));
          }
        }
        for (const row of incoming) rows.set(keyOf(name, row, cols), row);
        log.push({ method: 'POST', path: `${name}${url.search}`, rows: incoming.length, merge });
        return send(201, '');
      }
      if (req.method === 'DELETE') {
        const filters = [...url.searchParams];
        if (filters.length === 0) return send(400, JSON.stringify({ message: 'DELETE requires a filter' }));
        const [column, value] = filters[0];
        let removed = 0;
        if (value.startsWith('in.(')) {
          const ids = new Set(parseInList(value));
          for (const [key, row] of rows) {
            if (ids.has(String(row[column]))) { rows.delete(key); removed += 1; }
          }
        } else {
          removed = rows.size; // neq.__none__ / gte.0 — 전체 삭제 필터
          rows.clear();
        }
        log.push({ method: 'DELETE', path: `${name}?${column}=${value.slice(0, 40)}`, removed });
        return send(204, '');
      }
    }
    log.push({ method: req.method, path: pathname, status: 404 });
    return send(404, JSON.stringify({ message: 'no route' }));
  });
});

server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(portFile, String(server.address().port));
  console.log(`fake supabase on ${server.address().port}`);
});
