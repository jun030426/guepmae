# 데스크톱에서 할 작업 (API 키·원본 데이터가 필요한 것)

작성일: 2026-09-29 · 노트북 세션에서 코드는 끝났고, 키·데이터가 있는 데스크톱에서 실행만 남은 항목들이다.
끝난 항목은 체크하고 날짜를 적는다. 순서대로 하면 되고, A 와 B 는 서로 독립이다.

전제: 데스크톱 저장소가 `main` 최신(`154d5ff` 이후)이어야 한다.

```bash
git pull
npm install
```

---

## A. 카카오 키 — 집 앞 로드뷰 · 등록 시 주소→좌표

- [ ] 카카오 디벨로퍼스(developers.kakao.com) → 내 애플리케이션 → 앱 추가 → **JavaScript 키** 복사
- [ ] 앱 설정 → 플랫폼 → Web → 사이트 도메인에 `http://localhost:5173`, `https://guepmae.vercel.app` 등록
- [ ] 제품 설정 → 카카오맵 → **사용 설정 ON** (이걸 안 켜면 SDK 가 조용히 실패한다)
- [ ] `.env.local` 에 `VITE_KAKAO_APP_KEY=발급키` 추가
- [ ] Vercel → 프로젝트 → Settings → Environment Variables 에 같은 키 추가 → Redeploy
- [ ] 검증 (로컬): 중개사로 매물 등록 → 상세 지도 탭에 마커(좌표 저장됨) → "360 투어" 탭에 집 앞 로드뷰가 매물 쪽을 보며 열림. 단지 안쪽 주소는 "로드뷰 없음 → 사진" 폴백이 정상
- [ ] 검증 (라이브): 같은 흐름. 브라우저 콘솔에 `[kakao]` 오류가 없어야 함

키가 없어도 앱은 사진 폴백으로 동작하므로 급하지 않다.

---

## B. 실거래 재수집 → 새 판정 규칙 반영 (MOLIT_API_KEY · 원본 CSV)

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
node scripts/build-public-bundles.mjs
node scripts/build-complex-trades-rows.mjs
```

  확인: `build-complex-prices` 로그의 `직거래 제외 N건` 이 0 보다 커야 한다.
  `public/data/complex_trades.json` 이 생기고 4,000행 전후, 4MB 안팎.

- [ ] 매물 재계산 (미리보기 먼저 → 결과 보고 `--write`)

```bash
node scripts/recompute-price-basis.mjs --all
node scripts/recompute-price-basis.mjs --all --write
```

  로그 끝의 제외 사유별 건수를 적어 둔다 — `판정 보류(…)`, `할인율 기준 미달`, `할인율 이상치`.
  최근 12개월 중앙값이 3년 중앙값보다 낮은 단지는 할인율이 줄어 5% 밑으로 떨어질 수 있다(설계 §10 리스크). 탈락 수가 크면 여기서 멈추고 상의.

- [ ] 리포트 재생성 (선택, GEMINI_API_KEY) — 시장 리포트는 데이터 기준월이 바뀌었을 때만

```bash
node scripts/generate-market-report.mjs
```

- [ ] Supabase 적재 (`.env.local` 에 `SUPABASE_SERVICE_ROLE_KEY` 필요)

```bash
node scripts/load-bundles-to-supabase.mjs complex_trades
node scripts/load-bundles-to-supabase.mjs complex_prices
node scripts/load-bundles-to-supabase.mjs properties
```

  확인: Supabase 대시보드에서 `complex_trades` 행 수 ≈ `scripts/output/complex_trades_rows.json` 행 수(83k 전후).
  라이브 매물 상세의 "산출 근거"가 `최근 N개월 … 중앙값` 으로 바뀌고, 가격 리포트에 산출 조건 4줄(기간·층 구간·제외·참고)이 보이면 성공.

- [ ] 커밋·푸시 (번들만 — `scripts/data/`, `scripts/output/` 은 gitignore)

```bash
git add public/data && git commit -m "chore: 실거래 재수집(거래유형) + 판정 규칙 재계산 — 매물 N건" && git push
```

- [ ] 라이브 확인: guepmae.vercel.app 매물 상세 3건에서 산출 근거 문장에 "최근 12개월" 또는 "24개월/36개월"이 보이는지, 직거래 제외 건수가 있는 단지가 있는지

---

## C. 3단계 — 실거래 매일 증분 수집 자동화 (GitHub Actions 시크릿)

노트북에서 워크플로 파일을 만들면, 데스크톱(또는 GitHub 웹)에서 시크릿만 넣으면 된다.

- [ ] GitHub → 저장소 → Settings → Secrets and variables → Actions 에 추가
  - `MOLIT_API_KEY` — 국토부 디코딩 키
  - `SUPABASE_URL` — `https://oormfipegcfbhvctikfl.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` — 적재용 (publishable 키가 아님, 절대 커밋 금지)
- [ ] 워크플로가 생기면 Actions 탭에서 수동 실행(workflow_dispatch) 1회 → 로그에서 병합 건수·적재 건수 확인

---

## D. 360 투어 실사진 확보 (키 불필요, 카메라·앱 필요)

- [ ] Insta360 앱(폰) 또는 Insta360 Studio(PC)에서 상위 폴더의 `IMG_20260501_*.insp` 중 3~5장을 **360 사진(JPG)** 으로 내보내기
- [ ] 저장소 밖 폴더(예: `창동/360-samples/`)에 두고, 노트북 세션에 알려주기 → 실사진으로 투어·처리 시간(6080×3040) 재검증
- [ ] .insp 자동 변환은 2026-09-29 구현됨 — 원본 .insp 를 그대로 올려 변환 화질을 앱 내보내기 JPG 와 나란히 비교 (이음새·색 차이)


---

## E. 이미 끝난 것 (참고)

- Supabase 마이그레이션은 노트북에서 MCP 로 라이브에 적용됨: `property_360_bucket`, `complex_trades_table`, `properties_discount_rate_nullable` (2026-09-29). 데스크톱에서 `npx supabase db push` 를 다시 돌릴 필요 없음 — 돌리더라도 `if not exists`/`drop policy if exists` 라 안전.
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
