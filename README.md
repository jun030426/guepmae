# 급매 (Geupmae)

> 실거래가로 검증된 급매 전용 부동산 플랫폼

**Live**: https://guepmae.vercel.app

---

## 1. 프로젝트 개요

### 무엇을 하는 사이트인가
일반 부동산 사이트에 매물이 "급매!"로 등록돼 있어도 진짜 시세보다 싼지 알기 어렵습니다. 이 사이트는 **국토교통부 실거래가 공개시스템의 1년치 55만 6,907건 거래 데이터**를 직접 집계해서, 모든 매물의 할인율이 진짜 시세 대비 얼마인지 자동 검증합니다.

### 핵심 컨셉 — "실거래가로 증명"
- 같은 단지 + 같은 면적대의 1년 거래 중앙값을 **peer median**으로 사용
- 매물 등록가가 peer median 대비 5% 이상 싸면 "급매"로 자동 분류
- "급매라고 주장하지 않고, 데이터로 증명"

### 두 가지 진입점
| 사용자 | 진입점 | 핵심 동선 |
|---|---|---|
| 매수자 | `/` 홈 → `/properties` 목록 → `/properties/:id` 상세 | 매물 검증된 가격 + AI 리포트 |
| 중개사 | `/agent` 랜딩 → 가입 신청 → 승인 → `/agent/dashboard` | 매물 등록 → AI 리포트 자동 생성 |

### 데이터 규모
| 항목 | 값 |
|---|---|
| 데이터 출처 | 국토교통부 실거래가 공개시스템 (CSV 일괄 다운로드, CP949) |
| 집계 기간 | 2025-05 ~ 2026-05 (13개월) |
| 총 거래 | **556,907건** |
| 시도 | 17개 |
| 구·시·군 | 254개 |
| 단지 그룹 | 41,141개 |
| 급매 비율 | 24.8% (138,251건이 peer 대비 5%↑ 할인) |

---

## 2. 기술 스택

[package.json](package.json) 실제 의존성 기준.

### Dependencies (실행 시 필요)
| 패키지 | 버전 | 용도 |
|---|---|---|
| `react` | latest (18.x) | UI 라이브러리 |
| `react-dom` | latest | 브라우저 렌더링 |
| `react-router-dom` | latest | SPA 라우팅 |
| `vite` | latest (8.x) | 빌드·개발 서버 |
| `@vitejs/plugin-react` | latest | Vite의 React 플러그인 |
| `recharts` | latest | 차트 라이브러리 |
| `lucide-react` | latest | 아이콘 |
| `@supabase/supabase-js` | ^2.105.4 | Supabase 클라이언트 (Auth + Postgres + Storage) |
| `ai` | ^6.0.191 | Vercel AI SDK (LLM 호출 + schema 강제) |
| `@ai-sdk/google` | ^3.0.79 | Google AI Studio (Gemini fallback) |
| `@ai-sdk/google-vertex` | ^3.0.140 | Vertex AI (Gemini 1순위) |
| `@googlemaps/markerclusterer` | ^2.6.2 | 지도 마커 클러스터링 |
| `zod` | ^4.4.3 | AI 출력 schema 검증 |

### DevDependencies (데이터 처리용)
| 패키지 | 버전 | 용도 |
|---|---|---|
| `csv-parse` | ^6.2.1 | 국토부 CSV 파싱 |
| `iconv-lite` | ^0.7.2 | CP949 → UTF-8 디코딩 |

### 스타일
**순수 CSS** (Tailwind/styled-components 등 X). 직접 짠 CSS 토큰 시스템:
- `src/styles/tokens.css` — CSS 변수 단일 진실원 (color/spacing/font)
- `src/styles/tokens.js` — Recharts·SVG처럼 var() 못 쓰는 곳에 hex 미러
- `src/styles/global.css` — 글로벌 reset + 컴포넌트 베이스 (약 5,900줄)
- `src/styles/compass-phase1.css` — 사이트 톤(테라코타+차콜) 오버라이드

### 외부 서비스
- **Supabase** (Auth + Postgres + Storage + RLS)
- **Vercel** (서버리스 함수 + 정적 호스팅 + 자동 배포)
- **Google Maps Platform** (지도 + Places + Geocoding)
- **Google Vertex AI / AI Studio** (Gemini 2.5 Flash)

---

## 3. 폴더 구조

실제 파일 기준.

