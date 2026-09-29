# 검증 기준 고도화 — 판정 보류 · 거래 시점 보정 · 직거래 제외 · 기준가 커버리지

작성일: 2026-09-29
상태: 사용자 방향 확정 (2026-09-29 "다음 단계 가보자") — 사업계획서 Q3-1 ③의 약속을 코드로 확정한다

## 1. 배경

사업계획서(모두의 창업 제출본 2026-09-10)는 검증 방식을 이렇게 약속했다.

> 가족 간 직거래나 해제된 거래는 비교 대상에서 제외하고, 층 구간과 거래 시점을 보정하며,
> 최근 거래 표본이 부족한 단지는 무리하게 판정하지 않고 '판정 보류'로 정직하게 표시합니다.

2026-09-29 실측 기준 코드 현황:

| 약속 | 현재 |
|---|---|
| 해제 거래 제외 | 됨 — 수집·집계 단계에서 `해제사유발생일` 있는 행 제외 |
| 직거래 제외 | 안 됨 — 수집기가 API 의 거래유형(`dealingGbn`)을 아예 받지 않음 |
| 거래 시점 보정 | 안 됨 — 최근 36개월 전체의 단순 중앙값 |
| 층 구간 보정 | 안 됨 |
| 판정 보류 | 반쯤 — 표본 3건 미만이면 지역 시세(빈 테이블) → 얇은 단지값(신뢰도 low)으로 폴백해 어쨌든 숫자를 냄 |
| 기준가 커버리지 | 앱이 읽는 단지 시세 번들이 4,000행(표본 75건 이상)뿐. 자기 매물 387건 중 80건만 매칭. 라이브도 번들을 읽어 동일 |

원칙(PRODUCT.md): 모든 가격 주장은 실거래로 증명하고 근거를 붙인다. 추정하지 않는다. 그래서 "보정"도 회귀·지수 조정이 아니라 **비교 대상 거래를 고르는 규칙**으로 구현한다. 기준가는 언제나 실제 거래들의 중앙값이다.

## 2. 목표

1. 하나의 판정 함수(`src/utils/priceBasis.js`)가 앱(등록·미리보기)과 파이프라인(재계산)에서 똑같이 쓰인다.
2. 판정 결과에 조건(기간·층 구간·제외 건수·표본)이 그대로 남고, 화면이 그것을 문장으로 보여준다.
3. 표본 부족·데이터 없음은 숫자 대신 **판정 보류**로 표시되고, 급매 목록·지도·홈에서 빠진다.
4. 앱이 단지별 개별 실거래를 읽을 수 있게 되어(하이브리드 = Supabase, 로컬 = 번들), 4,000행 한계를 벗어난다.

## 3. 비목표

- 회귀·헤도닉 모델, 지역 지수로 과거 가격을 현재가로 환산하는 조정 (추정 금지)
- 오피스텔·빌라 (사업계획서 6단계 이후)
- 매일 증분 수집 자동화 (다음 단계 — 이 스펙은 수집기 컬럼만 추가)
- 백테스트 (별도)

## 4. 판정 규칙

입력: 단지×면적 개별 실거래 목록(최근 36개월), 매물(전용면적·층·매도가), 데이터 기준월(`asOf` = 데이터의 최신 거래월).

```
0. 제외   해제(취소) 거래, 거래유형 = 직거래           → 제외 건수를 기록
1. 면적   동일 전용면적(㎡ 정수) 36개월 표본 ≥ 3      → 아니면 ±2㎡ 중 표본 최다 면적 (approxArea)
2. 기간   최근 12개월 표본 ≥ 3 → 12 / 아니면 24 / 아니면 36  → 전부 미달이면 판정 보류
3. 층     매물 층 구간과 같은 거래가 그 기간 안에 ≥ 3  → 그 거래만 (floorAdjusted) / 아니면 기간 전체
4. 기준가 선택된 거래들의 중앙값
5. 할인율 (기준가 − 매도가) / 기준가, 소수 1자리. ≥ 5% 급매, ≥ 10% 초급매
```

기간을 층보다 먼저 고르는 이유: 3건짜리 같은 층 표본보다 최근 12개월 15건이 더 믿을 만하다. 기간을 최소로 잡은 뒤, 그 안에서 층이 맞는 거래가 충분할 때만 층을 좁힌다.

**층 구간** (`floorBand`): 매물 층 문자열에서 숫자를 읽거나 "저층/중층/고층" 텍스트를 그대로 쓴다.

| 구간 | 규칙 | 표기 |
|---|---|---|
| 저층 `low` | 1~3층 | 저층(1~3층) |
| 고층 `high` | 단지 최고층 ≥ 10 일 때 상위 3개 층 | 고층(N~M층) |
| 중층 `mid` | 나머지 | 중층(4~N층) |

