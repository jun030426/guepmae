import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { parse } from 'csv-parse/sync';
import { parseRows, normalizeRow } from './import-trades-csv.mjs';
import viteConfig from '../vite.config.js';

test('CSV headers cannot replace record prototypes or corrupt a real trade', () => {
  const csv = '__proto__,constructor,시군구,단지명,거래금액(만원),전용면적(㎡),계약년월\n' +
    'untrusted,untrusted,서울특별시 강남구 역삼동,테스트,"10,000",84.91,202609';
  const [row] = parseRows(csv);
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(Object.hasOwn(row, '__proto__'), true);
  assert.equal(row.__proto__, 'untrusted');
  assert.equal(normalizeRow(row).dealAmount, 100000000);
  // Exercise the upstream vulnerability with an object-valued column, too.
  const [castRow] = parse('__proto__,name\npayload,normal', {
    columns: true,
    cast: (value, context) => !context.header && context.column === '__proto__'
      ? { injected: true } : value,
  });
  assert.equal(Object.getPrototypeOf(castRow), Object.prototype);
  assert.equal(castRow.injected, undefined);
  assert.equal(castRow.name, 'normal');
  assert.equal(Object.hasOwn(castRow, '__proto__'), true);
});

test('development server binds locally and blocks env files including Windows alternate streams', async () => {
  // Synthetic fixture only: never request or expose the project's actual secrets.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guepmae-vite-security-'));
  const canary = 'synthetic-security-fixture-not-a-real-secret';
  let server;
  try {
    await fs.writeFile(path.join(root, 'index.html'), '<h1>Security fixture</h1>');
    await fs.writeFile(path.join(root, '.env.security-test'), canary);
    server = await createServer({
      ...viteConfig, root, configFile: false, logLevel: 'silent',
      server: { ...viteConfig.server, port: 0, watch: null },
    });
    await server.listen();
    const address = server.httpServer.address();
    assert.equal(address.address, '127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(origin)).status, 200);
    for (const pathname of ['/.env.security-test', '/.env.security-test?raw', '/.env.security-test::$DATA?raw']) {
      const response = await fetch(origin + pathname);
      assert.ok([403, 404].includes(response.status), `sensitive path must be rejected: ${pathname}`);
      assert.equal((await response.text()).includes(canary), false);
    }
  } finally {
    await server?.close();
    // Validate the exact temporary target before recursive cleanup on Windows.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('guepmae-vite-security-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