```
guepmae/
├── README.md                              ← 이 문서
├── package.json                           ← 의존성 정의 (위 2번)
├── index.html                             ← Vite 진입
├── vite.config.js                         ← Vite 설정
├── vercel.json                            ← Vercel 배포 설정
│
├── src/                                   ← 클라이언트 코드 (React)
│   ├── main.jsx                           ← React 진입 + Router 등록
│   ├── App.jsx                            ← 라우트 정의 (13개 라우트)
│   │
│   ├── pages/                             ← 라우트별 페이지 컴포넌트
│   │   ├── Home.jsx                       ← / 홈 (Hero + 추천 매물)
│   │   ├── Properties.jsx                 ← /properties 매물 목록 + 필터
│   │   ├── PropertyDetail.jsx             ← /properties/:id 매물 상세
│   │   ├── MapPage.jsx                    ← /map 지도 검색
│   │   ├── Report.jsx                     ← /report 급매 리포트 (8개 영역)
│   │   ├── Login.jsx                      ← /login 로그인 + 비밀번호 재설정
│   │   ├── PriceTrends.jsx                ← /trends 시세 동향 (보류)
│   │   ├── AgentLanding.jsx               ← /agent 중개사 랜딩
│   │   ├── AgentSignup.jsx                ← /agent/signup 중개사 가입
│   │   ├── AgentDashboard.jsx             ← /agent/dashboard 중개사 대시보드
│   │   ├── AgentRegisterProperty.jsx      ← /agent/properties/new 매물 등록
│   │   ├── AgentMyProperties.jsx          ← /agent/properties 중개사 매물 관리
│   │   ├── AgentEditProperty.jsx          ← /agent/properties/:id/edit 매물 수정
│   │   └── Admin.jsx                      ← /admin 운영자 관리
│   │
│   ├── components/                        ← 재사용 컴포넌트
│   │   ├── Header.jsx                     ← 일반 영역 헤더
│   │   ├── AgentHeader.jsx                ← 중개사 portal 헤더
│   │   ├── Footer.jsx                     ← 푸터
│   │   ├── HeroSearch.jsx                 ← 홈 Hero 안 검색바
│   │   ├── SectionTitle.jsx               ← 페이지 제목 (eyebrow + h1 + desc)
│   │   ├── PropertyCard.jsx               ← 매물 카드 (목록·홈 공용)
│   │   ├── PropertyFilter.jsx             ← 매물 필터 사이드바
│   │   ├── PropertyMediaViewer.jsx        ← 매물 사진 갤러리 풀스크린
│   │   ├── PropertyLocationMap.jsx        ← 매물 상세 지도
│   │   ├── PriceReport.jsx                ← 가격 검증 차트 (13개월 추이)
│   │   ├── PropertyReportPanel.jsx        ← AI 매물 리포트 5섹션
│   │   ├── MapView.jsx                    ← 지도 + 마커 (검색 페이지용)
│   │   ├── ComplexAutocomplete.jsx        ← 단지명 자동완성
│   │   ├── ConfirmDialog.jsx              ← 확인 다이얼로그
│   │   ├── RequireRole.jsx                ← 라우트 가드 (역할 검사)
│   │   ├── StatCard.jsx                   ← 통계 카드 (Admin용)
│   │   ├── UrgentBadge.jsx                ← 급매 배지
│   │   ├── SerifHeadline.jsx              ← serif 헤드라인 헬퍼 (사용처 없음, dead)
│   │   ├── report/                        ← /report 페이지 전용
│   │   │   ├── AiMarketReport.jsx         ← AI 시장 분석 카드
│   │   │   └── RegionRadar.jsx            ← 4탭 지역 레이더 차트
│   │   └── trends/                        ← /trends 페이지 전용 (보류)
│   │       └── TrendsHero.jsx
│   │
│   ├── context/
│   │   └── AuthContext.jsx                ← Supabase Auth wrapper (Context API)
│   │
│   ├── hooks/
│   │   └── useProperties.js               ← useProperties() + useProperty(id)
│   │
│   ├── services/                          ← 데이터 fetch + 비즈니스 로직
│   │   ├── propertiesRepository.js        ← properties 테이블 read
│   │   ├── propertyRegistration.js        ← 매물 등록 + 기준가 산출 + 추이 스냅샷
│   │   ├── propertyReports.js             ← AI 매물 리포트 fetch
│   │   ├── reportData.js                  ← market_snapshots 7개 키 fetch + 캐시
│   │   ├── marketReport.js                ← ai_market_reports fetch
│   │   ├── trendData.js                   ← price_trends fetch (시세 동향용)
│   │   ├── agentApplications.js           ← 중개사 가입 신청
│   │   └── userManagement.js              ← Admin 사용자 관리
│   │
│   ├── utils/
│   │   ├── priceUtils.js                  ← formatPrice·formatArea·할인율·급매 판정
│   │   ├── propertyMedia.js               ← 매물 사진 추출
│   │   ├── regionName.js                  ← 시도 짧은이름 → 풀이름 매핑
│   │   ├── trendStats.js                  ← 신뢰도 등급 함수
│   │   ├── phoneFormat.js                 ← 휴대폰 번호 포맷
│   │   ├── googleMapLoader.js             ← Google Maps SDK 싱글톤 로더
│   │   ├── naverMapLoader.js              ← Naver Maps SDK fallback 로더
│   │   └── pannellumLoader.js             ← 360 파노라마 뷰어 로더
│   │
│   ├── lib/
│   │   └── supabaseClient.js              ← Supabase 클라이언트 + isSupabaseConfigured 플래그
│   │
│   ├── styles/                            ← (위 2번 기술 스택 참고)
│   │   ├── tokens.css
│   │   ├── tokens.js
│   │   ├── global.css
│   │   └── compass-phase1.css
│   │
│   └── data/                              ← 정적 데이터 JSON (gitignored)
│       ├── marketData.json                ← 시장 통계 집계 결과 (9.9KB)
│       └── complexLookup.json             ← 단지 자동완성 룩업 (8.5MB)
│
├── api/                                   ← Vercel 서버리스 함수
│   ├── property-report.js                 ← 매물 AI 리포트 생성 + 캐시 + 락
│   ├── market-report.js                   ← 시장 분석 AI 생성 (secret 보호)
│   └── lookup-lifestyle.js                ← 매물 주변 생활편의 (Places API)
│
├── supabase/
│   ├── migrations/                        ← DB 스키마 (23개 .sql 파일)
│   │   ├── 20260514..._initial_real_estate_schema.sql   ← properties 테이블 초기
│   │   ├── 20260515..._auth_profiles_and_seller_verification.sql
│   │   ├── 20260515..._agent_applications_and_public_signup_user_only.sql
│   │   ├── 20260518..._oauth_profile_metadata.sql
│   │   ├── 20260519..._market_snapshots.sql            ← /report 시장 통계
│   │   ├── 20260520..._property_reports.sql            ← AI 매물 리포트 캐시
│   │   ├── 20260520..._property_photos_storage.sql     ← Supabase Storage 버킷
│   │   ├── 20260520..._owner_role_and_suspension.sql
│   │   ├── 20260529..._price_trends_table.sql          ← 구·평형·월 시계열
│   │   ├── 20260530..._complex_prices_table.sql        ← 단지·평형 중앙값
│   │   ├── 20260531..._ai_market_reports.sql           ← AI 시장 분석 캐시
│   │   └── ... (RLS 정책 + 컬럼 추가 마이그레이션 12개 더)
│   └── seed/
│       ├── properties_seed.sql            ← 시드 매물 115건
│       └── market_snapshots_seed.sql      ← 시장 통계 시드 SQL
│
└── scripts/                               ← Node.js 데이터 파이프라인
    ├── import-trades-csv.mjs              ← CSV → marketData.json (집계 + peer median)
    ├── build-market-snapshots-seed-sql.mjs ← marketData.json → seed SQL
    ├── build-price-trends.mjs             ← CSV → price_trends.csv (구·평형·월)
    ├── build-complex-prices.mjs           ← CSV → complex_prices.csv (단지·평형)
    ├── build-properties-seed-sql.mjs      ← properties_seed.sql 생성
    ├── generate-properties.mjs            ← 시드 매물 생성기
    ├── verify-report-snapshot.mjs         ← Top 10 단지 정직성 검증
    ├── verify-region-discount.mjs         ← 17개 시도 평균/중앙값 검증
    ├── verify-price-trends.mjs            ← 1,107 그룹 충실도 검증
    ├── data/                              ← 국토부 CSV 17개 (gitignored, 108MB)
    └── output/                            ← 가공 결과 (gitignored)
        ├── price_trends.csv
        └── complex_prices.csv
```

