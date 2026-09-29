import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  BUCKET,
  NoBootstrapError,
  check,
  countDataRows,
  download,
  fileNameForObject,
  hasShrunk,
  objectNameForFile,
  sidoCodeMap,
  upload,
} from './pipeline-data-sync.mjs';

const CODES = { 11110: '서울특별시 종로구', 11680: '서울특별시 강남구', 41135: '경기도 성남시 분당구', 51110: '강원특별자치도 춘천시' };

test('sidoCodeMap — 시도명 → 법정동코드 앞 2자리', () => {
  const map = sidoCodeMap(CODES);
  assert.equal(map.get('서울특별시'), '11');
  assert.equal(map.get('경기도'), '41');
  assert.equal(map.get('강원특별자치도'), '51');
  assert.equal(map.size, 3);
});

test('objectNameForFile / fileNameForObject — ASCII 키로 왕복', () => {
  const map = sidoCodeMap(CODES);
  assert.equal(objectNameForFile('api_서울특별시.csv', map), 'trades/api_11.csv.gz');
  assert.equal(fileNameForObject('trades/api_11.csv.gz', map), 'api_서울특별시.csv');
  assert.equal(fileNameForObject('api_41.csv.gz', map), 'api_경기도.csv');
  assert.equal(objectNameForFile('api_없는도.csv', map), null);
  assert.equal(objectNameForFile('강남구_수동.csv', map), null);
  assert.equal(fileNameForObject('trades/_meta.json', map), null);
  assert.equal(fileNameForObject('trades/api_99.csv.gz', map), null);
});

test('실제 시군구 코드표 — 17개 시도가 서로 다른 코드로 매핑되고 키가 ASCII 다', () => {
  const codesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_sigungu_codes.json');
  const map = sidoCodeMap(JSON.parse(fs.readFileSync(codesPath, 'utf-8')));
  assert.equal(map.size, 17);
  assert.equal(new Set(map.values()).size, 17);
  for (const sido of map.keys()) {
    const object = objectNameForFile(`api_${sido}.csv`, map);
    assert.match(object, /^trades\/api_\d{2}\.csv\.gz$/);
    assert.equal(fileNameForObject(object, map), `api_${sido}.csv`);
  }
});

test('countDataRows — 헤더 제외, CRLF·끝 개행·빈 줄 처리', () => {
  assert.equal(countDataRows(Buffer.from('h1,h2\na,b\nc,d\n')), 2);
  assert.equal(countDataRows(Buffer.from('h1,h2\r\na,b\r\nc,d')), 2);
  assert.equal(countDataRows(Buffer.from('h1,h2\n\na,b\n\n')), 1);
  assert.equal(countDataRows(Buffer.from('h1,h2\n')), 0);
  assert.equal(countDataRows(Buffer.from('')), 0);
});

test('hasShrunk — 2% 넘게 줄었을 때만', () => {
  assert.equal(hasShrunk(1000, 1000), false);
  assert.equal(hasShrunk(985, 1000), false); // 1.5% 감소는 허용
  assert.equal(hasShrunk(970, 1000), true);
  assert.equal(hasShrunk(1200, 1000), false);
  assert.equal(hasShrunk(10, 0), false); // 직전 메타 없음
});

test('gzip 왕복 — CP949 바이트가 그대로 복원된다', () => {
  const original = Buffer.from([0xbd, 0xc3, 0xb1, 0xba, 0xb1, 0xb8, 0x2c, 0x31, 0x0a]); // "시군구,1\n" (CP949)
  const restored = zlib.gunzipSync(zlib.gzipSync(original, { level: 9 }));
  assert.deepEqual(restored, original);
});

// ───────────────────────── 가짜 Storage 서버로 왕복 ─────────────────────────
// Supabase Storage REST 의 세 경로만 흉내 낸다 (목록 · 올리기 · 내려받기). 실제 버킷·키는 쓰지 않는다.

