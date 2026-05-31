# 급매 (Geupmae)

실거래가로 검증된 급매 전용 부동산 플랫폼.

**Live**: https://guepmae.vercel.app

> 급매라고 주장하지 않고, 국토부 실거래가 1년치 **55만 6,907건**으로 증명합니다.

---

## 데이터 규모

| 항목 | 값 |
|---|---|
| 데이터 출처 | 국토교통부 실거래가 공개시스템 |
| 집계 기간 | 2025-05 ~ 2026-05 (13개월) |
| 총 거래 | **556,907건** |
| 시도 | 17개 |
| 구·시·군 | 254개 |
| 단지 그룹 | 41,141개 |
| 급매 비율 | 24.8% (138,251건, peer 대비 5%↑ 할인) |

---

## 핵심 기능

### 1. 매물 검증 시스템
- 매물 등록 시 단지·평형별 **peer median**으로 기준 실거래가 자동 산출
- 할인율 자동 계산 (5% 이상 = 급매 분류)
- 매물 등록 → AI 리포트 자동 생성 (가격·매물·위치·사진·종합 의견 5개 파트)

### 2. 급매 리포트 (`/report`)
시장 통계 8개 영역 — 모두 인터랙티브:
- 상단 헤드라인 카드 4개 (급매 압력 / 할인 강도 / 주목 지역 / 거래 모멘텀)
- 프리미엄·할인 분류 카드 (17개 시도 양분)
- 지역별 시세 대비 등락 차트 (평균 + 중앙값 점)
- 월별 거래량·급매 추이 (부분월 점선·음영)
- 면적대별 시장 분포 (중앙값 + 급매비율 + 표본)
- 급매 레이더 4탭 (거래량 / 급매비율 / 평균할인 / 중앙값)
- 급매 집중 단지 Top 10
- AI 시장 분석 (Gemini 2.5 자동 생성)

### 3. 지도 검색 (`/map`)
- Google Maps + 마커 클러스터링
- 매물 핀 클릭 → 상세 진입

### 4. 사용자 시스템
- Supabase Auth (이메일 + 6자리 OTP, Google·Kakao OAuth)
- 5단계 역할 (user / seller / agent / admin / owner)
- 중개사 portal (가입 신청 → 승인 → 매물 등록 → 관리)
- 운영자 admin (매물 검증, 사용자 관리)

---

## 차별점

### Peer median 기반 정직한 할인율
같은 단지 + 같은 면적대의 1년 중앙값을 peer 기준으로 사용. 표본 3건 미만 단지는 할인율을 null 처리해 통계 신뢰성 확보.

```
할인율 = (peer median − 거래가) / peer median × 100
peer median = 같은 단지·면적 1년 중앙값 (표본 3건↑일 때만)

양수 = 할인 우세
음수 = 프리미엄 (또래보다 비싸게 거래)
5% 이상 할인 = 급매 분류
```

### Outlier 분리 — 평균 vs 중앙값 동시 표시
서울 평균 할인율 **-32.8%**는 강남 신축의 초고가 거래(outlier)가 평균을 끌어내린 결과. 일반 매물의 중앙값은 **-1.1%**로 거의 시세대로 거래됨.

| 지역 | 평균% | 중앙값% | 해석 |
|---|---:|---:|---|
| 서울 | -32.8 | -1.1 | 강남 신축 outlier가 평균을 흔듦 |
| 제주 | -14.4 | 0.0 | 럭셔리 한두 거래 outlier |
| 경기 | -4.3 | 0.0 | 신도시 일부가 평균 끌어내림 |
| 전라남 | +6.2 | +1.1 | 실제 할인 우세 (양수 일관) |

→ **평균만 보면 "서울 -33% 폭락?"으로 오해되는 데이터를 정직하게 분리해 표시.**

### AI 안전 설계
부동산은 자본시장법 위험이 있어 AI 생성 콘텐츠를 엄격히 통제:

| 보호 장치 | 구현 |
|---|---|
| 출력 형식 강제 | Vercel AI SDK + Zod schema (`generateObject`) |
| 예측 표현 금지 | "오를"·"전망"·"예상" 등 시스템 프롬프트로 차단 |
| 권유 표현 금지 | "사세요"·"매수 적기"·"추천" 등 차단 |
| 수치 hallucination 방지 | "주어진 데이터에서만 인용" 강제 |
| 면책 라벨 | LLM 출력 아닌 UI 정적 텍스트로 일관 |
| 비용 폭발 방지 | DB 캐시 + 락 패턴 + force 트리거 secret 보호 |

### 데이터 검증 스크립트
모든 통계의 정직성을 일회성 검증 스크립트로 입증:
- `verify-report-snapshot.mjs` — Top 10 단지가 진짜 CSV에 있는지 추적
- `verify-region-discount.mjs` — 17개 시도 평균 vs 중앙값 차이 (outlier 영향)
- `verify-price-trends.mjs` — 1,107 구·평형 그룹별 충실도

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React 18, Vite, React Router |
| Styling | CSS 토큰 시스템 (tokens.css + tokens.js 단일 진실원) |
| 차트 | Recharts |
| 백엔드 | Supabase (Auth + Postgres + Storage + RLS) |
| API | Vercel serverless functions |
| AI | Vercel AI SDK + Gemini 2.5 Flash (Vertex AI / AI Studio fallback) |
| 지도 | Google Maps Platform |
| 검증 | Zod schema |
| 배포 | Vercel |
| 데이터 처리 | Node.js (iconv-lite, csv-parse) |

---

## 아키텍처

### 데이터 흐름

