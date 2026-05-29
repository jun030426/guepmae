# 급매(Geupmae) 프로젝트 — 세션 인계 문서

> 작성: 2026-05-30. 이 문서 하나만 읽고 다음 작업을 바로 이어갈 수 있게 작성됨.

---

## 1. 프로젝트 개요

- **서비스명**: 급매 (Geupmae)
- **도메인**: https://guepmae.vercel.app
- **레포**: https://github.com/jun030426/guepmae (main 자동 배포)
- **개발자/Owner 계정**: guepmae@gmail.com (대표자, 모든 권한)
- **작업 디렉토리**: `c:\Users\kigki\OneDrive\바탕 화면\창업동아리\새롭게만드는거`

**한 줄**: 국토부 실거래가 대비 5%+ 저렴한 **아파트 매매**(전월세 X, 매매만)만 모은 검증된 급매 플랫폼. 창업동아리 프로젝트로 주제는 **"재활용/재생산"** — 국토부 공공데이터를 재활용하고, 데이터 공백 지역은 주변 시세로 재생산.

**핵심 가치**: "**국토부 실거래가로 증명된 급매**" — 검증·신뢰가 최우선. 추측·과장 금지.

**역할 계층 (4단계)**:
- `owner` (대표자, guepmae@gmail.com 1명) — 전체 권한, 자신 제외 모두 관리
- `admin` (관리자) — user↔agent 권한 변경, 정지
- `agent` (중개사) — 매물 등록
- `user` (일반회원) — 조회

자기 자신 권한 변경/정지 불가. owner는 어디서든 superset.

---

## 2. 기술 스택 / 환경

**프론트엔드**: React 18 + Vite (SPA, static export → dist/)
**백엔드**: Vercel Serverless Functions (`api/*.js`, ESM)
**DB/Auth/Storage**: Supabase (Postgres + JSONB + RLS + Storage public bucket)
**지도/위치**: Google Maps Platform (Maps JS, Places, Geocoding, Distance Matrix)
**AI**: Google Gemini 2.5 Flash via `@ai-sdk/google` (Vercel AI Gateway 키)
- Vertex AI provider도 코드에 추가됨 (`@ai-sdk/google-vertex`), GCP 서비스계정 env 있으면 그쪽 사용 — **현재 미사용**(서비스계정 키 생성이 조직 정책에 막힘, 아래 7번 참조)

**주요 패키지**(this session 기준):
- `ai ^6.0.191`
- `@ai-sdk/google ^3.0.79`
- `@ai-sdk/google-vertex ^3.0.140` (추가)
- `@supabase/supabase-js`, `react-router-dom`, `recharts`, `lucide-react`, `zod`, `iconv-lite`, `csv-parse`

**명령어**:
```bash
npm run dev      # 로컬 개발 (Vite)
npm run build    # dist/ 빌드
# 테스트: 별도 테스트 스위트 없음. 빌드 통과 + 수동 검증으로 진행
node --check api/property-report.js   # 서버 함수 문법 검사 (Vite는 api/ 안 봄)
```

**환경변수**(Vercel):
| Key | 용도 |
|-----|------|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | 클라이언트 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 서버리스 |
| `VITE_GOOGLE_MAPS_API_KEY` | 클라 지도 (HTTP referrer 제한 풀려 있음 — 서버 호출도 허용) |
| `GOOGLE_PLACES_API_KEY` | 서버 Places/Geocoding (없으면 VITE_* fallback) |
| `AI_GATEWAY_API_KEY` | Gemini API 키 (현재 사용) |
| `GEMINI_MODEL` | (선택) 기본 `gemini-2.5-flash` 오버라이드. Pro 쓰려면 `gemini-2.5-pro` |
| `GCP_PROJECT_ID`, `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`, `GCP_LOCATION` | **미설정** — Vertex 활성화용 (조직 정책으로 보류) |

**디렉토리 구조 (핵심)**:
```
api/
  property-report.js          # AI 리포트 생성/캐시/락 (Gemini)
  lookup-lifestyle.js         # 주소 → 좌표+생활권+region+역세권 (Places+DistanceMatrix+Geocoding)
src/
  pages/
    Home.jsx                  # 홈 (HeroSearch)
    Properties.jsx            # /properties 목록
    PropertyDetail.jsx        # /properties/:id 상세
    MapPage.jsx               # /map
    Report.jsx                # /report 시장 리포트
    Login.jsx                 # /login (OTP 회원가입 + 비밀번호 재설정)
    AgentLanding.jsx          # /agent (중개사 portal 입구)
    AgentSignup.jsx           # /agent/signup (가입+신청 통합)
    AgentDashboard.jsx        # /agent/dashboard
    AgentRegisterProperty.jsx # /agent/properties/new (신규 등록)
    AgentMyProperties.jsx     # /agent/properties (내 등록 매물 — NEW this session)
    AgentEditProperty.jsx     # /agent/properties/:id/edit (NEW this session)
    Admin.jsx                 # /agent/admin (owner+admin 운영)
  components/
    Header.jsx                # 일반 사이트 헤더
    AgentHeader.jsx           # 급매 PRO 헤더 (별도)
    PropertyCard.jsx, PropertyMediaViewer.jsx, PropertyReportPanel.jsx,
    PropertyLocationMap.jsx (client 지오코딩 + fallback 격리 수정됨),
    PriceReport.jsx (1년 추이 차트),
    MapView.jsx, RequireRole.jsx, SocialLoginButtons.jsx (소셜 준비중),
    ComplexAutocomplete.jsx (NEW — 단지명 자동완성),
    ConfirmDialog.jsx (NEW — 공용 중앙 확인 모달),
    CommuteSearch.jsx (NEW but 미사용 — 한국 길찾기 API 연동 시 재활성)
  services/
    propertiesRepository.js   # fetchProperties (+direction, occupancyStatus, createdAt 추가됨)
    propertyRegistration.js   # 등록 + resolveReferencePrice + price_history 스냅샷 + Vertex/AI Studio provider 추상화
    propertyReports.js        # 리포트 fetch (status='ready'만 캐시 사용, 202 generating 처리)
    userManagement.js, agentApplications.js, reportData.js
  hooks/useProperties.js      # refresh() 포함
  context/AuthContext.jsx     # +requestPasswordReset, verifyRecoveryOtp, updatePassword
  utils/
    googleMapLoader.js        # libraries=places 추가됨
    propertyMedia.js, priceUtils.js (formatArea·sqmToPyeong·pyeongToSqm 추가)
    phoneFormat.js
  styles/
    tokens.css, global.css, compass-phase1.css (대부분 수정 여기)
scripts/
  import-trades-csv.mjs       # 국토부 CSV → marketData.json + complexLookup.json (모든 CSV 병합으로 수정됨)
  build-price-trends.mjs      # NEW — 구+평형+월 추이 + 재생산 (1순위 단지 / 2순위 시군구 fallback의 시군구 측면)
  build-complex-prices.mjs    # NEW — 단지+구+평형 median + built_year 집계
  generate-properties.mjs, build-properties-seed-sql.mjs, build-market-snapshots-seed-sql.mjs
  data/                       # raw 국토부 CSV (gitignored) — 사용자가 17개 지역 1년치(556,907건) 넣음
  output/                     # 집계 CSV (gitignored) — Supabase 업로드용
supabase/migrations/
  (...기존 migrations...)
  20260529100000_price_trends_table.sql (NEW)
  20260530000000_owner_can_insert_properties.sql (NEW)
  20260530010000_complex_prices_table.sql (NEW)
  20260530020000_agent_own_property_management.sql (NEW)
  20260530030000_complex_prices_built_year.sql (NEW)
  20260530040000_property_direction_occupancy.sql (NEW)
  20260530050000_property_reports_status.sql (NEW)
```

