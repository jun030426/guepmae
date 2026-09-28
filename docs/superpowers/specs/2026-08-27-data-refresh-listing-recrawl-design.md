# 데이터 최신화 + 수도권 매물 재수집 설계

작성일: 2026-08-27

## 배경

프론트 개편과 병행해 데이터 레이어를 최신화한다. 현재 상태(2026-08-27 실측):

| 대상 | 파일 | 현재 상태 | 밀린 정도 |
|---|---|---|---|
| 실거래 스냅샷 | `public/data/market_snapshots.json` | 2025-05~2026-05, 556,907행, `lastUpdated: 2026-05-31` | 약 3개월 |
| 단지×면적 중앙값 | `public/data/complex_prices.json` (4,000행) / `scripts/output/complex_prices.csv` (83,103행) | 최신 거래월 2026-06 | 약 2개월 |
| 매물 | `public/data/properties.json` | 395건, 전부 `computedAt: 2026-06-24` | 약 2개월 |
| 매물 AI 리포트 | `public/data/property_reports.json` | 15건 (395건 중) | 커버리지 3.8% |
| 시장 AI 리포트 | `public/data/ai_market_reports.json` | `data_as_of: 2026-05` | 약 3개월 |

매물 395건은 더미가 아니라 `scripts/import-listings.py`로 매물 엑셀 20,997행에서 할인율 5~40% 필터를 통과시킨 실데이터다. 지역 분포는 인천 214 / 강원 141 / 서울 40. 다만 매물 엑셀 스키마에 중개사 컬럼이 없어 395건 전부 `agent.name = "급매 운영팀"`, 연락처 공란 상태다.

## 목표

1. 국토부 실거래를 2026-07까지 갱신하고, 그 위에 얹힌 집계·리포트를 전부 재생성한다.
2. 수도권(서울·경기·인천) 매물을 재수집해 매물 신선도를 회복한다.
3. 재수집 산출물은 **git과 라이브 배포에 노출되지 않는다.**

## 비목표

- 중개사 실등록 전환 (추후 별도 작업). 이번엔 수집 매물이 본체다.
- 강원 141건의 매물 교체. 강원은 `price_basis` 재계산만 한다.
- 프론트 컴포넌트 변경. 이 스펙은 데이터 레이어에 한정한다.

## 제약: 노출 격리

사용자 요구는 "크롤링 산출물이 라이브에 안 보일 것"이다. 이때 **Supabase는 격리 지점이 아니다.**

`src/lib/dataClient.js:96`:

```js
const [base, remote] = await Promise.all([bundle('properties'), remotePropertiesRows()]);
```

하이브리드 모드(라이브 Vercel)는 매 읽기마다 번들 JSON과 Supabase `properties` 테이블을 병합한다. 따라서 Supabase `properties`에 넣은 행은 `public/data/`에 없고 git에 없어도 guepmae.vercel.app에 노출된다.

격리는 다음 두 지점에서만 성립한다:

- `scripts/data/` — 이미 `.gitignore` 대상. 크롤링 엑셀과 원본 CSV의 보관처.
- `import-listings.py`를 `--apply` 없이 실행 — Supabase에 쓰지 않고 `scripts/output/`에만 산출물을 남긴다. `scripts/output/`도 gitignore 대상이다.

**Supabase 주입은 이 스펙의 범위 밖이다.** dry-run 결과를 보고 별도로 결정한다.

## 개인정보

크롤링 시 중개사무소명·전화번호·등록번호를 **수집하지 않는다.** `import-listings.py:200`의 `FIELDS` 맵에 중개사 필드가 없어 파이프라인이 읽지도 않는다. 스키마 차원에서 배제하면 개인정보 보관 자체가 발생하지 않는다.

## 파이프라인

### A. 실거래 증분 갱신

전량 재수집은 2026-06-25에 약 11시간이 걸렸다(`scripts/data/api_*.csv` 타임스탬프 02:57→14:24). 기존 CSV가 2026-05까지 덮고 있으므로 **2026-06·07 두 달만 받아 병합한다.** 254 시군구 × 2개월 = 508 요청.