### Supabase 테이블 (마이그레이션 기준)
| 테이블 | 용도 |
|---|---|
| `profiles` | 사용자 프로필 + 역할 |
| `properties` | 매물 |
| `property_reports` | AI 매물 리포트 캐시 |
| `agent_applications` | 중개사 가입 신청 |
| `seller_verifications` | 판매자 인증 |
| `market_snapshots` | /report 페이지용 시장 통계 (7개 key/value) |
| `price_trends` | 구·평형·월별 시계열 |
| `complex_prices` | 단지·평형 중앙값 |
| `ai_market_reports` | AI 시장 분석 캐시 |

---

## 4. 주요 기능

### 4-1. 매물 시스템

#### 매물 목록 (`/properties`)
- 좌측 필터 사이드바 (지역 13곳·가격대·면적대·할인율·할인 임계값)
- URL 쿼리 동기화 (`?region=서울`, `?keyword=강남`)
- 페이지네이션 (10건/페이지)
- 정렬 (할인율↓ / 최근 등록순 / 가격↑)

#### 매물 상세 (`/properties/:id`)
- 사진 갤러리 (풀스크린 모달)
- 매물 정보 (단지·면적·층·향·연식·세대수·주차)
- **가격 검증 리포트** (PriceReport): 매도가 vs 기준 실거래가 + 13개월 추이 차트
- **AI 매물 리포트 패널** (PropertyReportPanel): 5섹션 자동 생성
  - 종합 의견 (점수·등급·매수 권장도)
  - 매물 사실 + 권리관계 안내
  - 가격 분석 + 추이 + 중개사 주장 검증 + 하방 위험
  - 위치 (교통·생활편의·학교·지역 시장 흐름)
  - 사진 분석 (사진이 있을 때만, Gemini가 직접 사진 본 후)
