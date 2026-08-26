# 검색 유입 기반 구축(정적 페이지 생성) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매물 395건 각각에 고유 title·meta·JSON-LD·크롤러용 본문을 가진 정적 HTML 페이지와 sitemap.xml·robots.txt를 빌드 산출물(`dist/`)에 생성해, 검색엔진이 사이트를 1페이지가 아닌 400페이지로 색인하게 한다.

**Architecture:** 빌드 후처리 스크립트(B1안). `vite build`가 만든 `dist/index.html`을 템플릿 삼아 `public/data/properties.json`의 매물별로 head/root를 치환한 사본을 `dist/properties/<id>/index.html`로 쓴다. 앱 코드(`src/`)는 건드리지 않는다 — `main.jsx`가 `createRoot()`(hydrateRoot 아님)라 `#root` 초기 HTML은 React가 그대로 교체한다.

**Tech Stack:** Node 내장 모듈만 (`node:fs`, `node:path`, `node:url`, `node:test`, `node:assert`). 신규 의존성 0.

## Global Constraints

- 사이트 origin: `https://guepmae.vercel.app` (스크립트에서 `process.env.SITE_ORIGIN`으로 override 가능)
- 신규 npm 의존성 추가 금지 — Node 내장 모듈만 사용
- `src/` 아래 앱 코드 수정 금지 (스펙 §4 "앱 코드 무변경")
- 가격 데이터 단위는 **원** (예: `222000000` = 2억 2,200만 원)
- 매물 id 형식: `^[a-z0-9-]+$` (395건 전수 확인 완료, 중복 0)
- OG 이미지는 넣지 않는다 (스펙 §6 — 호갱노노 핫링크 회피)
- robots.txt: `/admin`, `/agent/` 하위는 Disallow, `/agent` 랜딩 자체는 색인 허용 (sitemap 포함)
- 완료 판정은 스펙 §5의 6개 검증 기준을 **배포된 URL**에서 만족할 때

---

### Task 1: 생성기 순수 함수 + 테스트

**Files:**
- Create: `scripts/generate-static-pages.mjs` (순수 함수 부분)
- Test: `scripts/generate-static-pages.test.mjs`