2026-08분은 제외한다. `market_snapshots.metadata.disclosureLag`가 "계약일 기준 약 2주 후 공개"라 8월 말 시점에 8월분은 불완전하다.

`scripts/fetch-trades.py`는 현재 "최근 N개월"만 지원하고 `--resume`는 시도 단위 스킵이라 증분 병합이 안 된다. `--since YYYY-MM` 옵션을 추가한다: 지정 월부터만 수집하고 기존 `api_<시도>.csv`에 병합한다.

병합은 **월 단위 교체**로 한다. fresh 가 행을 반환한 월은 기존 행을 전부 버리고 fresh 로 갈아끼우고, 나머지 월은 건드리지 않는다. 재실행해도 행이 불어나지 않는다.

**행 단위 중복 제거는 쓸 수 없다.** CSV 9열에 동(棟) 컬럼이 없어 같은 단지·면적·계약일·층·금액의 서로 다른 거래가 구분되지 않는다 — 실측 충돌률 대전 4.33%(45,046행 중 1,950) / 광주 3.78%. 2026-08-27 세종 실측에서 키 기반 병합이 15,209 + 676 → 14,744 로 465행을 소실시켰다.

산출: `scripts/data/api_*.csv` 갱신

### B. 집계 재생성

A 완료 후 순서대로 실행한다. 세 스크립트 모두 `scripts/data/`의 CSV를 입력으로 한다.

1. `node scripts/build-complex-prices.mjs` → `scripts/output/complex_prices.csv` — 단지×면적 중앙값. **할인율 판정의 기준선.**
2. `node scripts/build-complex-trades.mjs` → `scripts/output/complex_trades.csv` — 매물 상세의 평형별 요약표(A)·최근 실거래 내역표(B) 원천
3. `node scripts/build-price-trends.mjs` → `scripts/output/price_trends.csv` — 시세 추이 차트 원천

이어서 프론트 번들을 갱신한다: `public/data/complex_prices.json`, `public/data/market_snapshots.json`.

**B가 C보다 먼저여야 한다.** 할인율 5% 필터가 `complex_prices.csv` 중앙값을 기준으로 걸리므로, 6월 기준선으로 8월 매물을 거르면 "두 달 전 시세 대비 급매"가 산출된다.

### C. 수도권 매물 크롤링 → 엑셀

**타겟 선정.** 수도권 고유 단지는 16,225개다. 전량은 비현실적이고 불필요하다 — 실거래 표본이 얇은 단지는 `import-listings.py`의 `MIN_SAMPLE = 3` 필터에서 어차피 탈락한다.

`scripts/output/complex_prices.csv`에서 **`gu`가 서울특별시·경기도·인천광역시로 시작하는 행 중, 한 단지의 여러 면적 행에 걸친 `sample_size` 최댓값이 20 이상인 단지**를 타겟으로 삼는다. B 재생성 직후 기준으로 약 5,853단지. 이 구간은 `price_basis.confidence`가 `high`로 붙는 표본 두께에 해당한다.

**수집 방식은 미확정.** 호갱노노의 단지별 URL 매핑을 보유하고 있지 않아, 단지 단위 순회가 맞는지 지도 영역 단위가 맞는지는 실제 페이지 구조를 확인한 뒤 정한다. 이 확인이 C의 첫 작업이다.

**중단 조건.** 봇 차단(CAPTCHA, 레이트 리밋 차단, 접근 거부)에 걸리면 그 지점에서 중단한다. 우회하지 않는다. 부분 수집분으로 D를 진행한다.

**출력 포맷.** `import-listings.py`가 읽는 엑셀 스키마를 그대로 맞춘다 — 시트명 `매물입력`, 1행이 한글 헤더.

필수 컬럼 (없으면 행 폐기):

| 컬럼 | 비고 |
|---|---|
| 단지명 | `resolve_complex()`가 정규화 후 `complex_prices.csv`와 매칭. 공백·"아파트" 제거, 괄호 내용 제거 후 부분일치까지 시도 |
| 구/시군구 | `complex_prices.csv`의 `gu` 표기와 정확히 일치해야 함 (예: `인천광역시 부평구`) |
| 전용면적(㎡) | 정수 절삭 |
| 호가(원) | 원 단위 정수 |

