# 데스크톱에서 할 작업 (API 키·원본 데이터가 필요한 것)

작성일: 2026-09-29 · 노트북 세션에서 코드는 끝났고, 키·데이터가 있는 데스크톱에서 실행만 남은 항목들이다.
끝난 항목은 체크하고 날짜를 적는다. A·B·F·G 는 서로 독립이고, C 는 B 다음이다. G(백테스트)는 재수집 전에도 돌릴 수 있다.

전제: 데스크톱 저장소가 `main` 최신이어야 한다.

```bash
git pull
npm install
```

## 추천 순서

노트북에서 확인한 것은 "코드가 설계대로 동작하는가"까지다(자동 테스트·가짜 서버 리허설·로컬 데모 화면).
**실제 키·실제 데이터·실제 계정으로 도는지는 아래에서 처음 확인한다.**
노트북의 다음 개발은 이 확인을 기다리지 않고 진행해도 된다 — 단, 백테스트 결과가 있어야 하는 일(규칙 보완·정확도 공개 화면)은 G 다음이다.

| 순서 | 할 일 | 걸리는 시간 | 필요한 것 |
|---|---|---|---|
| 1 | 0. 자동 테스트·리허설 | 5분 | 없음 |
| 2 | G. 백테스트 (지금 있는 CSV 로) | 5분 | 원본 CSV |
| 3 | A. 카카오 키 | 10분 | 카카오 계정 |
| 4 | ~~B. 실거래 재수집 → 재계산 → 적재~~ → **C 의 전체 수집(GitHub Actions)으로 대체 (2026-10-08)** | – | – |
| 5 | G. 백테스트 한 번 더 (직거래 제외 효과) | 5분 | B 의 결과 |
| 6 | C. GitHub Actions 전체 수집 → 매일 자동 수집 켜기 | 2~3시간 (대부분 대기) | GitHub 시크릿 3개 (어느 기기든 가능) |
| 7 | H. 라이브에서 눈으로 확인 | 20분 | 중개사·관리자 계정 (어느 기기든 가능) |
| – | D. 360 실사진 · F. 알림 메일 발송 | 따로 | 카메라 앱 · 메일 서비스 키 |

---

## 0. 코드가 데스크톱에서도 똑같이 도는지 (5분, 키 불필요)

- [ ] 자동 테스트

```bash
npm test
```

```bash
python -m unittest scripts/fetch_trades_test.py scripts/import_listings_test.py
```

  기대: node 165개 통과, python 34개 **전부** 통과.
  노트북에서는 원본 데이터가 없어 python 3개가 실패했다(`test_present_sido_returns_rows_without_header`, `import_listings_test` 의 2개).
  수집기(`fetch-trades.py`)를 노트북에서 고쳤으므로(거래유형 열 · 장애 시 기존 이력 보존) 데스크톱에서 통과하는지가 첫 확인이다. 실패하면 테스트 이름을 노트북 세션에 알려주기.

- [ ] 워크플로 리허설 (Git Bash, PyYAML 필요: `pip install pyyaml`)

```bash
python scripts/rehearsal/rehearse.py
```

  기대: `리허설 결과: 확인 56개 중 56개 통과`

---

## A. 카카오 키 — 지도 · 집 앞 로드뷰 · 등록 시 주소→좌표

- [x] 카카오 디벨로퍼스(developers.kakao.com) → 내 애플리케이션 → 앱 추가 → **JavaScript 키** 복사 (2026-10-06, 앱 "급매")
- [x] (2026-10-06) 앱 설정 → 플랫폼 → Web → 사이트 도메인에 `http://localhost:5173`, `https://guepmae.vercel.app` 등록
- [ ] 제품 설정 → 카카오맵 → **사용 설정 ON** (이걸 안 켜면 SDK 가 조용히 실패한다)
- [ ] `.env.local` 에 `VITE_KAKAO_APP_KEY=발급키` 추가
- [x] Vercel → 프로젝트 → Settings → Environment Variables 에 같은 키 추가 → Redeploy (2026-10-06, Production 만. 새 화면에서는 Settings → Environments → Production 안에 있다)
- [ ] 검증 (로컬): 중개사로 매물 등록 → 상세 지도 탭에 마커(좌표 저장됨) → "360 투어" 탭에 집 앞 로드뷰가 매물 쪽을 보며 열림. 단지 안쪽 주소는 "로드뷰 없음 → 사진" 폴백이 정상
- [ ] 검증 (라이브): 같은 흐름. 브라우저 콘솔에 `[kakao]` 오류가 없어야 함 — 매물 상세 로드뷰 표시는 확인(2026-10-06). 등록 시 좌표 저장은 미확인
- [ ] 카카오 지도(2026-10-06 추가, 키가 있으면 기본 지도): 지도 검색에 카카오 지도·할인율 마커·묶음이 보이고, 마커를 누르면 정보창, "로드뷰 길 보기"를 누르면 파란 선. 매물 상세 위치 지도·뷰어 지도 탭도 카카오. 이 기능은 가짜 SDK 로만 검증했다

