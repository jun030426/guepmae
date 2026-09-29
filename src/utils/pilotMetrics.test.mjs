import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPilotSummary,
  conversionRate,
  isBot,
  kstDay,
  periodRange,
  priceBandLabel,
  rememberTracked,
  shiftDay,
  shouldTrack,
  statsByProperty,
  summarizeIntents,
  toCsv,
  totalsOf,
  trackKey,
  validateIntent,
  willingLabel,
} from './pilotMetrics.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const KAKAO_INAPP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0';
const listing = (extra = {}) => ({ id: 'gm-a1', title: '래미안 전용84㎡', region: '서울특별시 강남구', verified: true, createdAt: '2026-09-20T03:00:00Z', agent: { email: 'agent@office.kr', name: '김중개', office: '강남부동산' }, ...extra });
const collected = (extra = {}) => ({ id: 'gm-c1', title: '수집 매물 전용59㎡', region: '부산광역시 해운대구', verified: true, createdAt: null, agent: { email: '', name: '급매 운영팀', office: '급매 검증' }, ...extra });

test('kstDay — 한국 시간으로 날짜가 바뀌는 순간', () => {
  assert.equal(kstDay(new Date('2026-09-29T14:59:59Z')), '2026-09-29'); // 한국 23:59
  assert.equal(kstDay(new Date('2026-09-29T15:00:00Z')), '2026-09-30'); // 한국 00:00
  assert.equal(kstDay('2026-12-31T20:00:00Z'), '2027-01-01');
  assert.equal(kstDay('날짜 아님'), null);
});

test('shiftDay / periodRange — 오늘을 포함한 최근 N일', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(periodRange(7, '2026-09-29'), { from: '2026-09-23', to: '2026-09-29' });
  assert.deepEqual(periodRange(1, '2026-09-29'), { from: '2026-09-29', to: '2026-09-29' });
  assert.deepEqual(periodRange(null, '2026-09-29'), { from: null, to: null });
});

test('isBot — 검색 로봇·미리보기·빈 값', () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)',
    'Mozilla/5.0 (compatible; Daumoa/4.0; +https://tab.search.daum.net/aboutWebSearch.html)',
    'facebookexternalhit/1.1;kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534+ (KHTML, like Gecko) BingPreview/1.0b',
    '',
    undefined,
  ]) assert.equal(isBot(ua), true, String(ua));
  assert.equal(isBot(CHROME), false);
  assert.equal(isBot(KAKAO_INAPP), false); // 카카오톡 안에서 연 화면은 사람이다
});

test('shouldTrack — 일반 방문자는 세고, 운영진·담당 중개사·로봇은 세지 않는다', () => {
  const base = { event: 'view', property: listing(), userAgent: CHROME };
  assert.equal(shouldTrack(base), true);
  assert.equal(shouldTrack({ ...base, viewer: { role: 'user', email: 'buyer@example.com' } }), true);
  assert.equal(shouldTrack({ ...base, viewer: { role: 'agent', email: 'other@office.kr' } }), true); // 다른 중개사는 방문자
  assert.equal(shouldTrack({ ...base, event: 'inquiry_tel' }), true);

  assert.equal(shouldTrack({ ...base, viewer: { role: 'admin', email: 'ops@geupmae.kr' } }), false);
  assert.equal(shouldTrack({ ...base, viewer: { role: 'owner', email: 'owner@geupmae.kr' } }), false);
  assert.equal(shouldTrack({ ...base, viewer: { role: 'agent', email: ' Agent@Office.KR ' } }), false); // 대소문자·공백 무시
  assert.equal(shouldTrack({ ...base, webdriver: true }), false);
  assert.equal(shouldTrack({ ...base, userAgent: 'Googlebot/2.1' }), false);
  assert.equal(shouldTrack({ ...base, event: 'share' }), false);
  assert.equal(shouldTrack({ ...base, property: null }), false);
  assert.equal(shouldTrack({ ...base, property: { title: 'id 없음' } }), false);
  assert.equal(shouldTrack(), false);
  // 수집 매물(담당자 이메일 없음)을 비로그인·이메일 없는 계정이 볼 때 "본인"으로 오인하지 않는다
  assert.equal(shouldTrack({ ...base, property: collected(), viewer: { role: 'user', email: '' } }), true);
});