단지 최고층은 해당 단지×면적의 36개월 거래에서 관측된 최고 층이다(별도 단지 정보 없음). 층을 알 수 없으면 층 보정 없이 기간 전체를 쓴다.

**임계값**: `MIN_SAMPLE = 3`(기존과 동일), 창 `[12, 24, 36]`개월, `MIN_DISC = 5`, `MAX_DISC = 40`(파이프라인 이상치 제외에만). 신뢰도 `high`(≥5건) / `medium`(3~4건).

**판정 보류** (`status: 'insufficient'`) 사유:

- `no_data` — 단지 실거래 데이터 자체가 없음(단지명 미매칭·미수집)
- `low_sample` — 36개월 동일·근접 면적 표본이 3건 미만

보류 매물은 `actual_transaction_price = null`, `discount_rate = null`. 급매 배지 대신 "판정 보류" 배지, 급매 목록·지도·홈에서 제외(할인율 필터 ≥5% 가 자연히 거른다), 상세는 직접 링크로 열리며 보류 사유를 보여준다. 중개사 본인·운영은 계속 본다.

## 5. `price_basis` 스키마 (properties.price_basis jsonb)

```jsonc
{
  "source": "complex",
  "status": "ok",                    // 'ok' | 'insufficient'
  "reason": null,                    // 보류 사유: 'no_data' | 'low_sample'
  "baselinePrice": 365000000,
  "areaM2": 59, "requestedAreaM2": 59, "approxArea": false,
  "windowMonths": 12,                // 12 | 24 | 36
  "periodStart": "2025-08", "periodEnd": "2026-07",
  "sampleSize": 7,                   // 기준가 산출에 쓴 거래 수
  "floorBand": "mid",                // 'low' | 'mid' | 'high' | null
  "floorAdjusted": true,             // 같은 층 구간만 썼는지
  "listingFloor": 7, "maxFloor": 15,
  "excludedDirect": 1,               // 직거래 제외 건수 (거래유형 데이터가 있을 때)
  "totalSample36": 18, "median36": 360000000,   // 참고: 36개월 전체(층 무관) 표본·중앙값
  "confidence": "high",
  "dataAsOf": "2026-07",
  "method": "동일 단지 59㎡ · 중층(4~12층) · 최근 12개월 7건 중앙값 · 직거래 1건 제외",
  "computedAt": "2026-09-29"
}
```

기존 형태(`status` 없음)는 `ok` 로 취급한다 — 데스크톱 재계산 전까지 번들 매물은 옛 형태로 남는다.

## 6. 데이터 흐름 — 개별 실거래를 앱까지

지금은 단지×면적 **중앙값**(complex_prices)만 앱에 도달하고, 개별 거래는 매물에 구운 표(price_table, 최근 30건)에만 있다. 판정 규칙 2·3 은 개별 거래가 필요하다.

```
scripts/data/api_*.csv (수집, +거래유형 컬럼)
  └─ build-complex-trades.mjs → scripts/output/complex_trades.csv  (+dealing 열)
       ├─ build-complex-trades-rows.mjs → scripts/output/complex_trades_rows.json   (단지×면적 83k행, 거래 배열)
       │                                 → public/data/complex_trades.json           (상위 4,000행 — complex_prices.json 과 같은 키)
       ├─ recompute-price-basis.mjs --all --write → properties.json 의 price_basis·표·차트 재계산 (판정 함수 사용)
       └─ load-bundles-to-supabase.mjs complex_trades → Supabase complex_trades 테이블 (전체 83k행)
```

**`complex_trades` 행**: `{ complex, gu, area_m2, sample_size, latest_year_month, max_floor, trades: [[ym, day, price, floor, dealing], ...] }` — 거래는 압축 배열, `dealing` 은 `'b'`(중개) / `'d'`(직거래) / `''`(미상). 하이브리드 앱은 Supabase 에서 (complex, gu) 로 한 번에 읽고, 로컬 데모는 번들(상위 4,000행)에서 읽는다. 둘 다 없으면 complex_prices 중앙값(36개월·층 무관)으로 폴백하되 `method` 에 "전체 기간 · 층 보정 없음"을 명시한다. 그것도 없으면 보류(`no_data`).

용량: 1,537,230 거래 × ~35바이트 ≈ 55MB(jsonb). Supabase 무료 500MB 안. 번들 4,000행은 ≈ 4MB 로 등록 화면에서만 지연 로드.

## 7. 파이프라인 변경