- 지도 (Google Maps 위치 핀)
- 360 파노라마 (Pannellum, 데이터 있을 때만)
- 중개사 정보 + 문의 버튼

### 4-2. 지도 검색 (`/map`)
- Google Maps 전국 핀
- `@googlemaps/markerclusterer` 클러스터링
- 핀 색상 = 할인율 등급 (테라코타 그라데이션)
- 핀 클릭 → 매물 카드 popup → 상세 진입

### 4-3. 급매 리포트 (`/report`)
시장 통계 8개 영역. **모두 인터랙티브, 모두 차트/카드 사이트 톤 통일**.

| 영역 | 컴포넌트 | 데이터 출처 |
|---|---|---|
| Hero | `SectionTitle` + 출처 메타칩 | `market_snapshots.metadata` |
| 헤드라인 4카드 (급매 압력/할인 강도/주목 지역/거래 모멘텀) | `HeadlineCard` (Report 내 정의) | `market_snapshots.monthly·insights·regional` |
| 프리미엄/할인 분류 카드 (17개 시도 양분) | `MarketCategoryCards` | `regional` |
| 지역별 시세 대비 등락 (ComposedChart 평균+중앙값) | Recharts | `regional` |
| 월별 거래량·급매 추이 (부분월 점선·음영) | Recharts LineChart | `monthly` |
| 면적대별 시장 분포 (중앙값+할인+표본 3축) | Recharts BarChart | `area_type` |
| **급매 레이더** (4탭: 거래량/급매비율/평균할인/중앙값) | `RegionRadar` | `regional` |
| 급매 집중 단지 Top 10 | 테이블 | `top_urgent` |
| AI 시장 분석 (3~5개 인사이트 카드) | `AiMarketReport` | `ai_market_reports` (Gemini 자동 생성) |

#### 차트 → 매물 진입
지역 차트의 막대 클릭 + 분류 카드 행 클릭 → `/properties?region=` navigate.

### 4-4. 매물 등록 (중개사, `/agent/properties/new`)
- 단지명 자동완성 (`complex_prices` 트라이그램 인덱스 사용)
- 단지 + 평형 선택 → `complex_prices`에서 기준 실거래가 자동 산출
- 단지 없으면 → `price_trends`에서 구 시세로 fallback
- 매물 INSERT 후 백그라운드로 AI 리포트 자동 생성 (`/api/property-report`)

### 4-5. 사용자 시스템
- Supabase Auth: 이메일+비밀번호, 6자리 OTP, Google·Kakao OAuth
- 5역할: `user / seller / agent / admin / owner`
- 비밀번호 재설정 3단계 (요청 → OTP 검증 → 새 비밀번호)
- 정지된 계정 강제 로그아웃

### 4-6. 운영자 admin (`/admin`)
- 매물 검증 토글
- 사용자 + 역할 관리
- 중개사 가입 신청 승인/거절

---

## 5. 데이터 파이프라인