test('rememberTracked — 같은 날 같은 키는 한 번, 날짜가 바뀌면 다시', () => {
  const key = trackKey('view', 'gm-a1');
  assert.equal(key, 'view|gm-a1');
  // 문의는 채널을 가리지 않고 매물당 하나 — 전화와 이메일을 둘 다 눌러도 문의한 방문자는 한 명
  assert.equal(trackKey('inquiry_tel', 'gm-a1'), 'inquiry|gm-a1');
  assert.equal(trackKey('inquiry_email', 'gm-a1'), trackKey('inquiry_tel', 'gm-a1'));
  assert.notEqual(trackKey('inquiry_tel', 'gm-a1'), trackKey('inquiry_tel', 'gm-a2'));
  const first = rememberTracked(null, '2026-09-29', key);
  assert.deepEqual(first, { store: { day: '2026-09-29', keys: [key] }, fresh: true });
  const again = rememberTracked(first.store, '2026-09-29', key);
  assert.equal(again.fresh, false);
  assert.deepEqual(again.store.keys, [key]);
  // 같은 매물이라도 조회와 문의는 따로 센다
  const inquiry = rememberTracked(again.store, '2026-09-29', trackKey('inquiry_tel', 'gm-a1'));
  assert.equal(inquiry.fresh, true);
  assert.equal(inquiry.store.keys.length, 2);
  // 전화를 누른 뒤 이메일을 눌러도 새 문의가 아니다
  assert.equal(rememberTracked(inquiry.store, '2026-09-29', trackKey('inquiry_email', 'gm-a1')).fresh, false);
  // 다음 날: 목록을 비우고 새로 센다
  const nextDay = rememberTracked(inquiry.store, '2026-09-30', key);
  assert.deepEqual(nextDay, { store: { day: '2026-09-30', keys: [key] }, fresh: true });
  // 저장값이 깨져 있어도 동작한다
  assert.equal(rememberTracked({ day: '2026-09-29', keys: 'x' }, '2026-09-29', key).fresh, true);
  assert.equal(rememberTracked('깨진 값', '2026-09-29', key).fresh, true);
});

test('conversionRate — 조회가 없으면 0% 가 아니라 값 없음', () => {
  assert.equal(conversionRate(3, 40), 7.5);
  assert.equal(conversionRate(0, 40), 0);
  assert.equal(conversionRate(1, 3), 33.3);
  assert.equal(conversionRate(0, 0), null);
  assert.equal(conversionRate(2, 0), null);
  assert.equal(conversionRate(2, undefined), null);
});

test('statsByProperty / totalsOf', () => {
  const rows = [
    { property_id: 'gm-a1', agent_email: 'agent@office.kr', views: 10, inquiry_tel: 2, inquiry_email: 1 },
    { property_id: 'gm-a1', agent_email: 'agent@office.kr', views: 5, inquiry_tel: 0, inquiry_email: 0 },
    { property_id: 'gm-c1', agent_email: null, views: 7, inquiry_tel: 0, inquiry_email: 0 },
    { views: 99 },
  ];
  const map = statsByProperty(rows);
  assert.deepEqual(map.get('gm-a1'), { views: 15, inquiryTel: 2, inquiryEmail: 1, inquiries: 3 });
  assert.deepEqual(map.get('gm-c1'), { views: 7, inquiryTel: 0, inquiryEmail: 0, inquiries: 0 });
  assert.equal(map.size, 2);
  assert.deepEqual(totalsOf(rows.slice(0, 3)), { views: 22, inquiryTel: 2, inquiryEmail: 1, inquiries: 3 });
  assert.deepEqual(totalsOf(null), { views: 0, inquiryTel: 0, inquiryEmail: 0, inquiries: 0 });
});