키가 없어도 앱은 사진 폴백으로 동작하므로 급하지 않다.

---

## B. 실거래 재수집 → 새 판정 규칙 반영 (MOLIT_API_KEY · 원본 CSV)

> **2026-10-08: 데스크톱에서 할 필요 없음.** 전체 재수집·집계·적재·번들 커밋은 C 의 GitHub Actions
> (`trades-bootstrap` → `daily-trades-refresh`)가 한다. 매물은 중개사 포털 직접 등록으로만 채우므로
> 아래의 매물 재계산·`properties` 적재 단계도 해당 없음(번들 매물 0건). 아래는 수동으로 돌릴 때의 참고 기록이다.

왜: 판정 규칙(직거래 제외·최근 12/24/36개월·층 구간)은 **개별 실거래**가 있어야 돌아간다.
거래유형(중개/직거래) 열은 2026-09-29 에 수집기에 추가됐고, 기존 CSV 에는 없다 → 전량 재수집.
2026-06 실측 약 11시간, API 일 한도(10,000회) 안. 밤에 돌리고 `--resume` 으로 이어받는다.

- [ ] `.env.local` 에 `MOLIT_API_KEY`(디코딩 키) 확인
- [ ] 재수집 (한도에 걸리면 다음날 `--resume`)

```bash
python scripts/fetch-trades.py
```

  확인: `scripts/data/api_*.csv` 헤더가 10열이고 마지막이 `거래유형`, 값에 `중개거래`/`직거래` 가 섞여 있어야 한다.
  광주·전남이 `total=0` 이면 API 장애(2026-08 전례) — 나머지 시도만 진행하고 나중에 `python scripts/fetch-trades.py --since 2023-10 광주광역시 전라남도`.

- [ ] 집계·번들 (순서 중요 — 중앙값 테이블이 먼저)

```bash
node scripts/build-complex-prices.mjs
node scripts/build-complex-trades.mjs
node scripts/build-price-trends.mjs
node scripts/import-trades-csv.mjs
node scripts/build-public-bundles.mjs
node scripts/build-complex-trades-rows.mjs
```

  확인: `build-complex-prices` 로그의 `직거래 제외 N건` 이 0 보다 커야 한다.
  `public/data/complex_trades.json` 이 생기고 4,000행 전후, 4MB 안팎.

- [ ] 매물 재계산 — **이전 번들을 먼저 복사해 둔다** (Supabase 정리에 쓴다)

```bash
cp public/data/properties.json scripts/output/properties.prev.json
node scripts/recompute-price-basis.mjs --all
node scripts/recompute-price-basis.mjs --all --write
```

  둘째 줄은 미리보기다. 로그 끝의 제외 사유별 건수를 적어 둔다 — `판정 보류(…)`, `할인율 기준 미달`, `할인율 이상치`.
  최근 12개월 중앙값이 3년 중앙값보다 낮은 단지는 할인율이 줄어 5% 밑으로 떨어질 수 있다(설계 §10 리스크). 탈락 수가 크면 `--write` 전에 멈추고 상의.

- [ ] 리포트 재생성 (선택, GEMINI_API_KEY) — 시장 리포트는 데이터 기준월이 바뀌었을 때만

```bash
node scripts/generate-market-report.mjs
```

- [ ] Supabase 적재 (`.env.local` 에 `SUPABASE_SERVICE_ROLE_KEY` 필요)