국토부 CSV → 가공 → Supabase → 화면. 모든 단계 검증 가능.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ① 국토부 실거래가 공개시스템 (CSV 일괄 다운로드)                       │
│     17개 시도, CP949 인코딩, 약 108MB                                │
│     scripts/data/{서울특별시,경기도,...}250529~260529.csv             │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────────┐
│  ② Node.js 가공 스크립트 (scripts/)                                   │
│                                                                      │
│  import-trades-csv.mjs                                                │
│    - iconv-lite로 CP949 → UTF-8                                       │
│    - csv-parse로 파싱                                                  │
│    - 단지+면적 bucket별 peer median 계산 (3건↑일 때만)                  │
│    - 거래마다 할인율 = (peer-거래가)/peer × 100                          │
│    - 5% 이상 할인 = 급매 분류                                           │
│    - 시도/월/면적/단지 단위로 집계                                       │
│    → src/data/marketData.json (집계 9.9KB)                            │
│    → src/data/complexLookup.json (단지 룩업 8.5MB)                    │
│                                                                      │
│  build-market-snapshots-seed-sql.mjs                                  │
│    → supabase/seed/market_snapshots_seed.sql (7개 key upsert)         │
│                                                                      │
│  build-price-trends.mjs                                               │
│    → scripts/output/price_trends.csv (1,107 그룹 × 13개월)            │
│                                                                      │
│  build-complex-prices.mjs                                             │
│    → scripts/output/complex_prices.csv (단지·평형 중앙값)              │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────────┐
│  ③ Supabase 적재 (수동, Dashboard에서)                                │
│                                                                      │
│  - SQL Editor: market_snapshots_seed.sql paste & Run                  │
│  - Table Editor: price_trends.csv / complex_prices.csv "Import data"  │
│                                                                      │
│  → market_snapshots / price_trends / complex_prices 테이블 채움        │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────────┐
│  ④ 클라이언트 fetch (src/services/)                                    │
│                                                                      │
│  reportData.js  → market_snapshots 7개 키 한 번에 fetch + 모듈 캐시      │
│  trendData.js   → price_trends 조회 (구·평형·월) + 신뢰도 등급 계산       │
│  propertyRegistration.js → complex_prices·price_trends 조회             │
│                                                                      │
│  → /report 페이지 8개 영역 자동 렌더                                    │
│  → 매물 등록 시 기준 실거래가·13개월 추이 스냅샷 자동                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 데이터 정직성 검증 스크립트
가공 결과가 진짜 CSV에서 나왔는지 별도 일회성 스크립트로 검증:

| 스크립트 | 무엇을 검증 |
|---|---|
| `verify-report-snapshot.mjs` | Top 10 단지가 진짜 CSV에 있는지 단지명·표본수·할인율 직접 추적 |
| `verify-region-discount.mjs` | 17개 시도 평균 vs 중앙값 차이 → outlier 영향 정량화 (서울 31.7%p 차이 발견) |
| `verify-price-trends.mjs` | 1,107 구·평형 그룹별 13개월 충실도 → 54.9%가 13개월 풀 충실 확인 |

→ 발표 시 "데이터가 진짜냐?"에 검증 스크립트로 직접 증명.

---

## 6. 컴포넌트 재사용 사례 ★

기말 주제가 "재활용"이라 가장 중요한 섹션. **실제 import grep 결과 기준**.

### 6-1. AuthContext.useAuth() — 10곳에서 import (재사용 1위)

**정의**: [src/context/AuthContext.jsx](src/context/AuthContext.jsx)
- Supabase Auth wrapper를 React Context로 노출
- 메서드 14개 (signIn / signUp / OTP / OAuth / 비밀번호 재설정 / signOut / refreshProfile / ...)
- 파생 boolean 4개 (isAuthenticated / isOwner / isAdmin / isAgent)

**사용처 10곳**:
| 위치 | 어떻게 사용 |
|---|---|
| `components/Header.jsx` | 일반 헤더에서 로그인 상태·로그아웃 |
| `components/AgentHeader.jsx` | 중개사 portal 헤더 |
| `components/RequireRole.jsx` | 라우트 가드 (역할 체크) |
| `pages/Login.jsx` | 로그인·회원가입 흐름 |
| `pages/AgentSignup.jsx` | 중개사 가입 신청 |
| `pages/AgentLanding.jsx` | 가입 신청 상태 표시 |
| `pages/AgentDashboard.jsx` | 중개사 본인 정보 |
| `pages/AgentMyProperties.jsx` | 본인 매물 필터 |
| `pages/AgentRegisterProperty.jsx` | 매물 등록 시 agent 자동 fill |
| `pages/Admin.jsx` | 운영자 권한 체크 |

→ **단일 Context 정의 + 10곳 hook 사용**. 한 곳 수정으로 전 사이트 인증 흐름 변경 가능.

### 6-2. useProperties / useProperty 훅 — 페이지 7곳

**정의**: [src/hooks/useProperties.js](src/hooks/useProperties.js)