**Supabase 테이블** (this session 기준):
- `properties` — 매물. +`direction`, `occupancy_status` 컬럼 추가됨. `price_history` JSONB에 1년 추이 스냅샷 저장
- `property_reports` — AI 리포트 캐시 (1매물 1리포트). +`status` 컬럼 (`'ready'`/`'generating'`) 락용
- `price_trends` (NEW) — 구+평형+월 추이. 14,391행 (실제 12,151 + 재생산 2,240). RLS: 공개 SELECT
- `complex_prices` (NEW) — 단지+구+평형 median + built_year. 48,241행. 단지명 trigram 인덱스(pg_trgm)
- `profiles`, `seller_verifications`, `agent_applications`, `market_snapshots` — 기존
- Storage: `property-photos` (public), `agent-application-documents` (private)

**git**: main 직접 push. Claude가 직접 push 가능 (`.claude/settings.local.json`에 `Bash(git push:*)` 허용 추가됨). Vercel이 main을 감시하여 자동 배포 = "push가 곧 재배포".

---

## 3. 이번 세션 작업 내역 (시간 순서 + 이유)

### 3-1. 비밀번호 재설정 기능 (OTP)
**왜**: 사용자가 "대표자면 다른 사람 비번 보이게 하자" 요청 → 비번은 단방향 해시라 기술적으로 불가 + 보안상 절대 안 됨 설명 → 대신 **본인 직접 재설정** 흐름이 정답. 회원가입과 동일한 6자리 OTP로 톤 통일.

- `AuthContext.jsx`: `requestPasswordReset`, `verifyRecoveryOtp`, `updatePassword` 추가 (Supabase auth.resetPasswordForEmail + verifyOtp type:'recovery' + auth.updateUser)
- `Login.jsx`: 이메일 로그인 폼 아래 "비밀번호를 잊으셨나요?" 링크 + 3단계 UI (이메일→OTP→새비번)
- 자동 리다이렉트 가드 추가 (복구 세션 중에 nav 안 됨)
- Supabase Email Template **"Reset Password"** 도 `{{ .Token }}`으로 교체 필요(사용자 직접 함). 제목: `[급매] 비밀번호 재설정 인증 코드 [{{ .Token }}]`
- 회원가입 메일 제목도 동일 패턴: `[급매] 회원가입 인증 코드 [{{ .Token }}]`

### 3-2. Claude push 권한 추가
- `.claude/settings.local.json`에 `"Bash(git push:*)"` 추가 → Claude 직접 push 가능
- 이전 정책상 main 직접 push가 차단됐었음

### 3-3. 매물 상세 지도 fallback 줄무늬 페이지 번짐 + 좌표 없을 때 지도 안 뜸
**증상**: 회색 대각선이 페이지 전체로 번지고, 등록한 매물 지도가 안 뜸.
**원인**: `.detail-map-fallback`에 CSS가 없어서 `.map-line.diagonal`(width:120%, rotate)이 페이지 전체 기준으로 절대배치 → 번짐. 그리고 좌표 없는 매물(이전 등록분)은 `FallbackSketch`로 떨어짐.
**수정**: `PropertyLocationMap.jsx`에서
1. fallback의 wrapper 클래스를 격리된 `.detail-map-visual`(이미 overflow:hidden 있음)로 교체 → 줄무늬 페이지 번짐 해결
2. 좌표 없으면 **브라우저에서 Google Geocoder로 주소를 직접 지오코딩**하여 진짜 지도 표시 (저장된 좌표 없어도 작동)

### 3-4. 운영 관리 confirm 대화상자 → 중앙 모달
**왜**: 네이티브 `confirm()`이 화면 상단에 뜨는 게 보기 안 좋다.
**수정**: `Admin.jsx`에 인라인 `ConfirmDialog` 컴포넌트 (그 후 별도 `src/components/ConfirmDialog.jsx`로 추출). 매물 반려/검증취소/사용자 권한변경/정지/신청승인 모두 중앙 모달로. 위험 동작은 빨강 강조(`danger` prop).
- 단, **handleRejectApplication**(중개사 신청 거부)는 prompt()로 사유 입력받아서 native prompt 유지 (텍스트 입력 모달은 미구현)

### 3-5. AgentHeader nav active 버그
**증상**: "새 매물 등록" 누르면 "내 등록 매물"도 같이 active.
**원인**: NavLink가 prefix 매칭. `/agent/properties`(내 등록)가 `/agent/properties/new`(새 등록)의 prefix.
**수정**: `AgentHeader.jsx` AGENT_NAV에 `end: true` 플래그 추가. `'/agent/properties'`와 `'/agent/dashboard'`에 end 적용.

### 3-6. 1년 실거래가 추이 시스템 구축 (대형 작업)
**배경**: 등록 매물의 "최근 6개월 실거래가 추이" 차트가 비어있었음. 등록 시 `price_history: []`로 저장됐기 때문. 사용자가 1년치 국토부 데이터(17개 지역 CSV) 제공.

**파일명 정리**: 17개 중 4개가 서로 바뀜(경기↔충북, 경남↔제주). 데이터 안의 시도로 자동 감지해서 rename (`scripts/data` 안에서). 총 556,907건.

**디자인 결정**:
- 6개월 → **1년 추이**로 (데이터가 정확히 1년치라 자연스러움. 차트에서 한 줄로 바꾸기 쉬워 부담 없음)
- **1순위 단지+평형 → 2순위 구+평형** fallback
- **단위 결정**: 시군구 동(洞)까지는 데이터가 너무 sparse → **구/시/군 레벨**(동/읍/면/리 제거)로 롤업. toGu 함수: 동/읍/면/리 suffix를 시·군·구 도달까지 반복 제거 (춘천시 동면 같은 4단계 농촌 주소 처리)
- **재생산 공식**: `추정가(월) = 그 구·평형 실거래 중앙값 × (시도·평형 그 달 중앙값 ÷ 시도·평형 연간 중앙값)` — "주변(시도) 추세 × 해당 구의 가격 수준 보정"

**산출물**: `scripts/build-price-trends.mjs` → `scripts/output/price_trends.csv` (14,391행 / 1.09MB, 실제 12,151 + 재생산 2,240, 15.6%만 재생산)

**테이블/코드**:
- migration: `20260529100000_price_trends_table.sql` (price text/bigint, status는 별도 X — status는 property_reports에 추가)
- `propertyRegistration.js`: 등록 시 Geocoding에서 시도+구 추출 → price_trends 13개월 조회 → `price_history` 스냅샷 저장
- `PriceReport.jsx`: "최근 1년" 제목, 실제=채운 빨강 점, 재생산=빨강 테두리 빈 점, 범례 + 데이터 없음 empty state
- `api/lookup-lifestyle.js`: Geocoding `address_components`에서 시도+구를 정렬(시→군→구)로 합쳐 `region.gu` 반환. price_trends.gu 형식과 100% 일치