```bash
node scripts/load-bundles-to-supabase.mjs complex_trades --upsert
node scripts/load-bundles-to-supabase.mjs complex_prices
node scripts/load-bundles-to-supabase.mjs properties --upsert --prune-against scripts/output/properties.prev.json
```

  **⚠ `properties` 는 반드시 `--upsert` 로.** 통째로 교체하면 중개사가 포털에서 등록한 매물까지 사라진다.
  그래서 옵션 없이 `properties` 를 돌리면 스크립트가 실행을 거부한다(2026-09-29 부터).
  `--prune-against` 는 재계산에서 탈락한 수집 매물만 지운다.

  확인: Supabase 대시보드에서 `complex_trades` 행 수 ≈ `scripts/output/complex_trades_rows.json` 행 수(83k 전후).
  라이브 매물 상세의 "산출 근거"가 `최근 N개월 … 중앙값` 으로 바뀌고, 가격 리포트에 산출 조건 4줄(기간·층 구간·제외·참고)이 보이면 성공.

- [ ] 커밋·푸시 (번들만 — `scripts/data/`, `scripts/output/` 은 gitignore)

```bash
git add public/data && git commit -m "chore: 실거래 재수집(거래유형) + 판정 규칙 재계산 — 매물 N건" && git push
```

- [ ] 라이브 확인: guepmae.vercel.app 매물 상세 3건에서 산출 근거 문장에 "최근 12개월" 또는 "24개월/36개월"이 보이는지, 직거래 제외 건수가 있는 단지가 있는지

---

## C. 실거래 전체 수집 + 매일 증분 수집 (GitHub Actions — 어느 기기에서든, 노트북을 켜 둘 필요 없음)

워크플로 두 개가 있다.

| 워크플로 | 언제 | 하는 일 |
|---|---|---|
| `trades-bootstrap` | 처음 한 번 (또는 전량을 다시 받아야 할 때) · 수동 실행만 | 전국 17개 시도 × 36개월을 시도별 job 으로 나눠 동시에 받는다 → 원본을 비공개 버킷(`pipeline-data`)에 올린다 → `daily-trades-refresh` 를 이어서 실행한다 |
| `daily-trades-refresh` | 매일 03:30(한국) · 수동 실행 가능 | 버킷 원본 내려받기 → 지난달까지 최근 3개월 다시 수집(신고 지연·해제 반영) → 집계 → `complex_trades` upsert → 원본 올리기. 수동 실행에서 `publish_bundles` 를 켜면 번들 재생성 · `complex_prices` 적재 · 번들 커밋까지 |

둘 다 가짜 API·가짜 Supabase 로 하는 리허설(`python scripts/rehearsal/rehearse.py`, 확인 73개)을 통과했다.
**실제 키·실제 러너로는 아직 실행 전이다** — 리허설이 확인하지 못하는 것: `uses` 액션(checkout·setup·아티팩트), `npm ci`, 실제 API·Supabase 응답, GitHub 러너에서 국토부 API 접속.
번들 매물이 0건이면(포털 직접 등록만 쓰는 지금) 매물 재계산·`properties` 적재는 건너뛴다 — 포털 매물은 DB 에만 있고 건드리지 않는다.

- [ ] **1. 시크릿 등록** — GitHub → 저장소 → Settings → Secrets and variables → Actions → New repository secret
  - `MOLIT_API_KEY` — 국토부 **디코딩** 키
  - `SUPABASE_URL` — `https://oormfipegcfbhvctikfl.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` — 적재·원본 보관용 (publishable 키가 아님, 절대 커밋 금지)
- [ ] **2. 전체 수집** — Actions 탭 → `trades-bootstrap` → Run workflow → 기본값 그대로 실행
  - `점검` job: 시크릿 확인 → API 시험 호출 1회 → 시도 목록. 여기서 실패하면 키(디코딩 키인지·활용 신청 승인)를 확인한다.
  - `수집` job 17개가 동시에 최대 6개씩 돈다. 경기도가 가장 오래 걸린다(1~3시간 예상).
  - 한 달이라도 못 받은 시도, API 일일 한도(10,000회)에 걸린 시도는 그 job 만 실패한다.
    → **다음 날 같은 실행 화면에서 "Re-run failed jobs"** 를 누르면 실패한 시도만 다시 받고 저장까지 이어간다.
  - `원본 저장` job: 17개를 버킷에 올리고 `daily-trades-refresh` 를 `months=1 · dry_run=false · publish_bundles=true` 로 실행한다.
