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
  // JSON-LD 안의 '<' 를 < 로 바꿔 </script> 조기 종료를 막는다.
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
