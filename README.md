# 급매 (Geupmae)

> **국토교통부 실거래가로 검증된 부동산 급매 플랫폼**
> 호가가 아닌 *실거래가* 기준으로, 시세보다 5% 이상 저렴한 아파트 매매 급매물만 골라 검증해 보여줍니다.

🔗 **Live**: [guepmae.vercel.app](https://guepmae.vercel.app)

---

## 문제 의식

부동산 매물의 "급매"·"초급매"는 대부분 **중개사의 주관적 표현**입니다. 정작 매수자는 *이 가격이 진짜 싼 건지* 알기 어렵습니다.

**급매**는 이 검증을 자동화합니다 — 국토교통부 실거래가 데이터로 **같은 단지·같은 전용면적의 실제 거래 중앙값**을 구하고, 그 대비 할인율이 일정 기준(5%+)을 넘는 매물만 "검증된 급매"로 노출합니다. 추측·과장 없이, 공공 데이터로 증명합니다.

---

## 핵심 기능

| 기능 | 설명 |
|---|---|
| **실거래가 검증 할인율** | 동일 단지·전용면적의 국토부 실거래 중앙값 대비 할인율 자동 산출. 산출 근거(표본 수·기간)까지 투명 공개 |
| **단지별 실거래 표** | 매물 상세에 평형별 실거래 요약 + 최근 실거래 내역(계약일·층·거래가). **추정 없이 실거래만** |
| **AI 매물 리포트** | 가격·입지·사진을 분석하는 LLM 리포트. 가격은 새로 만들지 않고 실데이터에 그라운딩, 중개사 주장은 교차검증 |
| **지도 검색** | 매물 좌표 클러스터링, 생활권(편의시설·역세권 실도보 거리) 분석 |
| **시세 추이** | 단지·평형별 실거래 추이 차트 |
| **중개사 포털** | 권한 계층(대표·관리자·중개사·회원) 기반 매물 등록·관리 |

---

## 기술 스택

- **Frontend** · React 18 · Vite (SPA) · React Router · Recharts · Lucide
- **데이터 (로컬 데모 모드)** · 번들 JSON 스냅샷 + 브라우저 localStorage — 백엔드 없이 단독 실행
- **AI** · Google Gemini (`generateObject` 구조화 출력 + Zod 스키마) — 대표 매물 리포트 사전 생성·번들
- **지도** · Google Maps Platform (Maps · Places · Geocoding)
- **데이터 파이프라인** · 국토교통부 OpenAPI · Node.js(집계) · Python(수집)

> 원래 **Supabase**(PostgreSQL · RLS · Auth · Storage) + **Vercel 서버리스**로 구축했으나,
> 백엔드 없이 누구나 `npm install` 한 번으로 전체 앱을 실행할 수 있도록 **로컬 데모 모드**로 전환했습니다.
> 데이터 접근 인터페이스(`src/lib/dataClient.js`)를 동일하게 유지해, 서비스 코드 변경을 최소화하면서
> 읽기는 번들 JSON, 쓰기(매물 등록·중개사 신청·인증)는 localStorage 로 동작합니다.

---

## 아키텍처 (로컬 데모 모드)

```
국토부 실거래가 OpenAPI
   │ (전국 시군구 × 최근 3년)
   ▼
[수집] fetch-trades.py
   │
   ▼
[집계] build-complex-prices · build-price-trends · build-complex-trades
   │
   ▼
[번들] public/data/*.json   ◄── import-listings.py (매물)
   │     properties · complex_prices        generate-reports.mjs (AI 매물 리포트)
   │     market_snapshots · property_reports  generate-market-report.mjs (AI 시장 리포트)
   │     ai_market_reports
   ▼
React SPA (Vite)
   ├─ 읽기 → 번들 JSON      (src/lib/dataClient.js 가 fetch 후 정규화)
   └─ 쓰기 → localStorage   (매물 등록·수정 · 중개사 신청 · mock 인증)
```

### 데이터 파이프라인 (`scripts/`)

검증의 신뢰도는 데이터의 정확성에서 나옵니다. 전국 아파트 실거래가를 자동 수집·집계해 기준 시세를 만들고, 백엔드 없이 동작하도록 JSON 으로 번들합니다.

1. **수집** — `fetch-trades.py` : 국토부 상세 API를 전국 254개 시군구 × 최근 36개월로 호출(약 130만 건). 취소(해제) 거래 필터, 행정구역 개편(특별자치도 코드 변경·일반구 신설) 예외 처리.
2. **집계** — 단지+전용면적별 실거래 중앙값(`complex_prices`), 평형대×월 시세 추이(`price_trends`), 단지별 개별 실거래(`complex_trades`) 산출.
3. **매물 등록·번들** — `import-listings.py` 로 단지명 매칭 → 급매 선별 → 정밀 지오코딩 → 산출 근거·실거래 표를 매물에 베이크 → `public/data/properties.json` 로 스냅샷.
4. **AI 매물 리포트** — `generate-reports.mjs` 로 대표 매물 리포트를 Gemini 로 사전 생성 → `public/data/property_reports.json` 로 번들.
5. **AI 시장 리포트** — `generate-market-report.mjs` 로 `market_snapshots` 를 입력 삼아 시장 인사이트 3~5개를 사전 생성 → `public/data/ai_market_reports.json` 로 번들.

---

## 프로젝트 구조

```
public/data/               번들 데이터 스냅샷 (매물·단지 시세·시장 통계·AI 리포트)
src/
  lib/dataClient.js        로컬 데이터 어댑터 (번들 JSON 로드 + localStorage 오버레이)
  pages/                   화면 (홈·매물·지도·리포트·중개사 포털·관리)
  components/              UI 컴포넌트 (매물 카드·리포트 패널·지도·실거래 표 등)
  services/                데이터 접근 · 기준가 산출 · 리포트 조회
  context/  hooks/  utils/ 인증·상태·헬퍼
  styles/                  디자인 토큰 + CSS
scripts/                   데이터 파이프라인 (수집·집계·번들)
```

---

## 로컬 실행

백엔드가 없어 클론 후 바로 실행됩니다.

```bash
npm install
npm run dev      # 개발 서버 (Vite)
npm run build    # 프로덕션 빌드 (정적 SPA — 어디서나 호스팅 가능)
```

`.env.local` (모두 선택 — 없어도 핵심 기능 동작):

```
VITE_GOOGLE_MAPS_API_KEY=...        # 지도 검색 화면
GOOGLE_GENERATIVE_AI_API_KEY=...    # AI 리포트 재생성 (generate-reports.mjs · generate-market-report.mjs)
MOLIT_API_KEY=...                   # 국토부 실거래가 재수집 (fetch-trades.py)
```

### 데모 계정 (mock 인증)

아무 이메일·비밀번호로 로그인되며, 이메일에 포함된 키워드로 권한이 정해집니다.

| 로그인 이메일 | 권한 |
|---|---|
| `owner@geupmae.local` | 대표 — 전체 관리 |
| `agent@geupmae.local` | 중개사 — 매물 등록·관리 |
| 그 외 아무 이메일 | 일반 회원 |

---

## 스크린샷

> 라이브 데모: [guepmae.vercel.app](https://guepmae.vercel.app)
> _(앱 화면 스크린샷은 추후 `docs/` 에 추가)_

---

<sub>데이터 출처: 국토교통부 실거래가 공개시스템 · 모든 분석은 과거 데이터의 패턴 설명이며 투자 권유·미래 가격 예측이 아닙니다.</sub>