test('validateIntent — 선택지·요금 구간·의견 길이', () => {
  assert.deepEqual(validateIntent({ willing: 'yes', priceBand: '10k_30k', comment: '  지금처럼만  ' }),
    { ok: true, value: { willing: 'yes', price_band: '10k_30k', comment: '지금처럼만' } });
  assert.deepEqual(validateIntent({ willing: 'depends', priceBand: 'unsure' }),
    { ok: true, value: { willing: 'depends', price_band: 'unsure', comment: null } });
  // 안 쓰겠다는 답에는 요금을 묻지 않는다 — 넘어온 값도 버린다
  assert.deepEqual(validateIntent({ willing: 'no', priceBand: 'gte_100k', comment: '' }),
    { ok: true, value: { willing: 'no', price_band: null, comment: null } });

  assert.equal(validateIntent({ willing: 'maybe' }).ok, false);
  assert.equal(validateIntent({}).ok, false);
  assert.equal(validateIntent().ok, false);
  assert.match(validateIntent({ willing: 'yes' }).error, /월 요금/);
  assert.match(validateIntent({ willing: 'yes', priceBand: '공짜' }).error, /월 요금/);
  assert.match(validateIntent({ willing: 'no', comment: '가'.repeat(501) }).error, /500자/);
  assert.equal(validateIntent({ willing: 'no', comment: '가'.repeat(500) }).ok, true);
});

test('summarizeIntents / 라벨', () => {
  const summary = summarizeIntents([
    { willing: 'yes', price_band: '10k_30k' },
    { willing: 'yes', price_band: '10k_30k' },
    { willing: 'depends', price_band: 'unsure' },
    { willing: 'no', price_band: null },
  ]);
  assert.deepEqual([summary.total, summary.yes, summary.depends, summary.no], [4, 2, 1, 1]);
  assert.deepEqual(summary.byBand.map((b) => [b.value, b.count]), [['10k_30k', 2], ['unsure', 1]]);
  assert.deepEqual(summarizeIntents(null), { total: 0, yes: 0, depends: 0, no: 0, byBand: [] });
  assert.equal(willingLabel('depends'), '가격에 따라 다릅니다');
  assert.equal(priceBandLabel('30k_50k'), '월 3만~5만원');
  assert.equal(priceBandLabel('없는 값'), '');
});