const KEY = 'test-service-role';

async function withFakeStorage(run) {
  const objects = new Map(); // 'trades/api_11.csv.gz' → Buffer
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = decodeURIComponent(req.url);
      requests.push({ method: req.method, url, upsert: req.headers['x-upsert'], type: req.headers['content-type'] });
      const send = (status, payload, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(payload);
      };
      if (req.headers.authorization !== `Bearer ${KEY}` || req.headers.apikey !== KEY) {
        return send(401, JSON.stringify({ error: 'unauthorized' }));
      }
      const listPath = `/storage/v1/object/list/${BUCKET}`;
      const objectPath = `/storage/v1/object/${BUCKET}/`;
      if (req.method === 'POST' && url === listPath) {
        const { prefix } = JSON.parse(body.toString('utf-8'));
        const rows = [...objects.entries()]
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, data]) => ({ name: name.slice(prefix.length), id: name, metadata: { size: data.length } }));
        return send(200, JSON.stringify(rows));
      }
      if (req.method === 'POST' && url.startsWith(objectPath)) {
        const name = url.slice(objectPath.length);
        if (objects.has(name) && req.headers['x-upsert'] !== 'true') {
          return send(409, JSON.stringify({ error: 'Duplicate' }));
        }
        objects.set(name, body);
        return send(200, JSON.stringify({ Key: `${BUCKET}/${name}` }));
      }
      if (req.method === 'GET' && url.startsWith(objectPath)) {
        const data = objects.get(url.slice(objectPath.length));
        if (!data) return send(400, JSON.stringify({ statusCode: '404', error: 'not_found' }));
        return send(200, data, 'application/octet-stream');
      }
      return send(404, JSON.stringify({ error: 'no route' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = { url: `http://127.0.0.1:${server.address().port}`, key: KEY };
  const dirs = [];
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geupmae-sync-'));
    dirs.push(dir);
    return dir;
  };
  const log = console.log;
  const warn = console.warn;
  const error = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    await run({ env, objects, requests, tempDir });
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
    await new Promise((resolve) => server.close(resolve));
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// CP949 바이트를 직접 만든다 (헤더 '시군구' + ASCII 열) — 디코딩 없이 바이트 그대로 다루는지 확인
const CP949_HEADER = Buffer.from([0xbd, 0xc3, 0xb1, 0xba, 0xb1, 0xb8, 0x2c, 0x61, 0x0d, 0x0a]); // "시군구,a\r\n"
function csvWithRows(n) {
  const rows = Array.from({ length: n }, (_, i) => `row${i},${i}\r\n`).join('');
  return Buffer.concat([CP949_HEADER, Buffer.from(rows, 'ascii')]);
}

test('upload → download 왕복 — 바이트 동일, 메타 기록, 모르는 파일은 건너뜀', async () => {
  await withFakeStorage(async ({ env, objects, requests, tempDir }) => {
    const map = sidoCodeMap(CODES);
    const source = tempDir();
    fs.writeFileSync(path.join(source, 'api_서울특별시.csv'), csvWithRows(120));
    fs.writeFileSync(path.join(source, 'api_경기도.csv'), csvWithRows(80));
    fs.writeFileSync(path.join(source, 'api_없는도.csv'), csvWithRows(5)); // 코드표에 없는 시도
    fs.writeFileSync(path.join(source, '강남구_수동.csv'), csvWithRows(5)); // api_ 가 아닌 파일

    const sent = await upload(env, map, source);
    assert.deepEqual(sent, { files: 2, totalRows: 200 });
    assert.deepEqual([...objects.keys()].sort(), ['trades/_meta.json', 'trades/api_11.csv.gz', 'trades/api_41.csv.gz']);
    assert.ok(requests.every((r) => /^[\x20-\x7e]+$/.test(r.url)), '요청 경로는 ASCII 만');
    assert.ok(requests.filter((r) => r.url.includes('/api_')).every((r) => r.upsert === 'true' && r.type === 'application/gzip'));

    const target = tempDir();
    const got = await download(env, map, target);
    assert.deepEqual(got, { files: 2 });
    for (const name of ['api_서울특별시.csv', 'api_경기도.csv']) {
      assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(source, name)));
    }
    assert.equal(fs.existsSync(path.join(target, 'api_없는도.csv')), false);
    const meta = JSON.parse(fs.readFileSync(path.join(target, '_meta.json'), 'utf-8'));
    // 메타에는 실제로 올린 파일만 — 건너뛴 파일이 섞이면 다음 check 가 "사라졌다"고 오인한다
    assert.equal(meta.totalRows, 200);
    assert.deepEqual(meta.perFile, { 'api_경기도.csv': 80, 'api_서울특별시.csv': 120 });
    assert.equal(check(target).ok, true);

    // 다시 올려도(덮어쓰기) 실패하지 않는다
    await upload(env, map, source);
  });
});