### 3-7. 단지+평형 기준 실거래가 (기준가 산출)
**왜**: 등록 폼에 "기준 실거래가" 수동입력이 있었음 — 중개사가 마음대로 넣으면 할인율 조작 가능. 검증 정체성 무너짐.
**구분**: **구 median은 너무 거칠다** (강남 60-85㎡가 17억~30억). 같은 평형이라도 단지별 가격차 큼 → 정확한 할인율 = 같은 단지·같은 평형 비교.

**산출물**:
- `scripts/build-complex-prices.mjs` → `complex_prices.csv` (48,241행 / 5.33MB)
  - 동명 단지(예: 주공) **지역별 분리** 필수 (complexLookup.json은 지역 구분 없이 합쳐서 안 씀)
  - `built_year` 컬럼 추가됨 (단지별 최빈값) → 단지 자동완성 선택 시 폼의 건축연도 자동 채움
- migration: `20260530010000_complex_prices_table.sql` (+`built_year` 추가는 `20260530030000_complex_prices_built_year.sql`)
- `pg_trgm` 확장 + 단지명 trigram GIN 인덱스 (자동완성 ILIKE용)
- `ComplexAutocomplete.jsx`: ILIKE %query% 검색, 8개 결과, complex+gu 중복 제거
- `propertyRegistration.resolveReferencePrice({complexName, gu, areaBucket})`:
  1. **1순위**: complex_prices의 (complex, gu, area_bucket) median → source 'complex'
  2. **2순위 (재생산)**: price_trends의 (gu, area_bucket) 최근월 → source 'region'
  3. 둘 다 실패 → null → 등록 시 매도호가 그대로 사용 (할인율 0)
- `AgentRegisterProperty.jsx`: 기준 실거래가 수동입력 칸 제거, 미리보기 박스 + 출처 배지 (단지 실거래/지역 시세 추정)
- **단지명은 선택**(필수 X). 안 고르면 구 fallback.

### 3-8. 등록 폼 간소화 (사용자 요청 다회)
| 필드 | 처리 | 이유 |
|------|------|------|
| 지역(시·구) | 제거 | 주소 Geocoding으로 자동 (lookupResult.region.gu) |
| 중개사무소명, 연락처 | 제거 | profile + 승인 신청서(agent_applications.office_name) 자동 |
| 공급면적 | 제거 | 전용면적 × 1.33 자동 추정 |
| 향 | 한 번 제거 후 재추가 | 한국 매수자가 중시하는 정보 |
| 거주 상태 | 추가 | 공실/세입자/집주인 select |
| 관리비, 입주가능 | 제거 | 정보 가치 낮음 |
| 면적 단위 | ㎡/평 토글 | 평수로 입력해도 ㎡로 환산 저장 (canonical) |
| 단지명 | 선택+자동완성 | 위 3-7 |
| 매도사유 | 드롭다운 → 자유 텍스트, 매물 설명 바로 위로 이동 | 둘 다 AI 입력. 자유 텍스트가 풍부 |
| 모든 필수 필드 | 미입력 시 그 필드 아래 빨강 메시지 + scroll/focus | UX |

`registerProperty`: `region` 자동 = `form.complexSigungu || lookupResult.region?.gu || form.address`. `agent.office` = approved agent_application의 office_name 자동 조회. agent.phone/email = profile에서.

### 3-9. RLS 정책
- migration `20260530000000_owner_can_insert_properties.sql`: owner도 properties INSERT 가능 + property-photos Storage INSERT/UPDATE/DELETE에 owner 추가
- migration `20260530020000_agent_own_property_management.sql`: agent는 본인 매물(agent->>'email' = profile.email)만 UPDATE/DELETE 가능. admin/owner는 전체.

### 3-10. 내 등록 매물 관리 페이지 (Group 3)
- `AgentMyProperties.jsx`: `/agent/properties` 라우트 변경 (이전엔 AgentDashboard placeholder). useProperties().filter(agent.email===profile.email) + sortByCreatedAt desc. 표: 매물명/지역/매도가/할인율/상태(검증/대기)/등록일/[수정][삭제]
- `AgentEditProperty.jsx`: `/agent/properties/:id/edit`. 자주 바뀌는 필드만(타이틀·매도가·층·방/욕실·주차·설명·향·거주상태·사진). 매도가 변경 시 할인율 자동 재계산(저장된 actual_transaction_price 그대로 사용).
  - **사진 편집**: 기존 사진 썸네일 그리드 + ×버튼 삭제 + 새 파일 추가 → 첫 번째 자동 "대표 사진" 재라벨
  - 저장 후 **AI 리포트 캐시 자동 무효화**(아래 3-11)
- `ConfirmDialog.jsx`: 공용 컴포넌트 (Admin은 자기 내부에 별도 인라인 ConfirmDialog 보유, 미통합 — 작업 시 그대로 둠)

### 3-11. AI 리포트 캐시 무효화 (수정 시 stale 방지)
**왜**: 매물 수정 시 가격/설명이 바뀌면 캐시된 리포트가 stale.
**방식 (lazy invalidation)**: 
- `/api/property-report` POST `{id, invalidate:true}` → service-role로 캐시 행 delete
- `AgentEditProperty` save 성공 → 이 호출 **await 후** navigate (path B GET이 삭제보다 먼저 도달하는 레이스 방지)
- 즉시 AI 재호출 X → 비용 효율 + 다음 조회 때 자연스럽게 재생성

### 3-12. AI 리포트 동시 생성 레이스 락
**문제**: 등록 직후 navigate해서 path A(백그라운드 GET)와 path B(상세 GET)가 동시 발생 → 둘 다 캐시 미스 → AI 2회 호출 (비용 누수). 일반적 케이스라 거의 매번 발생.
**해법**: insert-first lock + stale TTL.
- migration `20260530050000_property_reports_status.sql`: `status text not null default 'ready'`
- `api/property-report.js`: 
  - cache check 시 status='ready'만 캐시로 인정. 'generating'이고 fresh(<3분)면 **202** 반환. stale면 atomic 조건부 update로 takeover (`.eq('status','generating').lt('generated_at', threshold)`)
  - 로우 없으면 `INSERT {status:'generating', report_data:{}}` 시도 → PK(`property_id`) conflict면 다른 요청이 선점 → 202
  - 생성 실패 시 잡은 락 즉시 delete (다음 시도 즉시 가능)
- `propertyReports.js fetchPropertyReport`: 캐시 행 status!=='ready'면 무시, 202면 `{generating:true}` 반환
- `PropertyReportPanel.jsx`: generating 상태 별도 렌더 + 4초마다 폴링

### 3-13. AI 리포트 그라운딩 (정확성·신뢰)
**철학**: "그럴듯하게 틀린 리포트가 정직한 빈 리포트보다 나쁘다."