```
국토부 CSV (17개 시도, CP949 인코딩, 약 108MB)
  │
  ├─ import-trades-csv.mjs  (peer median 집계)
  │   → src/data/marketData.json (9.9KB)
  │   → src/data/complexLookup.json (8.5MB)
  │
  ├─ build-market-snapshots-seed-sql.mjs
  │   → supabase/seed/market_snapshots_seed.sql
  │   → (Supabase Dashboard SQL Editor paste)
  │
  ├─ build-price-trends.mjs  (구·평형·월별 시계열)
  │   → scripts/output/price_trends.csv
  │   → (Supabase Table Editor CSV import)
  │
  └─ build-complex-prices.mjs  (단지·평형 중앙값)
      → scripts/output/complex_prices.csv
      → (Supabase Table Editor CSV import)
```

### 매물 등록 흐름

```
중개사 등록 폼 (AgentRegisterProperty.jsx)
  │
  ▼
propertyRegistration.js
  │ ├─ resolveReferencePrice (단지·구로 complex_prices → 기준 실거래가)
  │ └─ fetchPriceHistory (구·평형으로 price_trends → 13개월 추이)
  │
  ▼
properties INSERT (price_history JSONB 스냅샷 포함)
  │
  ▼
triggerReportGeneration() (백그라운드)
  │
  ▼
api/property-report.js
  ├─ Gemini 호출 + Zod schema 강제
  └─ property_reports UPSERT (캐시)
```

### AI 시장 분석 흐름

```
/report 페이지 mount
  │
  ▼
fetchMarketReport() → Supabase ai_market_reports SELECT
  │
  ├─ 'ready' → 카드 렌더 (캐시 hit)
  └─ 없음 → 섹션 자체 안 렌더

[관리자 갱신]
GET /api/market-report?force=true&secret=XXX
  │
  ▼
api/market-report.js
  ├─ secret 검증
  ├─ market_snapshots 7개 키 fetch (시장 데이터 패키지)
  ├─ Gemini 호출 + 시스템 프롬프트 (예측/권유 금지 강제) + Zod schema
  └─ ai_market_reports UPSERT
```

---

## 디렉토리 구조

```
src/
  pages/             라우트 페이지 (Home, Properties, MapPage, Report, Login, ...)
  components/        재사용 컴포넌트
    report/          급매 리포트 전용 (AiMarketReport, RegionRadar)
    trends/          시세 동향 페이지 (보류 — 코드 보존)
  services/          데이터 fetch + 매물 등록 흐름
  utils/             헬퍼 (priceUtils, regionName, trendStats)
  context/           AuthContext (Supabase Auth wrapper)
  hooks/             custom hooks
  styles/            토큰 (tokens.css/.js) + 글로벌 + 컴파스 톤
  data/              정적 데이터 JSON (gitignored)

api/
  property-report.js  매물 AI 리포트 (Gemini)
  market-report.js    시장 분석 AI (Gemini)
  lookup-lifestyle.js 생활권 (Places API)

supabase/
  migrations/        DB 스키마 (23개)
  seed/              시드 SQL

scripts/
  import-trades-csv.mjs              CSV → marketData.json
  build-market-snapshots-seed-sql.mjs JSON → seed SQL
  build-price-trends.mjs             구·평형·월별 시계열
  build-complex-prices.mjs           단지·평형 중앙값
  verify-*.mjs                       데이터 정직성 검증 (4개)
  data/                              국토부 CSV 17개 시도 (gitignored, 약 108MB)
```

---

## 로컬 개발

### 환경변수

#### `.env` (클라이언트)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_MAPS_API_KEY=...
VITE_GOOGLE_PLACES_API_KEY=...
```

#### Vercel Environment Variables (서버)
```
SUPABASE_SERVICE_ROLE_KEY=...
GCP_PROJECT_ID=...           # Vertex AI 우선 (있으면)
GCP_CLIENT_EMAIL=...
GCP_PRIVATE_KEY=...
GCP_LOCATION=asia-northeast3
GEMINI_MODEL=gemini-2.5-flash  # 선택, 기본값
AI_GATEWAY_API_KEY=...       # Vertex 없을 때 fallback
MARKET_REPORT_SECRET=...     # 시장 AI 트리거 보호
```

### 실행
```bash
npm install
npm run dev       # 개발 서버 (Vite, http://localhost:5173)
npm run build     # 프로덕션 빌드
npm run preview   # 빌드 결과 미리보기
```

### 데이터 갱신 (수동, 6단계)
1. 국토부 실거래가 공개시스템에서 17개 시도 CSV 다운로드
2. `scripts/data/`에 배치
3. `node scripts/import-trades-csv.mjs` → marketData.json + complexLookup.json
4. `node scripts/build-market-snapshots-seed-sql.mjs` → seed SQL
5. `node scripts/build-price-trends.mjs` + `build-complex-prices.mjs`
6. Supabase Dashboard에서 SQL paste + CSV import

> 자동화는 향후 작업. 현재 MVP는 수동 갱신.

---

## 라이센스 / 데이터 출처 / 면책

- **데이터**: 국토교통부 실거래가 공개시스템 (공공데이터)
- **사용 범위**: 정보 제공 목적의 통계·진단
- **법적 한계**: 본 사이트의 모든 분석은 과거 데이터 패턴 설명이며, **매수·매도 권유나 미래 가격 예측이 아닙니다**. 투자 의사결정은 본인 책임 하에 진행하시기 바랍니다.

---

## 스크린샷

> 발표 자료용 — 다음 화면 캡처 권장:
> - `/` 홈 (Hero + 검색)
> - `/properties` 매물 목록 (필터 + 카드 그리드)
> - `/properties/:id` 매물 상세 (AI 리포트 5개 파트)
> - `/map` 지도 검색
> - `/report` 급매 리포트 (헤드라인 4 + 분류 카드 + 차트들 + AI 분석)