test('buildPilotSummary — 네 지표와 중개사별·매물별 표', () => {
  const properties = [
    listing(),
    listing({ id: 'gm-a2', title: '자이 전용59㎡', verified: false, createdAt: '2026-08-01T03:00:00Z' }),
    listing({ id: 'gm-b1', title: '푸르지오 전용84㎡', createdAt: '2026-09-28T16:00:00Z', agent: { email: 'Second@Office.kr', name: '박중개', office: '' } }),
    collected(),
  ];
  const stats = {
    listings: [
      { property_id: 'gm-a1', agent_email: 'agent@office.kr', views: 40, inquiry_tel: 2, inquiry_email: 1 },
      { property_id: 'gm-b1', agent_email: 'second@office.kr', views: 10, inquiry_tel: 0, inquiry_email: 0 },
      { property_id: 'gm-c1', agent_email: null, views: 200, inquiry_tel: 0, inquiry_email: 0 },
      { property_id: 'gm-gone', agent_email: 'agent@office.kr', views: 10, inquiry_tel: 1, inquiry_email: 0 }, // 지워진 매물
    ],
    daily: [{ day: '2026-09-29', views: 260, inquiries: 4 }],
  };
  const intents = [{ email: 'AGENT@office.kr', willing: 'depends', price_band: '10k_30k', comment: '매물 수 제한이 궁금' }];
  const alerts = [
    { status: 'active', created_at: '2026-09-25T01:00:00Z' },
    { status: 'active', created_at: '2026-08-01T01:00:00Z' },
    { status: 'unsubscribed', created_at: '2026-09-26T01:00:00Z' },
  ];
  const summary = buildPilotSummary({ properties, stats, intents, alerts, from: '2026-09-01', to: '2026-09-29' });

  assert.deepEqual(summary.listings, { total: 3, verified: 2, added: 2, agents: 2 });
  assert.deepEqual(summary.alerts, { active: 2, added: 1 });
  // 전환율의 분모는 중개사 등록 매물의 조회(40 + 10 + 10) — 수집 매물 200 은 뺀다
  assert.deepEqual(summary.traffic, {
    views: 260, inquiryTel: 3, inquiryEmail: 1, inquiries: 4, agentViews: 60, collectedViews: 200, conversion: 6.7,
  });
  assert.deepEqual([summary.intents.total, summary.intents.depends], [1, 1]);

  assert.deepEqual(summary.byAgent.map((a) => [a.email, a.office || a.name, a.listings, a.added, a.views, a.inquiries, a.conversion, a.intent?.willing ?? null]), [
    ['agent@office.kr', '강남부동산', 2, 1, 50, 4, 8, 'depends'],
    ['second@office.kr', '박중개', 1, 1, 10, 0, 0, null],
  ]);
  assert.deepEqual(summary.byListing.map((l) => [l.id, l.exists, l.views, l.inquiries, l.conversion]), [
    ['gm-a1', true, 40, 3, 7.5],
    ['gm-gone', false, 10, 1, 10],
    ['gm-c1', true, 200, 0, null], // 연락처가 없는 수집 매물 — 전환율 없음
    ['gm-b1', true, 10, 0, 0],
    ['gm-a2', true, 0, 0, null], // 아직 아무도 보지 않음
  ]);
  assert.equal(summary.byListing.find((l) => l.id === 'gm-gone').title, '(삭제된 매물)');
  assert.deepEqual(summary.daily, stats.daily);
});

test('buildPilotSummary — 전체 기간·빈 데이터', () => {
  const all = buildPilotSummary({ properties: [listing()], stats: { listings: [] }, from: null, to: null });
  assert.equal(all.listings.added, 1);
  assert.equal(all.traffic.conversion, null);
  const empty = buildPilotSummary();
  assert.deepEqual(empty.listings, { total: 0, verified: 0, added: 0, agents: 0 });
  assert.deepEqual(empty.byAgent, []);
  assert.deepEqual(empty.byListing, []);
  assert.equal(empty.intents.total, 0);
});

test('buildPilotSummary — 매물이 없는 중개사의 설문 답도 표에 남는다', () => {
  const summary = buildPilotSummary({ intents: [{ email: 'left@office.kr', willing: 'no', price_band: null }] });
  assert.deepEqual(summary.byAgent.map((a) => [a.email, a.listings, a.intent.willing]), [['left@office.kr', 0, 'no']]);
});

test('toCsv — 한글·쉼표·따옴표·수식 주입', () => {
  const csv = toCsv(
    [{ label: '매물', value: (r) => r.title }, { label: '조회', value: (r) => r.views }, { label: '전환율', value: (r) => r.rate }, { label: '의견', value: (r) => r.comment }],
    [
      { title: '대동1,2차 "로얄"', views: 12, rate: 7.5, comment: '줄\n바꿈' },
      { title: '=HYPERLINK("http://x","클릭")', views: 0, rate: null, comment: '+82 10' },
      { title: '-3억', views: -1, rate: -2.5, comment: '@here' },
    ],
  );
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.deepEqual(csv.slice(1).split('\r\n'), [
    '매물,조회,전환율,의견',
    '"대동1,2차 ""로얄""",12,7.5,"줄\n바꿈"',
    '"\'=HYPERLINK(""http://x"",""클릭"")",0,,\'+82 10',
    "'-3억,-1,-2.5,'@here", // 글자로 온 -는 막고, 숫자 -1 은 그대로
    '',
  ]);
  assert.equal(toCsv([{ label: '빈 표', value: () => '' }], []), '﻿빈 표\r\n');
});
