# 급매 (Geupmae)

> **국토교통부 실거래가로 검증된 부동산 급매 플랫폼**
> 호가가 아닌 *실거래가* 기준으로, 시세보다 5% 이상 저렴한 아파트 매매 급매물만 골라 검증해 보여줍니다.

🔗 **Live**: [guepmae.vercel.app](https://guepmae.vercel.app)
📄 **기획서(한 장 요약)**: [docs/PLAN.md](docs/PLAN.md) — 서비스·기술·현황·로드맵을 한 파일에

---

## 문제 의식

부동산 매물의 "급매"·"초급매"는 대부분 **중개사의 주관적 표현**입니다. 정작 매수자는 *이 가격이 진짜 싼 건지* 알기 어렵습니다.

**급매**는 이 검증을 자동화합니다 — 국토교통부 실거래가 데이터로 **같은 단지·같은 전용면적의 실제 거래 중앙값**을 구하고, 그 대비 할인율이 일정 기준(5%+)을 넘는 매물만 "검증된 급매"로 노출합니다. 추측·과장 없이, 공공 데이터로 증명합니다.

---

## 핵심 기능

| 기능 | 설명 |
|---|---|
| **실거래가 검증 할인율** | 동일 단지·전용면적의 국토부 실거래 중앙값 대비 할인율 자동 산출. 해제·직거래 제외 → 최근 12/24/36개월 → 같은 층 구간 순으로 비교 대상을 고르고, 표본 3건 미만이면 숫자 대신 **판정 보류**. 산출 조건(기간·층·제외·표본)까지 투명 공개 |
| **단지별 실거래 표** | 매물 상세에 평형별 실거래 요약 + 최근 실거래 내역(계약일·층·거래가). **추정 없이 실거래만** |
| **AI 매물 리포트** | 가격·입지·사진을 분석하는 LLM 리포트. 가격은 새로 만들지 않고 실데이터에 그라운딩, 중개사 주장은 교차검증 |
| **지도 검색** | 카카오맵(키 없으면 OpenStreetMap) 위 매물 클러스터링, "로드뷰 길" 표시, 생활권(편의시설·역세권 실도보 거리) 분석 |
| **360 실내 투어** | 중개사가 올린 360 사진을 찍은 순서대로 화살표로 이동하며 둘러보는 투어. 360 사진이 없으면 집 앞 로드뷰(카카오) → 등록 사진 순으로 폴백 |
| **시세 추이** | 단지·평형별 실거래 추이 차트 |
| **중개사 포털** | 권한 계층(대표·관리자·중개사·회원) 기반 매물 등록·관리. 내 매물의 조회·문의 수(최근 30일) 표시 |
| **파일럿 지표** | 등록 매물 · 알림 신청 · 문의 전환율 · 유료 의향을 관리자 화면에서 기간별로 확인, CSV 내려받기. 조회·문의는 **방문자를 식별하지 않고** 매물별 일별 합계로만 집계 |

---

## 기술 스택

- **Frontend** · React 18 · Vite (SPA) · React Router · Recharts · Lucide
- **데이터 (로컬 데모 모드)** · 번들 JSON 스냅샷 + 브라우저 localStorage — 백엔드 없이 단독 실행
- **AI** · Google Gemini (`generateObject` 구조화 출력 + Zod 스키마) — 대표 매물 리포트 사전 생성·번들
- **지도** · 카카오맵 JavaScript SDK (지도 · 로드뷰 · 지오코딩) — 키가 없으면 Leaflet + OpenStreetMap
- **데이터 파이프라인** · 국토교통부 OpenAPI · Node.js(집계) · Python(수집)

> 원래 **Supabase**(PostgreSQL · RLS · Auth · Storage) + **Vercel 서버리스**로 구축했으나,
> 백엔드 없이 누구나 `npm install` 한 번으로 전체 앱을 실행할 수 있도록 **로컬 데모 모드**로 전환했습니다.
> 데이터 접근 인터페이스(`src/lib/dataClient.js`)를 동일하게 유지해, 서비스 코드 변경을 최소화하면서
> 읽기는 번들 JSON, 쓰기(매물 등록·중개사 신청·인증)는 localStorage 로 동작합니다.
>
> 여기에 **하이브리드 모드**를 얹었습니다 — `.env.local` 에 `VITE_SUPABASE_URL` +
> `VITE_SUPABASE_PUBLISHABLE_KEY` 를 설정하면 인증(가입·로그인·세션)과 쓰기(매물 등록·중개사
> 신청·회원 관리)가 실제 Supabase(무료 티어)로 동작합니다. 운영 매물은 RLS로 조회하고,
> 단지 검색·개별 실거래·시세 추이·시장 리포트도 갱신된 DB를 읽습니다. 연결 실패를
> 오래된 번들로 숨기지 않습니다. 매물 저장과 승인은 서버에서 검증합니다.
> 운영 실거래 갱신 절차는 [데이터 파이프라인 기록](docs/audits/2026-10-15-p1-market-data.md)을 따릅니다.

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

1. **수집** — `fetch-trades.py` : 국토부 상세 API를 전국 254개 시군구 × 최근 36개월로 호출(약 150만 건). 취소(해제) 거래 필터, 거래유형(중개/직거래) 수집, 행정구역 개편(특별자치도 코드 변경·일반구 신설) 예외 처리.
2. **집계** — 단지+전용면적별 실거래 중앙값(`complex_prices`, 직거래 제외), 평형대×월 시세 추이(`price_trends`), 단지별 개별 실거래(`complex_trades`) 산출 → `build-complex-trades-rows.mjs` 로 단지×면적 거래 배열(`complex_trades_rows.json` 전체 + `public/data/complex_trades.json` 상위 4,000행).
3. **매물 등록·번들** — `import-listings.py` 로 단지명 매칭 → 급매 선별 → 정밀 지오코딩 → 실거래 표를 매물에 베이크 → `recompute-price-basis.mjs --all --write` 로 판정 규칙(해제·직거래 제외 → 최근 12/24/36개월 → 층 구간 → 중앙값, 표본 부족은 보류 제외)을 적용해 `public/data/properties.json` 로 스냅샷.

4. **AI 매물 리포트** — `generate-reports.mjs` 로 대표 매물 리포트를 Gemini 로 사전 생성 → `public/data/property_reports.json` 로 번들.
5. **AI 시장 리포트** — `generate-market-report.mjs` 로 `market_snapshots` 를 입력 삼아 시장 인사이트 3~5개를 사전 생성 → `public/data/ai_market_reports.json` 로 번들.
6. **매일 증분 수집 (GitHub Actions)** — `.github/workflows/daily-trades-refresh.yml`은 현재 국토부 행정구역 목록을 사용합니다. 36개월 원본 중 최근 3개월을 재수집하고, 단지 가격·개별 거래·지역 추이·12개월 리포트를 한 트랜잭션으로 갱신합니다. 원본은 비공개 `pipeline-data/market-v1/cache.zip`에 보관합니다. 누락·해시 불일치·적재 실패 시 기존 공개 데이터가 유지됩니다. `TRADES_REFRESH_ENABLED=true`인 경우 매일 한국 03:30에 실행합니다.
7. **판정 규칙 백테스트** — `node scripts/backtest-price-basis.mjs` : 과거 실거래 한 건을 "그 달에 그 가격으로 나온 매물"로 보고, 그 달보다 앞선 거래만으로 기준가를 구해(운영 판정 함수를 그대로 호출) 실제 거래가와 비교한다. 급매로 판정된 거래가 이후 6개월 시세로 봐도 쌌는지(정밀도·재현율), 규칙의 각 요소(기간 창·층 구간·직거래 제외)가 정확도를 얼마나 바꿨는지를 요약 문서로 낸다. 호가가 아니라 체결가로 채점한다는 한계를 리포트에 명시.
8. **파이프라인 검증** — `node --test scripts/market-dataset.test.mjs supabase/tests/market-publish.test.mjs`와 `python -m unittest scripts/test_fetch_market_trades.py scripts/test_fetch_report_trades.py`. 원본 완결성, 동명 단지 분리, 제외 거래, 층별 판정, 익명 권한 거부, 적재 실패 롤백을 확인합니다. 기존 `scripts/rehearsal/rehearse.py`는 이전 CSV 파이프라인용이며 현재 워크플로 검증에 사용하지 않습니다.

---

## 급매 리포트 갱신

Node 22.12 이상과 Python 3.11 이상, `.env.local`의 `MOLIT_API_KEY`가 준비돼 있으면 `npm run report:refresh`로 지난달까지 12개월의 전국 실거래를 수집하고 리포트 번들을 갱신합니다. 키와 원본 CSV는 Git에 포함하지 않습니다.

수집이 모두 완료된 경우에만 집계하며, 해제·직거래를 제외하고 같은 지역·단지·정확한 전용면적의 거래를 비교합니다. 거래량·급매비율·지역 및 단지 순위가 같은 기간을 사용합니다. 표본 부족 건수와 계산 조건은 리포트에 공개합니다. 이전 데이터로 생성한 AI 요약은 새 집계와 일치하지 않으면 표시하지 않습니다.

기존 매일 시세 갱신 Actions와는 별도 경로입니다. 자세한 기준과 검증 결과는 [리포트 집계 수정 기록](docs/audits/2026-10-13-p1-market-report.md)을 참고하세요.

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
VITE_KAKAO_APP_KEY=...              # 지도(없으면 OpenStreetMap), 매물 등록 시 주소→좌표, 360 투어 없는 매물의 로드뷰 (없으면 사진 폴백)
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