#### `useProperties({ urgentOnly })` — 5곳
| 페이지 | 옵션 | 활용 |
|---|---|---|
| `Home.jsx` | `urgentOnly: true` | 추천 매물 그리드 (할인율 5%↑) |
| `Properties.jsx` | `urgentOnly: true` | 전체 매물 목록 + 추가 필터 |
| `MapPage.jsx` | `urgentOnly: true` | 지도 핀 (할인율 5%↑만) |
| `AgentMyProperties.jsx` | `urgentOnly: false` | agent 본인이 등록한 매물 |
| `Admin.jsx` | `urgentOnly: false` | 운영자 검증용 전체 매물 |

→ **같은 fetch 로직 + 옵션 1개로 5가지 다른 화면**.

#### `useProperty(id)` — 2곳
| 페이지 | 활용 |
|---|---|
| `PropertyDetail.jsx` | 사용자 매물 상세 (읽기 전용) |
| `AgentEditProperty.jsx` | 중개사 매물 수정 (편집) |

→ 같은 단일 매물 fetch + 다른 UI.

### 6-3. priceUtils.formatPrice() — 10곳

**정의**: [src/utils/priceUtils.js](src/utils/priceUtils.js)
- `formatPrice(원)` → "5억 2,402만" 한글 포맷
- `formatArea(㎡)` → "84㎡" 또는 "25평"
- `pyeongToSqm(평)` → 면적 변환
- `calculateDiscountRate` / `calculatePriceGap` / `isUrgentSale`

**사용처**:
| 위치 | 어디서 |
|---|---|
| 컴포넌트 4곳 | PropertyCard·PropertyMediaViewer·PropertyReportPanel·MapView |
| 페이지 6곳 | MapPage·PropertyDetail·AgentMyProperties·AgentEditProperty·AgentRegisterProperty·Admin·Report |

→ **가격 포맷 정의 1곳 + 사이트 전역 일관**. 어디든 같은 "5억 2,402만" 형태.

### 6-4. Google Maps SDK 싱글톤 로더 — 3곳

**정의**: [src/utils/googleMapLoader.js](src/utils/googleMapLoader.js)
- Google Maps SDK 한 번만 로드 (싱글톤 패턴)
- libraries=places, marker 등 옵션

**사용처 3곳**:
| 컴포넌트 | 용도 |
|---|---|
| `MapView.jsx` | `/map` 페이지 전국 지도 + 클러스터 마커 |
| `PropertyLocationMap.jsx` | 매물 상세 단일 핀 지도 |
| `PropertyMediaViewer.jsx` | 사진 갤러리 안 지도 모드 (street view) |

→ SDK 중복 로드 방지 + 페이지 이동 시에도 캐시. **3개 컴포넌트가 같은 싱글톤 활용**.

### 6-5. SectionTitle — 5곳

**정의**: [src/components/SectionTitle.jsx](src/components/SectionTitle.jsx)
- "eyebrow + serif h1 + description" 패턴
- 헤더 영역 시각 일관

**사용처 5곳**:
| 페이지 | 사용 |
|---|---|
| `Home.jsx` | 섹션 헤더들 |
| `Properties.jsx` | 매물 목록 hero |
| `Report.jsx` | 급매 리포트 hero |
| `Admin.jsx` | 운영자 페이지 hero |
| `AgentSignup.jsx` | 중개사 가입 hero |

### 6-6. PropertyCard — 2곳 (목록·홈 공용)

**정의**: [src/components/PropertyCard.jsx](src/components/PropertyCard.jsx)
- 매물 1개 카드: 사진·제목·주소·가격·할인율 배지

**사용처**:
| 페이지 | 활용 |
|---|---|
| `Home.jsx` | 추천 매물 그리드 (4~6개) |
| `Properties.jsx` | 검색 결과 그리드 (페이지당 10개) |

### 6-7. Recharts 토큰 — JS 미러 (tokens.js)

**정의**: [src/styles/tokens.js](src/styles/tokens.js)
- CSS 변수의 hex 값을 JS에서 import 가능한 상수로 export
- 이유: Recharts·SVG는 prop으로 `var()` CSS 변수를 못 받음

**사용처 3곳**:
| 위치 | 어떤 토큰을 |
|---|---|
| `pages/Report.jsx` | `PRIMARY` (테라코타), `TEXT_STRONG_SOFT` (차콜), `SURFACE_WARM` (음영), `BORDER`, `TEXT_MUTED` |
| `components/MapView.jsx` | `MARKER_HOT` / `MARKER_WARM` / `MARKER_MILD` (지도 마커 색) |
| `components/PriceReport.jsx` | `PRIMARY`, `BORDER` (차트 색) |

→ **CSS 토큰 단일 진실원 유지 + Recharts 한계 우회**. 토큰 값 바뀌면 tokens.css와 tokens.js 같이 갱신.

### 6-8. supabaseClient — 15곳