**변경**:
- `vaiPrice`(AI 적정시세) **제거** — 우리 실거래가/할인율을 그대로 사용 → 리포트 숫자와 사이트 숫자 100% 일치
- `claimCheck` 신설 — 중개사 글(미검증 주장)을 데이터와 대조 (예: "초급매라는데 실 할인율 2%면 담담히 지적")
- SYSTEM_PROMPT 강화: ①가격 새로 만들지 마 ②미래 가격 예측 금지 ③미확인 정보 단정 금지 ④중개사 주장은 검증 ⑤영업/홍보 톤 금지 ⑥(나중 추가) 사진은 보이는 것만
- buildUserPrompt 재구성: 블록을 신뢰도 등급별로 (✅검증된 가격, ✅매물 사실, ⚠️중개사 주장, 📍생활권, 📊비교 매물)
- 분량 제한 해제: 단락/자 수 제한 다 제거. "충분히 상세하게" — 단 추측·반복·과장 금지
- 학군 처리 보완: Places로 이미 잡은 **최근접 학교**는 사실로 사용 가능. 단 **배정 학교·학군 등급**은 데이터 없음 → 단정 금지
- panel 가격 grid를 property 실데이터로 변경 (vaiPrice 자리 → 기준 실거래가). 중개사 주장 검증 블록 추가

### 3-14. 역세권 분류 + 생활권 실제 거리 (Distance Matrix)
**문제**: 처음 만든 역세권 분류가 직선거리 기반 분(分) 파싱이었음. 한국 도시계획 통상 기준은 **반경 500m / 1km(미터)**. 우리는 이미 lookup에서 미터를 계산하는데 버리고 있었음.
**개선**:
- `lookup-lifestyle.js`에 **Google Distance Matrix API** 통합. 모드별(walking/driving) 배치 1회 호출로 6개 카테고리 실제 경로 거리/시간 계산
- 지하철 실제 도보 거리(m) 기준 역세권 분류: ≤500m 초역세권, ≤1km 역세권, ≤1.5km 역 인접, 그 이상 비역세권
- `lifestyle.stationArea` 키 추가 (예: "초역세권 — ○○역 도보 6분 (약 450m)")
- DM 실패 시 직선거리 fallback
- 생활권 라벨(○○역 도보 N분)도 직선거리 추정 → 실제 도보 시간으로 정확해짐
- **신규 등록 매물만 적용** — 기존 매물은 옛 직선거리 라벨 유지 (백필 안 함)
- `api/property-report.js` buildUserPrompt: `property.lifestyle.stationArea` 우선, 없으면 라벨 파싱 fallback

### 3-15. AI 리포트에 사진 기반 컨디션 분석 (Vision)
**왜**: "중개사 글이 아닌 사진(증거)을 AI가 직접 검증" = 검증 정체성에 완벽 부합 + 차별성. 사용자가 ② Vision을 ①Pro와 함께 선택했고, **Vision은 Vertex 없이도 AI Studio Gemini 멀티모달로 가능**.
**구현**:
- `REPORT_SCHEMA.photoAnalysis` 추가 (z.optional()): `overall / lighting / interior / renovation / concerns` 5개 필드
- SYSTEM_PROMPT 규칙 6 추가: 사진에 보이는 것만, 안 보이는 결함 추측 금지, "~로 보임" 신중 표현, 사진 없으면 비워둠
- `generateReport`: `prompt` → `messages: [{role:'user', content:[{type:'text',...}, ...imageParts]}]`. 사진은 최대 6장(토큰 절감), `property.media[].src` (Supabase public URL)를 image part로 전달
- `PropertyReportPanel.jsx`: 가격 분석 다음, 입지 앞에 "📷 사진 기반 컨디션 분석" 섹션 (`r.photoAnalysis` 있을 때만 — 옛 리포트 하위호환)

### 3-16. 인쇄 / PDF 저장 버튼 (리포트 우측 하단)
**문제**: 처음 만든 `@media print { body * visibility:hidden; .property-report position:absolute }` 트릭이 **모달(PropertyMediaViewer) 내부의 transform·overflow와 충돌해 글자 겹침** 발생.
**해법**: **새 창에 리포트만 복제해서 인쇄**.
- 버튼 누르면 `window.open` → 새 창에 `.property-report.outerHTML` + 앱 CSS(`<link>` href를 절대 URL로) 복제
- 새 창 안 스크립트: `window.onload = () => setTimeout(window.print, 400); window.onafterprint = () => window.close();` → 인쇄·취소 어느 쪽이든 새 창 자동 닫힘
- 모달 영향 0, 안정적 다중 페이지 PDF

### 3-17. UI 다듬기
- 히어로 검색창: 알약(pill) 형태 (`border-radius: 999px`). global.css의 `border-radius:0` override를 compass-phase1.css에서 다시 round로 덮음. 검색 버튼도 pill
- 헤더 nav("매물 / 지도 검색 / 급매 리포트"): 절대배치로 페이지 정중앙 정렬 (.header-inner는 flex space-between 유지, .desktop-nav만 absolute + transform: translate(-50%,-50%))
- 같은 .desktop-nav 클래스라 **급매 PRO 헤더(AgentHeader)도 동일하게 가운데** 정렬됨

### 3-18. 면적 ㎡/평 단위 선택
- `priceUtils.js`: `SQM_PER_PYEONG=3.305785`, `sqmToPyeong`, `pyeongToSqm`, `formatArea(sqm)→"84.3㎡ (25.5평)"`
- 등록 폼: areaUnit select (`'sqm'|'pyeong'`), 입력 단위 라벨 동적. 저장은 항상 ㎡(canonical, areaBucket 매칭에도 그대로)
- PropertyDetail: 모든 면적 표시 → formatArea (㎡+평 둘 다)

### 3-19. 길찾기 위젯 (CommuteSearch) — **만들었다가 보류**
**과정**: 처음엔 hub 고정안(④ Routes API to 강남·시청·여의도) → 사용자 제안으로 매수자가 직접 도착지 검색하는 인터랙티브 위젯으로 전환 → 만들었음 (`CommuteSearch.jsx`, Maps JS Directions + Places Autocomplete, 대중교통/자동차 토글, 경로 지도)
**문제 발견(테스트)**: **Google Directions는 한국 내 자동차/도보 길찾기를 안 해줌**(지도 데이터 반출 제한). 자동차=ZERO_RESULTS, 대중교통은 부실. 즉 구글로는 한국 경로 불가.
**보류 결정**: 위젯 UI 주석 처리. PropertyDetail에 "추후 제공" placeholder도 처음엔 표시했으나 결국 그것도 주석 처리 (사용자 요청).
**재개 시 방향**: ODsay(대중교통, 무료 티어) + TMAP/카카오모빌리티(자동차, 무료 티어). 서버(/api) 경유. CommuteSearch.jsx + CSS + `googleMapLoader`의 `libraries=places` 모두 코드에 남아있음 (`memory: project_commute_search_deferred.md` 참조).