**Interfaces:**
- Produces (Task 2가 사용):
  - `formatKoreanPrice(won: number): string` — `222000000` → `'2억 2,200만 원'`
  - `escapeHtml(s: unknown): string`
  - `buildTitle(p): string` — `'{p.title} | 시세 대비 {p.discount_rate}% 저렴 - 급매'`
  - `buildDescription(p): string`
  - `buildHeadExtra(p, url: string, description: string): string` — canonical+OG+JSON-LD 블록
  - `buildRootHtml(p): string`
  - `buildSitemap(properties: Array, origin: string): string`
  - `buildRobots(origin: string): string`
  - `transformTemplate(template: string, page: {title, description, headExtra, rootHtml}): string` — 4개 치환, 치환 실패 시 throw

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/generate-static-pages.test.mjs`:

```js
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
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && node --test scripts/generate-static-pages.test.mjs`
Expected: FAIL — `Cannot find module ... generate-static-pages.mjs`

- [ ] **Step 3: 순수 함수 구현**

`scripts/generate-static-pages.mjs`:

```js
#!/usr/bin/env node
/*
 * generate-static-pages.mjs — 빌드 후처리: 매물별 정적 HTML + sitemap + robots 생성.
 *
 * vite build 가 만든 dist/index.html 을 템플릿으로, public/data/properties.json 의
 * 매물마다 title/description/canonical/OG/JSON-LD/#root 초기 HTML 을 치환한 사본을
 * dist/properties/<id>/index.html 로 쓴다. (설계: docs/superpowers/specs/2026-08-26-*)
 *
 * 앱은 createRoot() 라 #root 초기 HTML 은 렌더 시 그대로 교체된다 — 크롤러 전용.
 *
 * 사용: npm run build  (vite build && node scripts/generate-static-pages.mjs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ORIGIN = process.env.SITE_ORIGIN || 'https://guepmae.vercel.app';

export function formatKoreanPrice(won) {
  const n = Math.round(Number(won) || 0);
  const eok = Math.floor(n / 100_000_000);
  const man = Math.round((n % 100_000_000) / 10_000);
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString('ko-KR')}만 원`;
  if (eok > 0) return `${eok}억 원`;
  return `${man.toLocaleString('ko-KR')}만 원`;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildTitle(p) {
  return `${p.title} | 시세 대비 ${p.discount_rate}% 저렴 - 급매`;
}

export function buildDescription(p) {
  return [
    p.address,
    `매도가 ${formatKoreanPrice(p.price)}`,
    `기준 실거래가 ${formatKoreanPrice(p.actual_transaction_price)}`,
    `할인율 ${p.discount_rate}%`,
    p.recent_transaction_date ? `최근 실거래 ${p.recent_transaction_date}` : null,
  ].filter(Boolean).join(' · ');
}

function buildJsonLd(p, url, description) {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: p.title,
    url,
    description,
    datePosted: p.last_verified_at || undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.address,
      addressLocality: p.region,
      addressCountry: 'KR',
    },
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: 'KRW',
      availability: 'https://schema.org/InStock',
    },
  };
}

export function buildHeadExtra(p, url, description) {
  const t = escapeHtml(buildTitle(p));
  const d = escapeHtml(description);
  // JSON-LD 안의 '<' 를 \u003c 로 바꿔 </script> 조기 종료를 막는다.
  const jsonLd = JSON.stringify(buildJsonLd(p, url, description)).replace(/</g, '\\u003c');
  return [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n    ');
}

export function buildRootHtml(p) {
  const rows = [
    ['매도가', formatKoreanPrice(p.price)],
    ['기준 실거래가', formatKoreanPrice(p.actual_transaction_price)],
    ['할인율', `${p.discount_rate}%`],
    ['전용면적', p.area != null ? `${p.area}㎡` : null],
    ['층', p.floor],
    ['준공연도', p.built_year ? `${p.built_year}년` : null],
    ['방/욕실', p.rooms != null ? `${p.rooms}개 / ${p.bathrooms}개` : null],
    ['산출 근거', p.price_basis?.method],
  ].filter(([, v]) => v != null && v !== '');
  const dl = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
  const summary = (p.price_table?.areaSummary ?? [])
    .map((a) => `<li>${escapeHtml(`${a.areaM2}㎡ · 거래 ${a.count}건 · 최근 ${formatKoreanPrice(a.recentPrice)} (${a.recentMonth})`)}</li>`)
    .join('');
  return (
    `<article><h1>${escapeHtml(p.title)}</h1>` +
    `<p>${escapeHtml(p.address)}</p>` +
    `<dl>${dl}</dl>` +
    (summary ? `<h2>평형별 실거래 요약</h2><ul>${summary}</ul>` : '') +
    `<p><a href="/">급매 홈으로</a></p></article>`
  );
}

export function buildSitemap(properties, origin) {
  const core = ['/', '/properties', '/map', '/report', '/agent'];
  const urls = [
    ...core.map((p) => ({ loc: origin + p, lastmod: null })),
    ...properties.map((p) => ({
      loc: `${origin}/properties/${p.id}`,
      lastmod: p.last_verified_at || p.recent_transaction_date || null,
    })),
  ];
  const body = urls
    .map(({ loc, lastmod }) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildRobots(origin) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /agent/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export function transformTemplate(template, page) {
  let html = template;
  const replaceOnce = (re, replacement, label) => {
    const next = html.replace(re, replacement);
    if (next === html) throw new Error(`template replacement failed: ${label}`);
    html = next;
  };
  replaceOnce(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)}</title>`, 'title');
  replaceOnce(
    /<meta\s+name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    'description',
  );
  if (page.headExtra) {
    replaceOnce(/<\/head>/, `${page.headExtra}\n  </head>`, 'headExtra');
  }
  replaceOnce(/<div id="root"><\/div>/, `<div id="root">${page.rootHtml}</div>`, 'root');
  return html;
}
```

(main 함수는 Task 2에서 같은 파일에 추가한다.)

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && node --test scripts/generate-static-pages.test.mjs`
Expected: `# pass 12` / `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && git add scripts/generate-static-pages.mjs scripts/generate-static-pages.test.mjs && git commit -m "feat(seo): 정적 페이지 생성기 순수 함수 + node:test 테스트

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: main() 연결 + 빌드 체인

**Files:**
- Modify: `scripts/generate-static-pages.mjs` (파일 끝에 main 추가)
- Modify: `package.json` (`scripts.build`)

**Interfaces:**
- Consumes: Task 1의 모든 export
- Produces: `npm run build` 실행 시 `dist/properties/<id>/index.html` ×395, `dist/sitemap.xml`, `dist/robots.txt`

- [ ] **Step 1: main 구현 — 파일 끝에 추가**

```js
function main() {
  const dist = path.join(ROOT, 'dist');
  const templatePath = path.join(dist, 'index.html');
  if (!fs.existsSync(templatePath)) {
    throw new Error('dist/index.html 이 없습니다. 먼저 vite build 를 실행하세요.');
  }
  const template = fs.readFileSync(templatePath, 'utf-8');
  const properties = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'data', 'properties.json'), 'utf-8'),
  );

  let written = 0;
  for (const p of properties) {
    if (!p?.id || !/^[a-z0-9-]+$/.test(p.id)) throw new Error(`잘못된 매물 id: ${p?.id}`);
    if (!p.title || p.price == null) throw new Error(`필수 필드 누락: ${p.id}`);
    const url = `${ORIGIN}/properties/${p.id}`;
    const description = buildDescription(p);
    const html = transformTemplate(template, {
      title: buildTitle(p),
      description,
      headExtra: buildHeadExtra(p, url, description),
      rootHtml: buildRootHtml(p),
    });
    const dir = path.join(dist, 'properties', p.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
    written += 1;
  }

  fs.writeFileSync(path.join(dist, 'sitemap.xml'), buildSitemap(properties, ORIGIN), 'utf-8');
  fs.writeFileSync(path.join(dist, 'robots.txt'), buildRobots(ORIGIN), 'utf-8');
  console.log(`정적 매물 페이지 ${written}건 + sitemap.xml(${written + 5} URL) + robots.txt 생성 완료`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error('실패:', err.message);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 2: 테스트 재실행 — import 부작용 없음 확인**

Run: `cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && node --test scripts/generate-static-pages.test.mjs`
Expected: `# pass 12` / `# fail 0` — 그리고 "생성 완료" 로그가 **없어야** 함 (isMain 가드 검증)

- [ ] **Step 3: package.json 빌드 체인 수정**

`"build": "vite build"` → 아래로 변경:

```json
"build": "vite build && node scripts/generate-static-pages.mjs"
```

- [ ] **Step 4: 전체 빌드 실행 + 산출물 검증**

Run: `cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && npm run build`
Expected: vite 빌드 후 `정적 매물 페이지 395건 + sitemap.xml(400 URL) + robots.txt 생성 완료`

Run: `ls dist/properties | wc -l` → Expected: `395`
Run: `grep -o "<title>[^<]*" dist/properties/gm-1b04c45e43/index.html` → Expected: `<title>두산위브&amp;수자인부평더퍼스트 전용59㎡ 107동 | 시세 대비 39.2% 저렴 - 급매`
Run: `grep -c "<url>" dist/sitemap.xml` → Expected: `400`
Run: `grep "application/ld+json" dist/properties/gm-1b04c45e43/index.html | head -c 120` → Expected: JSON-LD script 태그 존재

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && git add scripts/generate-static-pages.mjs package.json && git commit -m "feat(seo): 빌드 체인에 정적 페이지 생성 연결 — 매물 395 + sitemap + robots

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 로컬 프리뷰 검증 → 배포 → 스펙 §5 검증

**Files:**
- (조건부) Modify: `vercel.json` — 배포 검증 실패 시에만

**Interfaces:**
- Consumes: Task 2의 빌드 산출물
- Produces: 배포된 URL에서 스펙 §5 검증 기준 6항목 충족

- [ ] **Step 1: 로컬 프리뷰로 정적 파일 서빙 확인**

Run (백그라운드): `cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && npx vite preview --port 4173`
Run: `curl -s http://localhost:4173/properties/gm-1b04c45e43/ | grep -o "39.2% 저렴" | head -1`
Expected: `39.2% 저렴` (정적 파일이 SPA 폴백보다 우선 서빙됨)
Run: `curl -s http://localhost:4173/sitemap.xml | grep -c "<url>"` → Expected: `400`
확인 후 프리뷰 서버 종료.

- [ ] **Step 2: push (자동 배포 트리거)**

```bash
cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && git push origin main
```

Vercel이 저장소 연동으로 자동 빌드·배포한다 (`npm run build` 실행 → 생성기 포함).

- [ ] **Step 3: 배포 완료 대기 후 스펙 §5 검증 (배포 URL 기준)**

1. `curl -s https://guepmae.vercel.app/properties/gm-1b04c45e43 | grep "39.2% 저렴"` → 매물명·가격 포함 HTML (JS 미실행)
2. 서로 다른 매물 3건 title 비교:
   `for id in <매물id 3개>; do curl -s https://guepmae.vercel.app/properties/$id | grep -o "<title>[^<]*"; done` → 3개 모두 다름
3. `curl -s https://guepmae.vercel.app/sitemap.xml | grep -c "<url>"` → `400`
4. `curl -s -o /dev/null -w "%{http_code}" https://guepmae.vercel.app/robots.txt` → `200`
5. Google Rich Results Test (https://search.google.com/test/rich-results) 에 매물 URL 입력 → JSON-LD 오류 없음 (사용자 브라우저 확인 항목)
6. 기존 SPA 회귀 확인 — 배포 URL에서 홈/매물/지도/상세/리포트 렌더 + 콘솔 오류 0건 (브라우저 도구로 확인)

- [ ] **Step 4 (조건부): 검증 1이 실패하면 — rewrite가 정적 파일을 덮는 경우**

`vercel.json`을 filesystem-우선 명시 라우팅으로 교체:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

커밋·push 후 Step 3 재검증:

```bash
cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && git add vercel.json && git commit -m "fix(deploy): filesystem 우선 라우팅 — 정적 매물 페이지가 SPA 폴백보다 우선

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" && git push origin main
```

- [ ] **Step 5: 스펙 §5 체크 결과를 스펙 문서 하단에 기록 + 최종 커밋**

`docs/superpowers/specs/2026-08-26-seo-static-pages-design.md` 끝에 "## 9. 검증 결과 (2026-08-26)" 절을 추가하고 6개 항목의 실제 결과를 기록한다.

```bash
cd "C:/Users/kigki/OneDrive/바탕 화면/급매" && git add docs/ && git commit -m "docs: 정적 페이지 검증 결과 기록

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" && git push origin main
```

---

## Self-Review 결과

- 스펙 §4.2의 생성 항목(title/description/canonical/OG/JSON-LD/root HTML) → Task 1. §4.3 sitemap → `buildSitemap`. §4.4 robots → `buildRobots`. §4.5 라우팅 충돌 → Task 3 Step 4 조건부. §5 검증 6항목 → Task 3 Step 3. 누락 없음.
- placeholder 없음 — 모든 코드 블록 완결.
- 타입 일관성 — Task 2 main이 Task 1 시그니처 그대로 사용 (`transformTemplate(template, {title, description, headExtra, rootHtml})`).
- 검증 5(리치 결과 테스트)와 6의 일부는 사용자 브라우저 확인 항목임을 명시.