- [ ] **3. 이어서 돈 `daily-trades-refresh` 확인** — 전체 수집이 끝난 뒤 자동으로 시작한다
  - 성공하면 `chore(data): …` 봇 커밋이 main 에 생긴다 → Vercel 새 배포 확인 (안 생기면 Vercel 대시보드에서 Redeploy)
  - Supabase `complex_trades` 행 수가 수만 행 이상, `latest_year_month` 최댓값이 지난달
  - 같은 날 API 한도를 이미 거의 썼으면 "일일 한도 도달" 경고(노란색)만 남기고 받은 데까지 반영한다 — 정상
- [ ] **4. 매일 실행 켜기** — Settings → Secrets and variables → Actions → **Variables** 탭 → `TRADES_REFRESH_ENABLED` = `true`
- [ ] 며칠 뒤 Actions 탭에서 매일 실행이 초록인지 확인. 경고(노란색) 주석: API 일일 한도·신규 0건 시도
- [ ] 파이프라인 스크립트나 워크플로를 고쳤으면 푸시 전에 리허설 (2~3분, PyYAML 필요: `pip install pyyaml`)

```bash
python scripts/rehearsal/rehearse.py
```

특정 시도만 다시 받기(예: 광주·전남 API 장애가 풀린 뒤): `trades-bootstrap` 의 `sidos` 에 `광주광역시,전라남도`. 나머지 시도는 버킷의 원본을 그대로 쓴다.

`daily-trades-refresh` 가 실패로 끝나는 경우(메일이 온다)와 뜻:
- `행 수가 줄었습니다` — 전체 또는 한 시도의 행이 직전보다 2% 넘게 줄었다. 아무것도 올리지 않았고 버킷 원본은 그대로다. 다음 날 실행이 정상이면 넘어가도 된다.
- `모든 시도가 신규 0건입니다` — API 키 만료·전면 장애. 공공데이터포털에서 키 상태를 확인한다.
- `버킷에 원본이 없습니다`(안내) — 아직 `trades-bootstrap` 을 돌리지 않았다.

알려진 제약: 전체 수집은 API 약 9,150회(254 시군구 × 36개월) — 일 한도 10,000회 안이지만 같은 날 다른 호출이 있으면 넘칠 수 있다. 매일 수집은 762회(× 3개월).
비용: 저장소가 공개(public)라 Actions 실행 시간은 무료·무제한이다.
공개 저장소는 실행 로그도 공개된다 — 시크릿 값은 GitHub 이 가려 주지만, 스크립트에 키나 요청 URL 을 출력하는 코드를 넣지 않는다.

---

## D. 360 투어 실사진 확보 (키 불필요, 카메라·앱 필요)

- [ ] Insta360 앱(폰) 또는 Insta360 Studio(PC)에서 상위 폴더의 `IMG_20260501_*.insp` 중 3~5장을 **360 사진(JPG)** 으로 내보내기
- [ ] 저장소 밖 폴더(예: `창동/360-samples/`)에 두고, 노트북 세션에 알려주기 → 실사진으로 투어·처리 시간(6080×3040) 재검증
- [ ] .insp 자동 변환은 2026-09-29 구현됨 — 원본 .insp 를 그대로 올려 변환 화질을 앱 내보내기 JPG 와 나란히 비교 (이음새·색 차이)
- [ ] 갈래 편집기(2026-09-29 구현): 실제 집 구조로 화살표를 이어 보고, 파노라마 **클릭**으로 방향이 잘 잡히는지 확인 (노트북 세션에서는 브라우저 화면이 숨겨져 각도 입력으로만 검증했다)

---

## E. 이미 끝난 것 (참고)

- Supabase 마이그레이션은 노트북에서 라이브에 적용됨(2026-09-29): `property_360_bucket`, `complex_trades_table`, `properties_discount_rate_nullable`, `property_photos_bucket_limits_owner`, `complex_alerts`, `pipeline_data_bucket`, `pilot_metrics`. 데스크톱에서 `npx supabase db push` 를 다시 돌릴 필요 없음 — 돌리더라도 `if not exists`/`drop policy if exists` 라 안전.
- Vercel 은 `main` 푸시마다 자동 배포. 환경변수만 A 에서 추가.

---

## F. 관심 단지 급매 알림 — 발송 (메일 서비스 키)

구독 저장·관리·지표는 끝났다(2026-09-29). 남은 것은 실제 발송이다.
설계: `docs/superpowers/specs/2026-09-29-complex-alerts-design.md` §9