**정의**: [src/lib/supabaseClient.js](src/lib/supabaseClient.js)
- Supabase 클라이언트 한 번 생성
- `isSupabaseConfigured` 플래그 export

**사용처 15곳**: 거의 모든 서비스(8개) + 일부 컴포넌트·페이지·훅 — 단일 클라이언트 공유.

### 6-9. Header / AgentHeader / Footer — 라우트별 분기

**정의**: 각각 [src/components/](src/components/)

**사용처**: [src/App.jsx](src/App.jsx)에서 URL 기반 분기:
```jsx
const isAgentArea = pathname.startsWith('/agent');
{isAgentArea ? <AgentHeader /> : <Header />}
{!isFullViewport && !isAgentArea && <Footer />}
```

→ **한 App.jsx에서 3개 헤더 컴포넌트를 영역별로 전환**. 매물 영역과 중개사 영역의 톤·메뉴를 별도 컴포넌트로 분리.

### 6-10. PriceReport + PropertyReportPanel 합성 — PropertyDetail

**정의**:
- [src/components/PriceReport.jsx](src/components/PriceReport.jsx) — 가격 검증 차트 (Recharts LineChart)
- [src/components/PropertyReportPanel.jsx](src/components/PropertyReportPanel.jsx) — AI 리포트 5섹션

**사용처**: `PropertyDetail.jsx` 한 페이지에서 두 컴포넌트 합성:
- PriceReport (객관적 데이터 차트)
- PropertyReportPanel (AI 자연어 분석)

→ **데이터 차트 + AI 텍스트 두 큰 컴포넌트가 한 페이지 안에서 보완 관계로 동작**.

### 6-11. ai/Vercel AI SDK + zod schema 패턴 — 2개 API

**정의**: 매물 AI 리포트 [api/property-report.js](api/property-report.js)에서 처음 확립한 패턴:
- `generateObject({ model, schema, system, messages })` 호출
- Zod schema로 LLM 출력 형식 강제
- DB 락 + 캐시 (status='generating' → 'ready')

**재사용**: 시장 분석 AI [api/market-report.js](api/market-report.js)도 **그대로 같은 패턴 적용**:
- 코드 구조 95% 복사 → 입력 데이터·schema·프롬프트만 교체
- 모델 분기(Vertex 우선·AI Studio fallback) 그대로
- 락 패턴 그대로
- DB 캐시 그대로

→ **하나의 AI 호출 패턴을 두 다른 도메인(매물·시장)에 재사용**. 새 키 발급·새 환경변수 없이 작업 시간 1/3로 단축.

### 6-12. Tooltip CSS 클래스 .region-tooltip — 2개 차트

**정의**: [src/styles/compass-phase1.css](src/styles/compass-phase1.css)의 `.region-tooltip`
- 흰 배경 + 베이지 보더 + 차콜 그림자
- 지역명 + flex row 형식

**사용처 2곳**:
| 위치 | 어떤 정보 |
|---|---|
| `pages/Report.jsx`의 `RegionDiscountTooltip` | 평균/중앙값/거래량 (지역 시세 차트) |
| `components/report/RegionRadar.jsx`의 `RegionRadarTooltip` | 거래량/급매비율/평균/중앙값 (레이더 4탭) |

→ 같은 CSS + 두 다른 custom Tooltip 컴포넌트가 일관된 스타일.

### 6-13. 자동 해석 노트 패턴 (.chart-note) — 4개 차트

**정의**: [src/styles/compass-phase1.css](src/styles/compass-phase1.css) `.chart-note + .chart-note-list`

**사용처 4곳**:
| 차트 | 자동 해석 |
|---|---|
| 지역 시세 대비 등락 (`RegionChartNotes`) | "서울·제주는 평균-중앙값 차이 큼" |
| 면적대별 시장 분포 (`AreaChartNotes`) | "60㎡이하 급매비율 28% 최고" |
| 월별 추이 (`MonthlyTrendNotes`) | "1년 평균 급매비율 23.4% 안정적" |
| 급매 레이더 (탭별 동적 노트) | 각 탭별 1위 지역 highlight |

→ **데이터 규칙으로 한 줄 자동 생성** 패턴을 4개 차트에 일관 적용.

---

## 7. 실행 방법

### 7-1. 사전 준비
- Node.js 18+ (권장 20+)
- npm 또는 pnpm/yarn
- Supabase 계정 + 프로젝트
- Vercel 계정 (배포용)
- Google Cloud 프로젝트 (Maps + Vertex AI)

### 7-2. 환경변수