### 3-20. Vertex AI (Pro) 시도 — **보류**
**시도**: GCP 크레딧 활용을 위해 `@ai-sdk/google-vertex` 설치 + provider 추가. Vertex env 있으면 그쪽, 없으면 AI Studio fallback. 사용자 GCP에서 Vertex AI API는 사용 설정함.
**막힘**: 서비스 계정 키 발급 단계에서 조직 정책 `iam.disableServiceAccountKeyCreation`이 활성 → 키 생성 차단. 정책 끄려 했으나 사용자에게 `orgpolicy.policyAdmin` 권한 없음.
**결정 (옵션 C)**: Vertex 보류, 현재 AI Studio Gemini Flash 유지. **버려진 옵션**: B Workload Identity Federation은 셋업 복잡해 MVP엔 과해서 패스.
**현재 상태**: 코드(`@ai-sdk/google-vertex` import + getModel() 분기)는 모두 들어가 있음. env 4개(GCP_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY/LOCATION) 넣고 `GEMINI_MODEL=gemini-2.5-pro` 추가만 하면 Vertex 즉시 작동. 사용자가 org admin 풀거나 WIF 셋업하면 그때.

### 3-21. 미성숙 disclaimer 정리 (사용자 명시 요청)
**원칙**: "예시/예정/준비 중" 같이 미완성 인상 주는 문구 제거.
- 푸터: "프론트엔드 프로토타입 예시" 제거, "Naver Map API 연결 예정" → `Supabase · 국토부 실거래가 · Google Maps Platform`
- PropertyDetail: 길찾기 placeholder 주석 처리, 매물 리포트 aria-label "(준비 중)" 제거
- MapView, PropertyMediaViewer: "네이버 거리뷰 연동 예정" 제거
- AgentRegisterProperty: "placeholder 이미지로 표시" → "사진 있는 매물이 매수자 신뢰가 훨씬 높습니다" (강한 권장 톤)

### 3-22. AI 리포트 품질 논의 (이론적 합의)
- **모델 업그레이드 정의**: flash → pro. 보류 (Vertex 막힘)
- **가격 예측은 안 함**: 사용자가 KRIHS(국토연구원) 같은 자료로 가격 예측 가능한지 물었음. **거절·설명**: KRIHS는 PDF 보고서라 구조화 데이터 아님. LLM이 기사 읽고 "예측"하는 건 통계 근거 0인 추측. "검증" 정체성과 정면 충돌. 가격 예측 기능 안 만들기로 합의.
- **국토계획/호재**: 미래 정보 단정 금지. 정성적 맥락만 (현재는 적용 X).
- **AI를 팩트체커로** 사용 = 차별점. claimCheck로 이미 실현됨.

---

## 4. 주요 결정과 그 근거 (선택 안 한 대안 포함 — 재제안 금지)

### 가격 데이터
- **단지 단위 fallback 구조 (1→2)** 채택. 단지 단위만 가는 안은 **버림**(데이터 sparse, 매칭 fuzzy). 구만 가는 안도 **버림**(같은 구 내 단지별 가격차 큼 → 할인율 부정확).
- 비교 안 한 대안 — REB 시세지수: 향후 트래픽·정확도 더 필요할 때 고려, 현재 안 함.

### 단위 (시군구 동 → 구·시·군)
- 동(洞)까지 가면 데이터 sparse (대부분 달이 빔, 37%만 6개월+) → 구·시·군으로 롤업. **재논의 금지**.

### 가격 예측 (forecast)
- **안 한다.** 이유: ①LLM 추측 = 신뢰 0 ②검증 정체성 정면 충돌 ③구조화 선행지표 데이터 없음. 모델만 올린다고 풀리는 문제 아님. **버려진 대안**: KRIHS PDF 자동 인용 — KRIHS는 가격 데이터원이 아님.

### Vertex AI
- 보류 (사용자 org policy 막힘). **버린 대안**: WIF (셋업 복잡, MVP엔 과함). 코드는 남아있어 env만 넣으면 작동.

### 길찾기 위젯
- 보류. **재개 시 ODsay + TMAP/카카오**. 구글 Directions는 한국 안 됨 — **재시도 금지**.

### 인쇄
- **새 창에 복제** 방식. visibility/absolute 트릭은 모달과 충돌 — **재사용 금지**.

### 매수자 출퇴근 시간 표시
- **고정 hub(강남/시청/여의도) 안 채택**. 지역별 hub 정의가 짜증나고, 매수자 직장은 어차피 다양. **검색형 위젯**으로 가기로 했고, 위 길찾기 보류와 같이 보류 중.

### 모델 호출 비용 통제
- **선불 크레딧 + auto-reload OFF**가 고정비 정답. 후불(pay-as-you-go)에 auto-reload 켜져있으면 변동비 → 폭탄 위험. 사용자에게 명확히 안내함.

### "어떤 부동산 사이트 만들지"
- **아파트 매매만**. 전월세/유형 UI 옵션 안 만듦.

### 폼 필드 정책 (재논의 금지)
- 지역, 사무소명, 연락처, 공급면적, 관리비, 입주가능 = 자동/제거. 향, 거주상태 = 유지(매수자 선호 정보).
- 단지명 = 선택(필수 X) — 안 골라도 구 fallback.
- 기준 실거래가 수동입력 = **절대 다시 만들지 마**. 데이터 기반 자동 산출이 정체성.
- 매도사유 = 자유 텍스트, 매물 설명 바로 위.

### AI 리포트 그라운딩 (재변경 금지)
- `vaiPrice` 생성 X. 가격 숫자는 우리 실데이터만.
- 학군 등급/배정학교 단정 금지 (Places로 잡은 최근접 학교는 사실로 OK).
- 분량 제한 없음, 단 추측·반복 금지.
- 중개사 글 = 미검증 주장 → claimCheck로 교차검증.
- 미래 가격 예측 금지.
- 사진 분석은 보이는 것만.

---

## 5. 수정/생성/삭제한 파일 전체 목록 (이번 세션)

### 신규
- `src/components/ComplexAutocomplete.jsx` — 단지명 자동완성 (ILIKE, 디바운스 300ms, 최대 8개 결과, 중복 제거)
- `src/components/CommuteSearch.jsx` — 길찾기 위젯 (**미사용**, 한국 API 연동 시 재활용)
- `src/components/ConfirmDialog.jsx` — 공용 중앙 확인 모달
- `src/pages/AgentMyProperties.jsx` — 내 등록 매물 목록 + 수정/삭제 + 확인 모달
- `src/pages/AgentEditProperty.jsx` — 매물 수정 (자주 바뀌는 필드 + 사진 편집 + 캐시 무효화)
- `scripts/build-price-trends.mjs` — 구+평형+월 추이 집계 + 재생산 (시도 추세 × 구 anchor)
- `scripts/build-complex-prices.mjs` — 단지+구+평형 median + 최빈 건축연도
- `supabase/migrations/20260529100000_price_trends_table.sql`
- `supabase/migrations/20260530000000_owner_can_insert_properties.sql`
- `supabase/migrations/20260530010000_complex_prices_table.sql`
- `supabase/migrations/20260530020000_agent_own_property_management.sql`
- `supabase/migrations/20260530030000_complex_prices_built_year.sql`
- `supabase/migrations/20260530040000_property_direction_occupancy.sql`
- `supabase/migrations/20260530050000_property_reports_status.sql`
- `handoff.md` (이 파일)