- [ ] 메일 서비스 선택·가입 (예: Resend 무료 월 3,000통) → API 키 발급
- [ ] 발신 도메인 인증(SPF/DKIM). 도메인이 없으면 서비스 기본 발신 주소로 시작
- [ ] Supabase → Edge Functions → Secrets 에 메일 키 등록 (예: `RESEND_API_KEY`). 저장소·`.env` 에 커밋 금지
- [ ] 발송 함수 구현 요청 (노트북/데스크톱 어느 세션이든): 매물 검증 시 또는 하루 1회, `matchAlerts` 규칙으로 대상 선정 → 발송 → 발송 로그
- [ ] 이중 확인(double opt-in): 신청 직후 확인 메일 → 링크 클릭 시 `confirmed_at` 기록 → 확인된 구독에만 발송 (타인 이메일 도용 방지)
- [ ] 메일 하단 해지 링크: `https://guepmae.vercel.app/alerts?token=<unsubscribe_token>` (해지 화면은 이미 동작)
- [ ] 검증: 본인 이메일로 신청 → 테스트 매물 검증 → 메일 수신 → 해지 링크 클릭 → 관리자 화면 신청 수 감소

---

## G. 판정 규칙 백테스트 (키 불필요, 원본 CSV 필요)

과거 실거래로 판정 규칙의 정확도를 잰다. 코드는 끝났고(2026-09-29) 합성 데이터로만 검증했다 —
**실제 거래 데이터로는 아직 한 번도 돌리지 않았다.** 노트북에는 원본 CSV 가 없다.
설계·지표 정의·한계: `docs/superpowers/specs/2026-09-29-backtest-design.md`

재수집(B) 전에도 돌릴 수 있다. 다만 지금 CSV 에는 거래유형이 없어 직거래를 걸러내지 못한다(리포트 맨 위에 경고가 뜬다).
재수집 뒤 한 번 더 돌려 두 결과를 비교하면 직거래 제외의 효과가 보인다.

- [ ] 개별 실거래 산출물 만들기 (이미 있으면 생략 — `scripts/output/complex_trades_rows.json`)

```bash
node scripts/build-complex-trades.mjs
node scripts/build-complex-trades-rows.mjs
```

- [ ] 백테스트 실행 (거래 150만 건 기준 1분 안쪽, 메모리 1GB 안쪽 예상)

```bash
node scripts/backtest-price-basis.mjs
```

  결과: `scripts/output/backtest_report.md`(읽는 문서) · `backtest_report.json`(전체 숫자). 둘 다 gitignore 라 커밋되지 않는다.
  콘솔 첫 줄의 `검증 대상 2025-10~2026-04` 처럼 7개월 안팎이 잡히면 정상. "검증할 달이 없습니다"가 나오면 데이터가 30개월보다 짧은 것이다 → `--min-history 12`.

- [ ] 리포트를 열어 아래를 확인하고, 숫자를 노트북 세션에 알려주기 (규칙 보완 여부를 같이 판단)
  - 요약: 기준가 오차 중앙값 · ±5% 이내 비율 · 치우침의 부호(+ 상승장 / − 하락장)
  - 요약: 정밀도(판정 급매 중 이후 시세로도 5% 이상 쌌던 비율) · 재현율
  - 2절: 운영 규칙이 `36개월 전체 중앙값`(옛 규칙)보다 오차가 작은가 — 기간 창의 효과
  - 2절: `층 보정 없음` · `기준월 = 달력 기준` 과의 차이
  - 3절: 판정 할인율이 큰 구간일수록 실현 할인율도 큰가 · 급매 기준을 7%·10% 로 올리면 정밀도가 얼마나 오르는가
  - 4.3·4.4절: 표본 3~4건, 기준월 경과 7개월 이상 구간의 오차가 유난히 큰가
- [ ] (선택) 지역별로 따로 보기

```bash
node scripts/backtest-price-basis.mjs --sido 서울특별시 --out scripts/output/backtest-seoul
```

- [ ] (선택) 결과를 저장소 문서로 남기기 — 저장소가 공개라 **누구나 볼 수 있다.** 숫자를 보고 결정한다

```bash
node scripts/backtest-price-basis.mjs --md docs/BACKTEST.md
```

읽을 때 주의: 채점 대상은 호가가 아니라 **체결가**다. 실제 매물의 급매 비율·정밀도는 이 숫자와 다를 수 있다.
사이트에 "판정 정확도"를 공개하는 화면은 아직 만들지 않았다 — 실제 숫자를 본 뒤에 정한다.