선택 컬럼: 제목, 층, 방수, 욕실수, 준공연도, 향, 공급면적(㎡), 관리비(원), 주차, 입주가능일, 거주상태, 세대수, 매물설명, 도로명주소, 주소, 사진1…N

**수집 금지 컬럼:** 중개사무소명, 중개사 전화번호, 중개사 등록번호, 그 밖의 개인 식별 정보.

산출: `scripts/data/hogangnono_수도권_20260827.xlsx` (gitignore)

### D. dry-run 검증

```
python scripts/import-listings.py "scripts/data/hogangnono_수도권_20260827.xlsx"
```

`--apply`를 붙이지 않는다. Supabase에 쓰지 않고 `scripts/output/properties_insert.sql`과 `scripts/output/_import_report.txt`만 생성된다.

확인 항목:

- 단지 미매칭률 — 6월 기준 20,997행 중 5,492행(26%)이 미매칭이었다. 크롤링 단지명 표기가 국토부 표기와 다르면 이 비율이 치솟는다. **50%를 넘으면 단지명 정규화를 손봐야 한다.**
- 채택 건수 — 6월 수율은 1.9%(20,997행 → 395건)
- 지역 분포 — 서울·경기·인천에 고르게 퍼지는지
- 지오코딩 신규 호출 수 — Google Geocoding API 과금분

### E. 주입 결정 (이 스펙 범위 밖)

D 결과를 보고 결정한다. 선택지는 엑셀까지만 보관 / 로컬 번들에만 반영 / Supabase 주입(=라이브 노출). 기본값은 "엑셀까지만"이다.

### F. 강원 141건 price_basis 재계산

수도권을 교체해도 강원 141건은 6월 기준선(`computedAt: 2026-06-24`)으로 남는다. 새 `complex_prices.csv` 중앙값으로 각 매물의 `actual_transaction_price`·`discount_rate`·`price_basis`(`sampleSize`, `periodStart`, `periodEnd`, `method`, `computedAt`)를 재계산한다.

재계산 후 할인율이 `MIN_DISC = 5%` 아래로 떨어진 매물은 "검증된 급매"가 아니게 되므로 목록에서 제외한다. PRODUCT.md 원칙 1(모든 가격 주장은 실거래 데이터로 증명)에 따라 낡은 근거로 급매 배지를 유지하지 않는다.

### G. 리포트 재생성

1. `node scripts/generate-market-report.mjs` → `public/data/ai_market_reports.json` — 전국 시장 리포트. 새 `market_snapshots`를 그라운딩 소스로 사용.
2. `node scripts/generate-reports.mjs` → `public/data/property_reports.json` — 매물별 AI 리포트.

매물 리포트 커버리지는 D 이후에 정한다. Gemini 호출 비용이 매물 수에 비례하므로, 최종 매물 건수가 확정돼야 판단할 수 있다. 현재는 15/395(3.8%).

## 검증

각 단계의 통과 기준:

| 단계 | 검증 |
|---|---|
| A | `api_*.csv`에 2026-06·07 행이 존재하고, 기존 2025-05~2026-05 행 수가 줄지 않음 |
| B | `complex_prices.csv`의 `latest_year_month` 최댓값이 2026-07 |
| B | `market_snapshots.json`의 `metadata.months` 마지막 원소가 2026-07 |
| C | 엑셀 1행 헤더가 필수 4개 컬럼을 포함하고, 중개사 관련 컬럼이 없음 |
| D | `_import_report.txt`의 단지 미매칭률 < 50% |
| F | 강원 매물의 `price_basis.computedAt`이 실행일이고 `discount_rate` ≥ 5 |
| G | `market_snapshots.json`의 `metadata.lastUpdated`가 2026-07 기준이고, `ai_market_reports.json`의 `data_as_of`가 이를 따름 |
| 전체 | `npm run dev` 후 홈·매물목록·매물상세·지도·리포트 화면에서 콘솔 에러 없음 |
| 전체 | `git status`에 `scripts/data/`·`scripts/output/` 파일이 나타나지 않음 |