### 수정 (주요만)
- `src/context/AuthContext.jsx` — 비번 재설정 메서드 3개 추가
- `src/pages/Login.jsx` — 재설정 3단계 UI + 자동 리다이렉트 가드
- `src/components/PropertyLocationMap.jsx` — 클라이언트 지오코딩 fallback + fallback 격리
- `src/components/AgentHeader.jsx` — AGENT_NAV에 end:true 플래그
- `src/pages/Admin.jsx` — 인라인 ConfirmDialog + askConfirm + 모든 confirm 교체 (handleRejectApplication 제외)
- `src/services/propertyRegistration.js` — getAreaBucket export, resolveReferencePrice, fetchPriceHistory, fetchAgentOfficeName, getModel(Vertex/AI Studio 분기), region 자동, agent 자동, direction/occupancy_status 저장, uploadPropertyPhotos export
- `src/services/propertiesRepository.js` — direction, occupancyStatus, createdAt 추가
- `src/services/propertyReports.js` — status='ready'만 캐시 인정, 202 generating 처리
- `src/components/PropertyReportPanel.jsx` — generating 폴링, vaiPrice 자리에 실데이터, claimCheck/photoAnalysis 섹션, 인쇄 새 창
- `src/components/PriceReport.jsx` — 1년 추이, 실제/재생산 점 + 범례 + 빈상태
- `src/pages/PropertyDetail.jsx` — formatArea 표시, 향/거주상태 factRow, CommuteSearch import 제거(주석), 매물 리포트 aria "(준비중)" 제거
- `src/pages/AgentRegisterProperty.jsx` — 거의 전면 재구성 (지역/사무소/공급면적/관리비/입주 제거, 단지 자동완성, 면적 단위 토글, 기준가 미리보기, 향/거주상태, 매도사유 텍스트, 필드별 빨강 안내)
- `src/utils/googleMapLoader.js` — libraries=places 추가
- `src/utils/priceUtils.js` — formatArea, sqmToPyeong, pyeongToSqm
- `src/components/Footer.jsx` — disclaimer 2줄 제거/교체
- `src/components/MapView.jsx`, `src/components/PropertyMediaViewer.jsx` — "네이버 거리뷰 연동 예정" 제거
- `src/App.jsx` — AgentMyProperties, AgentEditProperty 라우트 추가
- `src/styles/compass-phase1.css` — 다수: pill 검색창, nav center, ConfirmDialog/AgentMyProperties/AgentEditProperty/CommuteSearch placeholder/photo grid/photo note/claim check/field error 등 CSS
- `api/property-report.js` — 거의 전면 (락, schema, prompt, generateReport messages 멀티모달, getModel)
- `api/lookup-lifestyle.js` — Distance Matrix, 역세권 분류, region 추출
- `scripts/import-trades-csv.mjs` — 모든 CSV 병합 (단일 파일 → 다중)
- `.gitignore` — `scripts/output/` 추가
- `.claude/settings.local.json` — `Bash(git push:*)` 허용

### 메모리 (`C:\Users\kigki\.claude\projects\c--Users-kigki-OneDrive--------------------\memory\`)
- `project_360_indoor_tour.md` — 360 실내 투어 추후 계획
- `project_commute_search_deferred.md` — 길찾기 보류
- (MEMORY.md에 인덱스 추가됨)

### 삭제 — 없음

---

## 6. 현재 정확한 상태

### 동작하는 것 (배포됨)
- 비밀번호 OTP 재설정 + 가입 OTP
- 매물 상세 지도 (실제 + fallback 격리)
- Admin 페이지 중앙 모달
- 매물 등록: 단지 자동완성, 면적 ㎡/평, 향/거주상태, 매도사유 자유텍스트, 기준가 자동, region/agent 자동, 필드별 검증, 인쇄 PDF
- 1년 실거래가 추이 차트 (실제/재생산 구분 + 범례)
- 내 등록 매물 목록/수정/삭제/사진 편집
- AI 리포트 (Gemini 2.5 Flash via AI Studio): claimCheck, photoAnalysis, 락+폴링, 인쇄 새창
- Distance Matrix 기반 실제 도보 시간 + 역세권 분류 (신규 등록 매물부터)
- 헤더 nav 가운데 정렬, 히어로 검색창 pill
- 디스클레이머 정리

### 안 되는/막힌 것
- **Vertex AI Pro 모델**: 코드는 들어가 있으나 GCP 서비스 계정 키 발급이 조직 정책으로 막혀 사용 불가. AI Studio Flash로 계속 동작 중.
- **길찾기 위젯**: 구글 한국 미지원으로 보류. UI placeholder도 주석 처리됨.

### 마지막 작업 지점
- 마지막 커밋: **`9e10787`** `chore: 미성숙해 보이는 '예시/예정/준비 중' 문구 정리`
- 푸시·배포 완료
- 사용자에게 **3개 판단 요청** 띄워둔 상태(아래 7-3 참조). 응답 안 받음 → 이게 다음 작업의 immediate next.

---

## 7. 미해결 이슈 / 알려진 버그 / 막힌 것

### 7-1. Vertex AI 키 발급 막힘
- 조직 정책 `iam.disableServiceAccountKeyCreation` 활성, 사용자 `orgpolicy.policyAdmin` 권한 없음 (개인 계정인데 GCP가 상위 조직 정책 상속 적용)
- 옵션 A (정책 끄기) 불가, 옵션 B (WIF) 보류, **옵션 C (Vertex 보류) 선택됨**
- 환경 풀리면 `GCP_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY/LOCATION` + `GEMINI_MODEL=gemini-2.5-pro` env 추가 후 재배포만 하면 작동

### 7-2. 길찾기 위젯 (구글 한국 미지원)
- Google Directions: 한국 driving=ZERO_RESULTS, transit 부실
- 재개 시 ODsay(대중교통, 무료) + TMAP/카카오모빌리티(자동차, 무료). 서버 경유 호출 필요
- CommuteSearch.jsx + CSS + `googleMapLoader`의 places 라이브러리는 코드에 남아있음

### 7-3. 사용자 응답 대기 중 — 3개 판단
세션 종료 직전 사용자에게 띄운 질문 3개 (`9e10787` 직후):
1. **매물 보기 모달 "3D 투어 준비 중"** (PropertyMediaViewer 3군데): A) 그대로 유지(메모리 project_360_indoor_tour.md 참조 — 실제 360 촬영물 붙일 때까지) / B) 탭 자체 숨김
2. **로그인 페이지 Google·카카오 소셜 로그인 버튼 "(준비 중)"** (SocialLoginButtons): A) 소셜 로그인 구현 / B) 버튼 숨김 / C) 그대로
3. **`/report` 페이지 AI 인사이트 섹션** ("AI 분석은 출시 후 공개됩니다" + "예정 기능" 리스트, Report.jsx 273줄 근처): A) 섹션 통째 제거 / B) 새 모습으로 대체 / C) 그대로 (메모리 project_ai_report_deferred.md 참조)

다음 세션 첫 작업 = 사용자에게 이 3개 답 받기.

### 7-4. handleRejectApplication 네이티브 prompt 남음
Admin의 중개사 신청 거부에 native `prompt()` 사용 중 (텍스트 입력 필요). 모달로 통합 안 함 (스코프 제외). 일관성은 깨지지만 동작은 정상.