---

## H. 라이브에서 눈으로 확인 — 노트북에서 만든 화면 (키 불필요, 어느 기기든 가능)

노트북에서는 Supabase 키 없이 로컬 데모 모드로만 화면을 확인했다. 라이브(guepmae.vercel.app)는 하이브리드 모드라
저장·업로드가 실제 Supabase 로 간다. 권한(RLS)은 요청을 직접 보내 확인했지만, **실제 계정으로 화면을 눌러 본 적은 없다.**

매수자 (로그인 없이)

- [ ] 매물 상세 → "관심 단지 급매 알림"에 이메일을 넣고 신청 → 완료 문구
- [ ] `/alerts` 에 방금 신청한 알림이 보임 → 해지 → 목록에서 사라짐
- [ ] 같은 단지·같은 이메일·같은 평형으로 다시 신청하면 "이미 신청된 알림입니다"
- [ ] 매물 목록·지도에는 검증 완료 매물만 보임

중개사 계정

- [ ] 매물 등록: 단지 자동완성 → 기준가 미리보기(또는 판정 보류 사유) → 사진 3장 → 등록 → 상세로 이동 (주소가 `/properties/undefined` 가 아님)
- [ ] 상세에 사진이 보임. Supabase 대시보드 → Storage → `property-photos` 에 파일이 있고 크기가 수백 KB (긴 변 1600px 로 줄여 올린다)
- [ ] 360: `.insp` 또는 360 JPG 를 2장 이상 올림 → 변환 진행 표시 → 등록 → 상세 "360 투어" 탭 → 화살표로 지점 이동. Storage `property-360` 에 파일
- [ ] 갈래 편집기: "화살표 편집" → 파노라마를 **클릭**해 방향 지정 → 대상 지점 선택 → 등록 → 상세에서 그 방향에 화살표
- [ ] 내 매물 수정에서 360 순서·이름·화살표를 바꿔 저장 → 상세에 반영
- [ ] 목록에 없는 단지명으로 등록 → "판정 보류" 배지 · 급매 목록에는 안 보임 · 내 등록 매물에는 보임

관리자 계정

- [ ] `/agent/admin`(운영 관리) 에 알림 통계(신청 수·상위 단지)가 보임
- [ ] 대기 매물을 검증하면 목록·지도에 나타남

파일럿 지표 (2026-09-29 구현, 라이브 DB 적용됨 — 권한은 DB 에서 직접 확인했고 화면은 로컬 데모로만 확인)

- [ ] 준비: 중개사 계정으로 연락처가 있는 매물을 등록하고 관리자 계정으로 **검증**한다 — 검증 전 매물은 비로그인 방문자에게 열리지 않는다("매물을 찾을 수 없습니다")
- [ ] 로그아웃한 브라우저로 그 매물의 상세를 연다 → 관리자 "파일럿 지표"에서 그 매물의 조회가 1. 새로고침해도 1
- [ ] 같은 화면에서 전화 버튼을 누른다 → 문의 1. 이메일 버튼을 더 눌러도 1 (한 사람은 하루 한 번)
- [ ] 중개사 계정으로 **자기 매물**을 연다 → 조회가 늘지 않는다. 관리자 계정으로 열어도 늘지 않는다
- [ ] 중개사 대시보드: "최근 30일 매수자 반응"에 위 숫자가 보인다. "내 등록 매물" 표의 조회·문의 열도 같다
- [ ] 중개사 대시보드: 설문에 답하고 저장 → "답변 완료" → "답변 수정"으로 고친다
- [ ] 관리자: 기간(7일·30일·90일·전체)을 바꿔 본다. CSV 두 개를 내려받아 엑셀에서 한글이 깨지지 않는지 본다
- [ ] 파일럿을 시작하기 전에 설문의 **월 요금 구간**을 정한다 — 지금 값(1만원 미만 ~ 10만원 이상)은 임시다.
      바꾸려면 노트북 세션에 알려주기 (`src/utils/pilotMetrics.js` 의 `PRICE_BANDS` 와 DB 제약을 같이 바꿔야 한다)

뒷정리

- [ ] 확인용으로 만든 매물·알림을 지운다 (관리자 화면 또는 Supabase 대시보드). 운영 지표(알림 신청 수)에 섞이지 않게