#### 클라이언트 — `.env` (gitignored)
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx...
VITE_GOOGLE_MAPS_API_KEY=AIzaxxx...
VITE_GOOGLE_PLACES_API_KEY=AIzaxxx...
```

#### 서버 — Vercel Environment Variables (Settings → Environment Variables)
```env
# Supabase (service_role — RLS 우회용, 절대 클라이언트 노출 X)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Vertex AI (1순위, GCP 크레딧 사용)
GCP_PROJECT_ID=...
GCP_CLIENT_EMAIL=...@developer.gserviceaccount.com
GCP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
GCP_LOCATION=asia-northeast3
GEMINI_MODEL=gemini-2.5-flash    # 선택, 기본값

# AI Studio fallback (Vertex 없을 때)
AI_GATEWAY_API_KEY=...

# 시장 AI 트리거 보호
MARKET_REPORT_SECRET=...
```

### 7-3. 설치 + 실행

```bash
# 의존성 설치
npm install

# 개발 서버 (http://localhost:5173)
npm run dev

# 프로덕션 빌드
npm run build

# 빌드 결과 미리보기
npm run preview
```

### 7-4. 데이터베이스 초기화

```bash
# Supabase Dashboard → SQL Editor 에서 마이그레이션 순서대로 paste
# supabase/migrations/ 파일 23개를 파일명 순서대로

# 그 다음 seed 데이터
# supabase/seed/properties_seed.sql 한 번에 paste (시드 매물 115건)
# supabase/seed/market_snapshots_seed.sql paste (시장 통계 시드)
```

### 7-5. 데이터 갱신 (실거래가 1년치 새로 받기, 수동 6단계)

```bash
# 1. 국토부 실거래가 공개시스템에서 17개 시도 CSV 다운로드
#    https://rt.molit.go.kr/ → 아파트 매매 → 1년치

# 2. scripts/data/ 에 CSV 배치 (17개)

# 3. 가공 (4분 정도 소요)
node scripts/import-trades-csv.mjs        # → marketData.json + complexLookup.json
node scripts/build-market-snapshots-seed-sql.mjs  # → seed SQL
node scripts/build-price-trends.mjs        # → price_trends.csv
node scripts/build-complex-prices.mjs      # → complex_prices.csv

# 4. (선택) 정직성 검증
node scripts/verify-region-discount.mjs    # 17개 시도 평균/중앙값 비교
node scripts/verify-price-trends.mjs       # 1,107 그룹 충실도

# 5. Supabase Dashboard 에 적재
#    - SQL Editor: market_snapshots_seed.sql paste & Run
#    - Table Editor: price_trends 와 complex_prices 테이블 import data from CSV

# 6. 라이브 사이트 자동 반영 (캐시는 페이지 새로고침으로 갱신)
```

### 7-6. AI 시장 분석 트리거 (수동, 데이터 갱신 후)

```bash
# 브라우저에서:
https://guepmae.vercel.app/api/market-report?force=true&secret=YOUR_SECRET
```

→ Gemini가 새 데이터로 3~5개 인사이트 생성 → `ai_market_reports` 저장 → /report 페이지 자동 반영.

### 7-7. Vercel 배포

```bash
# Vercel GitHub 연결 → main 푸시 시 자동 배포
git push origin main
```

또는 Vercel CLI:
```bash
vercel --prod
```

---

## 라이센스 / 데이터 출처 / 면책

- **데이터**: 국토교통부 실거래가 공개시스템 (공공데이터, 자유 활용)
- **사용 범위**: 정보 제공 목적의 통계·진단
- **법적 한계**: 본 사이트의 모든 분석은 **과거 데이터의 패턴 설명**이며, **매수·매도 권유나 미래 가격 예측이 아닙니다**. 투자 의사결정은 본인 책임 하에 진행하시기 바랍니다.

---

## 부록 — 발표 시 강조하면 좋은 포인트

1. **"55만 6,907건 실거래로 정직한 진단"** — 가짜 데이터 X
2. **outlier 발견 스토리** — "서울 평균 -32.8%인데 중앙값 -1.1%. 강남 신축 outlier 발견" (verify 스크립트로 직접 증명)
3. **AI 안전 설계** — 부동산은 자본시장법 위험. 예측·권유 금지 + schema 강제 + 정적 면책
4. **재사용 1위 — AuthContext 10곳, useProperties 5곳, formatPrice 10곳, Google Maps loader 3곳** (Section 6 참고)
5. **한 페이지의 컴포넌트 합성** — PropertyDetail에 PriceReport(데이터) + PropertyReportPanel(AI 텍스트) 함께
6. **데이터 검증 스크립트로 정직성 입증** — 발표 중 누가 "데이터 진짜?" 물으면 verify 스크립트 보여줌