### 7-5. 기존 매물 데이터 stale
- 기존 등록분/목업의 `lifestyle`은 옛 직선거리 라벨. **백필 안 했음** (사용자가 "지금 충분"이라 결정).
- 기존 등록분의 `price_history`도 비어있을 수 있음 (등록 시점이 1년 추이 기능 전이면). 새 등록부터만 채워짐.

### 7-6. 사용자 SQL 적용 상태 (확인 필요)
세션 중 사용자가 적용했다고 한 것들 (재확인 권장):
- price_trends 테이블 + CSV import (14,391행, 재생산 2,240) — 확인 완료 (보고함)
- complex_prices 테이블 + CSV import (48,241행) — 확인 완료 (보고함)
- complex_prices에 built_year 컬럼 + 재import — **확인 필요**
- properties에 direction/occupancy_status 컬럼 — **확인 필요**
- property_reports.status 컬럼 (락) — **확인 필요**
- agent own update/delete RLS — **확인 필요**
- owner can insert properties RLS — 확인 완료 (테스트 통과)

세션 중 사용자가 SQL을 다 실행했는지 명확히 다 보고하진 않았음. 다음 작업 전 SQL Editor에서 빠르게 확인 권장.

---

## 8. 다음에 할 일 (우선순위 순)

### P1 — 사용자 응답 대기 (7-3의 3개)
가장 먼저. 답에 따라 작업이 달라짐.

### P2 — 7-6의 SQL 적용 상태 확인
다음 작업 전에 빠르게 검증 (Supabase SQL Editor):
```sql
select column_name from information_schema.columns where table_name='complex_prices' and column_name='built_year';
select column_name from information_schema.columns where table_name='properties' and column_name in ('direction','occupancy_status');
select column_name from information_schema.columns where table_name='property_reports' and column_name='status';
```

### P3 — 사용자 다음 요구에 따라
세션이 자연스러운 stopping point에서 끊겼으므로, 사용자가 새 요구를 가져올 가능성 큼. 가능한 후보(낮음 우선):
- AI 리포트 ① Vertex Pro 활성화 — 사용자 org 정책 풀리거나 WIF 셋업하면
- 길찾기 — ODsay/TMAP 키 받으면 재개
- 360 실내 투어 — 실제 촬영물 받으면 (PropertyMediaViewer 발판 재활용)
- 기존 매물 백필 (lifestyle/price_history) — 필요해지면

### P4 — 보류된 사용자 요청 (없음)
이번 세션에 미처리 사용자 요청 없음 (전부 답변/실행 완료).

---

## 9. 합의한 규칙 / 컨벤션

### 사용자 작업 스타일
- **한국어**로 소통
- 빠른 iteration, 짧고 정확한 작업 선호
- 새 아이디어 떠올리면 즉시 방향 변경 — 유연하게 따라가야 함
- 작업 후 항상 **build + commit + push** (Claude가 직접 가능, Vercel 자동 배포)
- 환경 변수/SQL 등 직접 해야 할 일은 **명확한 단계로 안내**
- 보안 키는 채팅에 노출 X (사용자가 콘솔에서 직접 입력)
- 어시스턴트(Claude)에게 단정적·솔직한 의견 기대 (sycophancy 거부). "어떻게 생각해?" 물으면 진짜 평가 제시
- 모호한 결정 = 보통 사용자가 정하길 원함 (AskUserQuestion으로 짧게)

### 코드 컨벤션
- ES modules (`import/export`). api/ 폴더는 Vercel 서버리스 함수
- 한국어 주석 OK
- 빌드 통과 + 수동 검증으로 진행 (자동 테스트 없음)
- migration 파일: `YYYYMMDDhhmmss_설명.sql`. 사용자가 SQL Editor에서 직접 실행
- 새 컴포넌트는 `src/components/*.jsx`, 페이지는 `src/pages/*.jsx`
- CSS는 `src/styles/compass-phase1.css`에 (compass 톤 오버라이드 + 신규 컴포넌트), 옛 base는 `global.css` (점진 마이그레이션)
- 환경별 fallback (예: Vertex env 없으면 AI Studio로) — 안전한 점진 도입
- 사용자 시크릿 절대 코드에 넣지 말 것
- 정책 위반/위험한 동작 (force push, 키 노출 등) 안 함
- 보안: 비번은 단방향, owner도 못 봄. RLS 위배 안 됨

### 응답 톤
- **짧고 명확하게**, 결정 포인트는 표로
- 의견 물으면 "내 추천" 명시
- 막힘/모호함은 솔직히 "확인 필요"라고 표시
- 옵션 갈리면 AskUserQuestion으로 (multiSelect, preview 활용)
- 코드 참조는 `[파일명:줄](path#L줄)` 형식 (VSCode 링크용)
- 메모리는 **추측 말고 실제 대화만** 저장. project/feedback/reference 타입 구분
- 동의·확인성 응답("좋아", "맞아")은 OK이지만 무의미한 칭찬·과장 X

### 미준수 항목 (지키지 말 것)
- "예시/예정/프로토타입/준비 중" 같은 미성숙 문구를 새로 추가하지 마. 보류 기능은 placeholder를 두는 대신 **주석 처리**가 선호됨 (사용자가 길찾기 placeholder도 결국 주석 처리하라 함)
- 가격 예측 기능 만들지 마
- 기준 실거래가 수동 입력 다시 만들지 마
- Vertex 코드는 fallback 구조라 깨지 말 것 (env 없으면 자연스럽게 AI Studio로 빠짐)

---

## 10. 핵심 코드 스니펫

### 10-1. getModel — Vertex/AI Studio 분기 (`api/property-report.js`)
```js
function getModel() {
  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL; // 'gemini-2.5-flash'
  const { GCP_PROJECT_ID, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY, GCP_LOCATION } = process.env;
  if (GCP_PROJECT_ID && GCP_CLIENT_EMAIL && GCP_PRIVATE_KEY) {
    const vertex = createVertex({
      project: GCP_PROJECT_ID,
      location: GCP_LOCATION || 'us-central1',
      googleAuthOptions: {
        credentials: {
          client_email: GCP_CLIENT_EMAIL,
          private_key: GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
      },
    });
    return { model: vertex(modelName), label: `vertex/${modelName}` };
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error('Vertex 또는 AI_GATEWAY_API_KEY 환경변수가 필요합니다.');
  const google = createGoogleGenerativeAI({ apiKey });
  return { model: google(modelName), label: `google/${modelName}` };
}
```

