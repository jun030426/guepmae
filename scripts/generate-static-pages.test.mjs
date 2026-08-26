import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatKoreanPrice, escapeHtml, buildTitle, buildDescription,
  buildHeadExtra, buildRootHtml, buildSitemap, buildRobots, transformTemplate,
} from './generate-static-pages.mjs';

const P = {
  id: 'gm-test01',
  title: '테스트&단지 전용59㎡ 107동',
  address: '서울특별시 중구 테스트동',
  region: '서울특별시 중구',
  price: 222000000,
  actual_transaction_price: 365000000,
  discount_rate: 39.2,
  area: 59,
  floor: '3층',
  built_year: 2005,
  rooms: 2,
  bathrooms: 1,
  recent_transaction_date: '2026-03-01',
  last_verified_at: '2026-06-24',
  price_basis: { method: '동일 단지 59㎡ · 2023-11~2026-03 18건 중앙값' },
  price_table: {
    areaSummary: [
      { areaM2: 59, count: 18, recentPrice: 357000000, recentMonth: '2026-03', isMine: true },
    ],
  },
};

// dist/index.html 과 같은 구조의 최소 템플릿 (meta description 이 여러 줄인 점 재현)
const MINI = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="description"
      content="기본 설명"
    />
    <title>급매 | 실거래가로 증명된 급매 플랫폼</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

test('formatKoreanPrice — 억+만', () => {
  assert.equal(formatKoreanPrice(222000000), '2억 2,200만 원');
});
test('formatKoreanPrice — 억만', () => {
  assert.equal(formatKoreanPrice(200000000), '2억 원');
});
test('formatKoreanPrice — 만원만', () => {
  assert.equal(formatKoreanPrice(80000000), '8,000만 원');
});

test('escapeHtml — 5종 이스케이프', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('buildTitle — 할인율 포함', () => {
  const t = buildTitle(P);
  assert.ok(t.includes('테스트&단지 전용59㎡ 107동'));
  assert.ok(t.includes('39.2% 저렴'));
  assert.ok(t.endsWith('- 급매'));
});

test('buildDescription — 주소·가격·할인율 포함', () => {
  const d = buildDescription(P);
  assert.ok(d.includes('서울특별시 중구 테스트동'));
  assert.ok(d.includes('2억 2,200만 원'));
  assert.ok(d.includes('39.2%'));
});

test('buildHeadExtra — canonical·og·JSON-LD, </script> 안전', () => {
  const h = buildHeadExtra(P, 'https://guepmae.vercel.app/properties/gm-test01', buildDescription(P));
  assert.ok(h.includes('rel="canonical"'));
  assert.ok(h.includes('property="og:title"'));
  assert.ok(h.includes('application/ld+json'));
  assert.ok(!h.includes('</p>'));            // JSON-LD 안에 닫는 태그 원형이 없어야 함
  assert.ok(h.includes('\\u003c') || !h.includes('RealEstateListing<'));
  const json = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const parsed = JSON.parse(json.replaceAll('\\u003c', '<'));
  assert.equal(parsed['@type'], 'RealEstateListing');
  assert.equal(parsed.offers.price, 222000000);
});

test('buildRootHtml — h1·가격·산출근거·평형요약', () => {
  const r = buildRootHtml(P);
  assert.ok(r.includes('<h1>테스트&amp;단지 전용59㎡ 107동</h1>'));
  assert.ok(r.includes('2억 2,200만 원'));
  assert.ok(r.includes('중앙값'));
  assert.ok(r.includes('59㎡ · 거래 18건'));
});

test('buildSitemap — core 5 + 매물 N, lastmod', () => {
  const xml = buildSitemap([P], 'https://guepmae.vercel.app');
  assert.equal(xml.match(/<url>/g).length, 6);
  assert.ok(xml.includes('/properties/gm-test01</loc><lastmod>2026-06-24</lastmod>'));
  assert.ok(xml.includes('<loc>https://guepmae.vercel.app/</loc>'));
});

test('buildRobots — admin·agent 하위 차단 + sitemap', () => {
  const r = buildRobots('https://guepmae.vercel.app');
  assert.ok(r.includes('Disallow: /admin'));
  assert.ok(r.includes('Disallow: /agent/'));
  assert.ok(r.includes('Sitemap: https://guepmae.vercel.app/sitemap.xml'));
});

test('transformTemplate — 4개 치환 성공', () => {
  const html = transformTemplate(MINI, {
    title: buildTitle(P),
    description: buildDescription(P),
    headExtra: buildHeadExtra(P, 'https://guepmae.vercel.app/properties/gm-test01', buildDescription(P)),
    rootHtml: buildRootHtml(P),
  });
  assert.ok(!html.includes('급매 | 실거래가로 증명된 급매 플랫폼'));
  assert.ok(html.includes('39.2% 저렴'));
  assert.ok(!html.includes('기본 설명'));
  assert.ok(html.includes('<div id="root"><article>'));
  assert.ok(html.includes('rel="canonical"'));
});

test('transformTemplate — root div 없으면 throw', () => {
  assert.throws(
    () => transformTemplate('<html><head><title>x</title><meta name="description" content="y"/></head></html>', {
      title: 't', description: 'd', headExtra: '', rootHtml: '<p>r</p>',
    }),
    /root/,
  );
});