test('download — 버킷이 비어 있으면 NoBootstrapError, 폴더를 만들지 않는다', async () => {
  await withFakeStorage(async ({ env, tempDir }) => {
    const target = path.join(tempDir(), 'data');
    await assert.rejects(download(env, sidoCodeMap(CODES), target), NoBootstrapError);
    assert.equal(fs.existsSync(target), false);
  });
});

test('download — 버킷에 메타가 없으면 로컬의 옛 메타를 지운다', async () => {
  await withFakeStorage(async ({ env, objects, tempDir }) => {
    objects.set('trades/api_11.csv.gz', zlib.gzipSync(csvWithRows(10)));
    const target = tempDir();
    fs.writeFileSync(path.join(target, '_meta.json'), JSON.stringify({ totalRows: 999999 }));
    await download(env, sidoCodeMap(CODES), target);
    assert.equal(fs.existsSync(path.join(target, '_meta.json')), false);
    assert.deepEqual(check(target), { ok: true, current: 10, previous: null, shrunk: [] });
  });
});

test('잘못된 키 — 목록 조회에서 실패한다', async () => {
  await withFakeStorage(async ({ env, tempDir }) => {
    await assert.rejects(download({ ...env, key: 'wrong' }, sidoCodeMap(CODES), tempDir()), /목록 조회 실패 401/);
  });
});

test('check — 늘거나 그대로면 통과, 전체 또는 한 시도가 2% 넘게 줄면 중단', async () => {
  await withFakeStorage(async ({ env, tempDir }) => {
    const map = sidoCodeMap(CODES);
    const dir = tempDir();
    const seoul = path.join(dir, 'api_서울특별시.csv');
    const gyeonggi = path.join(dir, 'api_경기도.csv');
    fs.writeFileSync(seoul, csvWithRows(1000));
    fs.writeFileSync(gyeonggi, csvWithRows(100));
    await upload(env, map, dir);
    await download(env, map, dir); // 메타를 받아 둔다

    assert.deepEqual(check(dir), { ok: true, current: 1100, previous: 1100, shrunk: [] });

    fs.writeFileSync(seoul, csvWithRows(1030)); // 증분 수집으로 늘어남
    assert.equal(check(dir).ok, true);

    fs.writeFileSync(seoul, csvWithRows(990)); // 1% 감소 — 허용
    assert.equal(check(dir).ok, true);

    // 경기도가 통째로 줄었지만 전국 합계로는 2% 안쪽 (1100 → 1090)
    fs.writeFileSync(seoul, csvWithRows(1000));
    fs.writeFileSync(gyeonggi, csvWithRows(90));
    assert.deepEqual(check(dir).shrunk, ['api_경기도.csv']);

    fs.rmSync(gyeonggi); // 파일이 사라진 경우
    assert.deepEqual(check(dir).shrunk, ['전체', 'api_경기도.csv']);
  });
});