### 10-2. AI 리포트 락 (insert-first + stale TTL) — `api/property-report.js`
```js
const STALE_LOCK_MS = 3 * 60 * 1000; // 3분

// handler 내부, invalidate 처리 후
let claimedLock = false;
if (!force) {
  const { data: existing } = await supabase
    .from('property_reports').select('property_id, status, generated_at')
    .eq('property_id', id).maybeSingle();
  if (existing) {
    if (existing.status !== 'generating') {
      const { data: full } = await supabase.from('property_reports').select('*').eq('property_id', id).maybeSingle();
      return res.status(200).json({ ...full, cached: true });
    }
    const age = Date.now() - new Date(existing.generated_at).getTime();
    if (age < STALE_LOCK_MS) return res.status(202).json({ status: 'generating' });
    // atomic takeover
    const { data: taken } = await supabase.from('property_reports')
      .update({ status: 'generating', generated_at: new Date().toISOString() })
      .eq('property_id', id).eq('status', 'generating')
      .lt('generated_at', new Date(Date.now() - STALE_LOCK_MS).toISOString())
      .select('property_id');
    if (!taken || taken.length === 0) return res.status(202).json({ status: 'generating' });
    claimedLock = true;
  } else {
    const { error: claimError } = await supabase.from('property_reports')
      .insert({ property_id: id, report_data: {}, status: 'generating' });
    if (claimError) return res.status(202).json({ status: 'generating' });
    claimedLock = true;
  }
}
try {
  const context = await fetchPropertyContext(supabase, id);
  const { report, usage, model } = await generateReport(context);
  const { data: saved } = await supabase.from('property_reports').upsert({
    property_id: id, report_data: report, status: 'ready',
    model, generated_at: new Date().toISOString(),
    prompt_token_count: usage?.promptTokens ?? null,
    completion_token_count: usage?.completionTokens ?? null,
  }).select('*').single();
  return res.status(200).json({ ...saved, cached: false });
} catch (genError) {
  if (claimedLock) {
    await supabase.from('property_reports').delete()
      .eq('property_id', id).eq('status', 'generating').then(() => {}, () => {});
  }
  throw genError;
}
```

### 10-3. generateReport 멀티모달 (사진 첨부) — `api/property-report.js`
```js
async function generateReport({ property, nearby }) {
  const { model, label } = getModel();
  const userText = buildUserPrompt({ property, nearby });
  const photos = Array.isArray(property.media) ? property.media : [];
  const imageParts = photos
    .filter((p) => p && typeof p.src === 'string').slice(0, 6)
    .map((p) => ({ type: 'image', image: p.src }));
  const userContent = imageParts.length > 0
    ? [{ type: 'text', text: userText }, ...imageParts]
    : [{ type: 'text', text: userText }];
  const result = await generateObject({
    model, schema: REPORT_SCHEMA, system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });
  return { report: result.object, usage: result.usage, model: label };
}
```

### 10-4. resolveReferencePrice (단지→구 fallback) — `src/services/propertyRegistration.js`
```js
export async function resolveReferencePrice({ complexName, gu, areaBucket }) {
  if (!isSupabaseConfigured || !gu || !areaBucket || areaBucket === '미상') {
    return { price: null, source: null };
  }
  if (complexName) {
    const { data } = await supabase.from('complex_prices')
      .select('median_price').eq('complex', complexName)
      .eq('gu', gu).eq('area_bucket', areaBucket).maybeSingle();
    if (data?.median_price) return { price: data.median_price, source: 'complex' };
  }
  const { data: trend } = await supabase.from('price_trends')
    .select('price').eq('gu', gu).eq('area_bucket', areaBucket)
    .order('year_month', { ascending: false }).limit(1).maybeSingle();
  if (trend?.price) return { price: trend.price, source: 'region' };
  return { price: null, source: null };
}
```

### 10-5. 재생산 공식 — `scripts/build-price-trends.mjs`
```js
// 그룹별 anchor (구·평형 실거래 중앙값) + 시도 평형 연간 중앙값
const anchor = median(group.amounts);
const sidoOverall = median(sidoGroup.get(`${group.region}|${group.bucket}`) ?? []);
// 빈 월 채움: 시도 그 달 중앙값 / 시도 전체 중앙값 비율로 anchor 스케일
const sidoMonth = median(sidoCell.get(`${group.region}|${group.bucket}|${ym}`) ?? []);
let estimate = (sidoMonth && sidoOverall)
  ? Math.round(anchor * (sidoMonth / sidoOverall))
  : anchor;  // 주변 추세도 없으면 anchor (평탄)
```

### 10-6. toGu (시군구 → 구 단위 정규화) — 위 두 스크립트 공통
```js
function toGu(sigungu) {
  const tokens = sigungu.trim().split(/\s+/);
  // 동/읍/면/리/가가 끝에 있으면 시·군·구 만날 때까지 반복 제거
  // (농촌: "강원 춘천 동면 감정리" 4단계, 도시: "서울 강남구 역삼동" 3단계, 세종 직동: 2단계 모두 처리)
  while (tokens.length > 1 && /(동|읍|면|리|가)$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}
```

### 10-7. classifyStationArea (역세권 분류, 실제 도보 거리) — `api/lookup-lifestyle.js`
```js
function classifyStationArea(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters <= 500) return '초역세권';
  if (meters <= 1000) return '역세권';
  if (meters <= 1500) return '역 인접';
  return '비역세권';
}
// 결과는 lifestyle.stationArea = `${grade} — ${lifestyle.subway} (약 ${meters}m)` 형태로 저장
```

### 10-8. ConfirmDialog 사용 패턴
```jsx
const [confirm, setConfirm] = useState(null);
// 트리거:
setConfirm({
  title: '매물 삭제',
  message: `"${property.title}" 매물을 삭제합니다. 되돌릴 수 없습니다.`,
  confirmLabel: '삭제',
  danger: true,
  onConfirm: async () => { /* 실제 작업 */ },
});
// 렌더:
{confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
```
※ Admin.jsx에는 별도 인라인 버전이 있고 통합 안 함. 새 사용처는 `src/components/ConfirmDialog.jsx`를 import.

### 10-9. 인쇄 새 창 — `src/components/PropertyReportPanel.jsx`
```js
const handlePrint = () => {
  const node = reportRef.current;
  if (!node) { window.print(); return; }
  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) { window.print(); return; }
  const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((el) => `<link rel="stylesheet" href="${el.href}">`).join('');
  const inlineStyles = Array.from(document.querySelectorAll('style'))
    .map((el) => `<style>${el.innerHTML}</style>`).join('');
  win.document.write(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
    + `<title>${property.title} — AI 매물 리포트</title>${cssLinks}${inlineStyles}`
    + `<style>body{margin:0;padding:24px;background:#fff;}.report-print-button{display:none!important;}</style>`
    + `<script>window.onafterprint=function(){window.close();};`
    + `window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>`
    + `</head><body>${node.outerHTML}</body></html>`
  );
  win.document.close();
  win.focus();
};
```

### 10-10. REPORT_SCHEMA 구조 — `api/property-report.js`
```
summary: { headline, merits[3-6], cautions[3-6] }
basic:   { summaryText, rightsAnalysis }
priceAnalysis: { competitivenessText, trendText, claimCheck, downsideRisk('낮음'|'보통'|'높음'), downsideText }
  (※ vaiPrice/discountAmount/discountPct 제거됨, 우리 실데이터 사용)
photoAnalysis: { overall, lighting, interior, renovation, concerns }.optional()
  (※ 사진 첨부된 매물만 — Gemini Vision)
location: { transport, amenities, school, marketTrend }
opinion:  { score, grade(S~D), buyRecommendation, finalOpinion, targetBuyer }
```

---

**끝.** 이 문서로 새 세션 시작 시 첫 메시지는 사용자에게 7-3의 3개 응답을 받는 것부터 시작하면 됨. 그 전에 7-6의 SQL 상태 빠르게 확인 권장.