## 실행 기록 (2026-08-27)

**커버리지 갭 — 광주광역시·전라남도는 2026-06 까지.** MOLIT API 가 이 두 시도의 LAWD 코드에 대해 모든 요청 월에 `total=0` 을 반환했다. 기존 CSV 에 데이터가 있는 2023-07 조회도 0 이었고, 대조군 대전광역시(30110)는 정상이었다. 2026-06 수집 때는 같은 코드로 47,633 건을 받았으므로 수집 코드나 병합 문제가 아니라 API 측 문제다. 재시도 1 회에도 동일.

`merge_rows` 의 "fresh 가 0건인 월은 교체하지 않는다" 가드가 작동해 기존 이력은 보존됐다. 결과적으로 `public/data/market_snapshots.json` 의 `metadata.months` 는 2026-07 까지, `lastUpdated` 는 2026-08-27 로 표시되지만, 그 안의 2026-07 집계에 광주·전남은 0 건 기여한다 — 전체 1,537,230 행 중 92,498 행(6.0%)이 한 달 뒤처져 있고 `monthly[2026-07].transactionVolume` 은 그만큼 과소 집계다. `regional` 의 광주·전남 행도 한 달 stale.

두 시도 모두 수도권 크롤링 대상 밖이라 매물 파이프라인에는 영향이 없다. API 가 정상화되면 `python scripts/fetch-trades.py --since 2026-06 광주광역시 전라남도` 로 보정하고 집계·번들을 재생성한다.

**남은 불일치 8 건.** 재계산 후에도 `price_table.areaSummary` 의 본인 면적 행 건수가 `price_basis.sampleSize` 와 다른 매물이 3 건, 본인 면적 행 자체가 없는 매물이 5 건 있다. 7 건은 `approxArea: true`(±2㎡ 이웃 면적을 기준으로 삼은 경우)로 정상이며 근거 문구가 기준 면적을 명시한다. 나머지 1 건은 `norm()` 정규화가 `건영` 과 `건영아파트` 를 한 항목으로 병합하는 데서 온다 — `import-listings.py` 와 동일한 기존 동작이며, 단지 동일성 모델을 두 생성기에서 함께 바꿔야 해 이번 범위 밖으로 둔다.

## 리스크

**크롤링의 법적 리스크.** 호갱노노 이용약관은 자동 수집을 금지하며, 저작권법 제93조(데이터베이스제작자의 권리) 침해는 복제 시점에 성립한다(잡코리아 v 사람인). 로컬 보관과 배포 미노출은 손해 규모를 줄이지만 위법성 자체를 제거하지 않는다. 이 리스크는 2026-08-27 사용자에게 고지되었고 사용자가 진행을 결정했다. 완화책으로 (1) 산출물의 git·배포 격리, (2) 개인정보 컬럼 배제, (3) 봇 차단 시 우회 없이 중단을 채택한다.

**단지명 매칭 실패.** 크롤링 단지명 표기가 국토부 표기와 체계적으로 다르면 D에서 대량 탈락한다. 완화: 한 개 구로 소규모 시범 수집 후 매칭률을 먼저 확인한다.

**지오코딩 과금.** `scripts/output/_geocache.json`에 6월 캐시가 남아 있어 기존 단지는 재호출되지 않는다. 신규 수도권 단지는 새로 호출된다. D의 dry-run 리포트에서 호출 수를 확인한 뒤 진행한다.

**실거래 증분 병합의 손실.** 초기 설계였던 튜플 기준 행 중복 제거는 실데이터에서 약 4%를 소실시킨다(위 A 참조). 월 단위 교체로 대체했다. 잔여 리스크: 한 월의 수집이 부분 실패하면 그 월이 불완전한 상태로 교체될 수 있다 — fresh 가 0건인 월은 교체하지 않는 가드로 전멸 케이스만 막는다. 시도별 행 수가 기준선 아래로 떨어지지 않는지 매 실행 후 확인한다.