| 파일 | 변경 |
|---|---|
| `scripts/fetch-trades.py` | 헤더에 `거래유형` 추가(`dealingGbn`). 기존 9열 CSV 를 읽을 때 빈 값으로 채워 병합 호환. 테스트 갱신 |
| `scripts/build-complex-trades.mjs` | 출력에 `dealing` 열(`direct`/`brokered`/``) 추가 |
| `scripts/build-complex-prices.mjs` | 직거래 행 제외 후 중앙값 (폴백 기준선도 같은 규칙) |
| `scripts/build-complex-trades-rows.mjs` | 신규 — complex_trades.csv → rows.json(전체) + 번들(상위 4,000) |
| `scripts/recompute-price-basis.mjs` | 판정 함수로 교체. `--all` 옵션. 보류·5% 미만·40% 초과 매물 제외. 표B 에 거래유형 표시 |
| `scripts/load-bundles-to-supabase.mjs` | `complex_trades` 적재 작업 추가 |
| `supabase/migrations/…_complex_trades_table.sql` | 신규 테이블 + 공개 읽기 RLS + (complex, gu) 인덱스 |
| `scripts/import-listings.py` | 변경 없음 — 후보 선별은 종전 중앙값, 최종 근거는 recompute 가 덮어쓴다 (실행 순서 문서화) |

거래유형은 국토부 API 에서 2021-01 계약분부터 제공된다. 36개월 창은 전부 포함된다. **기존 CSV 에는 이 열이 없어 전량 재수집이 필요하다**(2026-06 실측 약 11시간, 데스크톱에서 `MOLIT_API_KEY` 로). 재수집 전까지 `dealing` 은 전부 미상이라 직거래 제외는 0건으로 동작한다 — 화면 문구는 제외 건수가 있을 때만 붙인다.

## 8. 앱 변경

- `src/utils/priceBasis.js` (순수) — `computePriceBasis`, `floorBandOf`, `parseFloor`, `formatBasisMethod`, `isHeld`, `discountLabel`. node:test.
- `src/lib/dataClient.js` — `complex_trades`: 하이브리드는 Supabase(REMOTE_TABLES), 로컬은 번들.
- `src/services/propertyRegistration.js` — `resolveReferencePrice`: complex_trades → 판정 함수 / 없으면 complex_prices 폴백 / 없으면 보류. `registerProperty`: 보류면 기준가·할인율 null.
- `src/services/propertiesRepository.js` — `discountRate`·`actualTransactionPrice` 가 null 일 수 있음.
- 화면 — `UrgentBadge`(판정 보류 톤), `PropertyCard`, `PropertyDetail`(요약·근거·사이드카드), `PriceReport`(보류 문구 + 산출 조건 목록), 목록 정렬 null 안전, `MapPage` 표기, 중개사·관리자 표. 등록 폼 미리보기에 보류 사유 표시.

## 9. 검증 기준

1. 판정 함수 단위 테스트: 12→24→36 창 선택, 층 구간 우선·폴백, 직거래·해제 제외, ±2㎡ 근접, 보류 두 사유, method 문구.
2. 로컬 데모: 번들에 있는 단지로 등록 → 폴백 기준(전체 기간·층 보정 없음) 문구와 할인율 표시. 번들에 없는 단지명으로 등록 → 폼 미리보기 "판정 보류(데이터 없음)", 등록 후 상세에 보류 배지·사유, 급매 목록·지도·홈에 미노출, 내 등록 매물·관리자에는 "보류" 표기.
3. 옛 형태 price_basis(번들 387건) 화면 회귀 없음.
4. 파이프라인 픽스처 테스트: complex_trades rows 생성, recompute 가 창·층·직거래를 반영, 보류 매물 제외.
5. 데스크톱 실행 후(사용자): 재수집 → 집계 → rows/번들 → recompute --all --write → Supabase 적재 → 커밋. 그 뒤 라이브 매물의 method 에 "최근 N개월"과 층 구간이 표시된다.

## 10. 리스크

- **재수집 전 직거래 제외 무효.** 문구가 거짓이 되지 않도록 제외 건수 0 이면 아예 표기하지 않는다.
- **표본 3건의 층 구간 중앙값**은 흔들릴 수 있다. 표본 수를 항상 문장에 붙이고 신뢰도 `medium` 으로 표시한다.
- **최고층 추정**: 거래 관측치라 실제 최고층보다 낮을 수 있어 고층 구간이 보수적으로 잡힌다. 표기에 층 범위를 명시한다.
- **재계산으로 급매 탈락**: 최근 12개월 중앙값이 3년 중앙값보다 낮은 단지는 할인율이 줄어 5% 밑으로 갈 수 있다. 낡은 근거로 배지를 유지하지 않는 것이 원칙(2026-08-27 스펙 F)이며, 탈락 수는 재계산 로그로 남긴다.
- **Supabase 용량**: 55MB 추정. 초과 시 최근 24개월로 줄이거나 표본 상위 단지만 적재.
