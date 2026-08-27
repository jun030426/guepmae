# 데이터 최신화 + 수도권 매물 재수집 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국토부 실거래를 2026-07까지 갱신하고 그 위의 집계·번들·리포트를 재생성하며, 수도권 매물을 재수집하되 산출물을 git·배포에서 격리한다.

**Architecture:** 기존 파이프라인(`fetch-trades.py` → `build-*.mjs` → `import-listings.py` → `generate-*.mjs`)을 그대로 쓰되 세 곳을 보강한다. (1) `import-listings.py`가 dry-run에서도 라이브 번들을 덮어쓰는 구멍을 막고, (2) `fetch-trades.py`에 증분 병합 모드를 추가하고, (3) 리포에 없는 `public/data/*.json` 번들 생성 스크립트를 신설한다. 크롤링은 "정규화 JSON"을 인터페이스로 두어, 수집 방식(미확정)과 엑셀 생성(확정)을 분리한다.

**Tech Stack:** Python 3.14 (stdlib `unittest`, `openpyxl` 3.1.5) · Node 18+ ESM (stdlib `node:test`, `csv-parse`, `iconv-lite`) · 국토부 OpenAPI · Gemini 2.5 Flash

## Global Constraints

- **격리:** 크롤링 산출물은 `scripts/data/`·`scripts/output/`(둘 다 `.gitignore` 대상)에만 둔다. `public/data/properties.json`과 Supabase `properties` 테이블에는 넣지 않는다. Supabase 주입은 이 계획의 범위 밖이다.
- **개인정보:** 중개사무소명·중개사 전화번호·중개사 등록번호를 수집·저장하지 않는다.
- **봇 차단:** CAPTCHA·레이트리밋 차단·접근 거부를 만나면 우회하지 않고 그 지점에서 중단한다. 부분 수집분으로 다음 단계를 진행한다.
- **의존성:** 새 npm/pip 패키지를 추가하지 않는다. 사용 가능한 것은 이미 설치된 `csv-parse`, `iconv-lite`, `openpyxl`과 각 언어 표준 라이브러리뿐이다.
- **수집 기간:** 실거래는 2026-07까지. 2026-08은 제외한다 — `market_snapshots.metadata.disclosureLag`가 "계약일 기준 약 2주 후 공개"라 8월 말 시점에 불완전하다.
- **크롤링 타겟:** `gu`가 `서울특별시`·`경기도`·`인천광역시`로 시작하는 행 중, 한 단지의 여러 면적 행에 걸친 `sample_size` 최댓값이 20 이상인 단지.
- **할인율 상수:** `MIN_SAMPLE = 3`, `MIN_DISC = 5.0`, `MAX_DISC = 40.0` — `scripts/import-listings.py:19`와 일치시킨다.
- **CSV 인코딩:** `scripts/data/*.csv`는 CP949. `scripts/output/*.csv`는 UTF-8.
- **실거래 CSV 헤더(9열, 순서 고정):** `시군구, 단지명, 거래금액(만원), 계약년월, 해제사유발생일, 전용면적(㎡), 건축년도, 층, 일`

---

### Task 1: import-listings.py 라이브 번들 기록 차단

`scripts/import-listings.py:293`이 `if APPLY:` 밖에 있어, `--apply` 없는 dry-run도 git 추적 대상인 `public/data/properties.json`을 크롤링 매물로 덮어쓴다. 격리 제약이 여기서 뚫리므로 가장 먼저 막는다.

**Files:**
- Modify: `scripts/import-listings.py:20-24` (인자 파싱), `scripts/import-listings.py:291-293` (번들 기록)
- Test: `scripts/import_listings_test.py`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `import-listings.py`가 `--emit-bundle` 플래그를 받는다. 이 플래그 없이는 `public/data/properties.json`을 쓰지 않는다. Task 10이 이 동작에 의존한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/import_listings_test.py` 생성:

```python
# scripts/import_listings_test.py — dry-run 이 라이브 번들을 건드리지 않는지 검증
import hashlib, io, json, os, shutil, subprocess, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "import-listings.py")
BUNDLE = os.path.join(ROOT, "public", "data", "properties.json")
CP_CSV = os.path.join(ROOT, "scripts", "output", "complex_prices.csv")


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def make_fixture_excel(path):
    """complex_prices.csv 의 첫 데이터 행과 매칭되는 1행짜리 매물입력 엑셀."""
    from openpyxl import Workbook
    import csv as _csv
    with open(CP_CSV, encoding="utf-8") as f:
        row = next(_csv.DictReader(f))
    wb = Workbook()
    ws = wb.active
    ws.title = "매물입력"
    ws.append(["단지명", "구/시군구", "전용면적(㎡)", "호가(원)"])
    # 중앙값의 80% → 할인율 20%, MIN_DISC(5) 와 MAX_DISC(40) 사이
    ws.append([row["complex"], row["gu"], int(row["area_m2"]),
               int(int(row["median_price"]) * 0.8)])
    wb.save(path)


class DryRunIsolation(unittest.TestCase):
    def test_dry_run_does_not_touch_public_bundle(self):
        self.assertTrue(os.path.exists(CP_CSV), "complex_prices.csv 가 필요합니다")
        before = sha256(BUNDLE)
        with tempfile.TemporaryDirectory() as td:
            xlsx = os.path.join(td, "fixture.xlsx")
            make_fixture_excel(xlsx)
            proc = subprocess.run([sys.executable, SCRIPT, xlsx],
                                  capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", cwd=ROOT)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(before, sha256(BUNDLE),
                         "dry-run 이 public/data/properties.json 을 변경했습니다")

    def test_emit_bundle_flag_writes_bundle(self):
        with tempfile.TemporaryDirectory() as td:
            backup = os.path.join(td, "properties.json.bak")
            shutil.copyfile(BUNDLE, backup)
            xlsx = os.path.join(td, "fixture.xlsx")
            make_fixture_excel(xlsx)
            try:
                proc = subprocess.run([sys.executable, SCRIPT, xlsx, "--emit-bundle"],
                                      capture_output=True, text=True,
                                      encoding="utf-8", errors="replace", cwd=ROOT)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                with io.open(BUNDLE, encoding="utf-8") as f:
                    rows = json.load(f)
                self.assertIsInstance(rows, list)
                self.assertGreaterEqual(len(rows), 1)
            finally:
                shutil.copyfile(backup, BUNDLE)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
python scripts/import_listings_test.py -v
```

Expected: `test_dry_run_does_not_touch_public_bundle` FAIL — "dry-run 이 public/data/properties.json 을 변경했습니다"

- [ ] **Step 3: 인자 파싱에 --emit-bundle 추가**

`scripts/import-listings.py:22-24`를 다음으로 교체:

```python
APPLY = "--apply" in sys.argv
EMIT_BUNDLE = "--emit-bundle" in sys.argv or APPLY
FILES = [a for a in sys.argv[1:] if not a.startswith("--")]
```

- [ ] **Step 4: 번들 기록을 플래그 뒤로 옮기기**

`scripts/import-listings.py:291-293`을 다음으로 교체:

```python
# 로컬 번들용 매물 JSON — --emit-bundle 또는 --apply 일 때만.
# git 추적 대상 파일이므로 dry-run 은 절대 건드리지 않는다.
if EMIT_BUNDLE:
    _pub = os.path.join(ROOT, "public", "data"); os.makedirs(_pub, exist_ok=True)
    json.dump(rows, open(os.path.join(_pub, "properties.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"번들 기록: public/data/properties.json ({len(rows)}건)")
else:
    print("번들 미기록(dry-run). --emit-bundle 로 public/data/properties.json 갱신.")
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
python scripts/import_listings_test.py -v
```

Expected: 2 tests, OK

- [ ] **Step 6: 사용법 주석 갱신**

`scripts/import-listings.py:4-8`의 사용법 블록에 한 줄 추가:

```python
#   python scripts/import-listings.py "<엑셀들...>" --emit-bundle   # public/data/properties.json 까지 갱신
```

- [ ] **Step 7: git status 로 번들 미변경 확인**

```bash
git status --short public/data/properties.json
```

Expected: 출력 없음

- [ ] **Step 8: 커밋**

```bash
git add scripts/import-listings.py scripts/import_listings_test.py
git commit -m "fix: import-listings dry-run 이 라이브 매물 번들을 덮어쓰지 않도록 --emit-bundle 게이트 추가"
```

---

### Task 2: fetch-trades.py 증분 병합 모드

전량 재수집은 2026-06-25에 약 11시간이 걸렸다(`scripts/data/api_*.csv` 타임스탬프 02:57→14:24). 기존 CSV가 2026-06까지 덮으므로 2026-06·07만 받아 병합한다.

**Files:**
- Modify: `scripts/fetch-trades.py` — `load_env` 내성, `months_since`/`merge_rows`/`read_existing_rows` 추가, `fetch_sido` 시그니처 확장, `__main__` 인자 파싱
- Test: `scripts/fetch_trades_test.py`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `months_since(since_ym: str, today: datetime.date) -> list[str]` — `'2026-06'`, `date(2026,8,27)` → `['202606', '202607']`
  - `merge_rows(existing: list[list[str]], fresh: list[list[str]], months: list[str]) -> list[list[str]]` — **월 단위 교체.** fresh 가 실제로 행을 반환한 월은 기존 행을 버리고 fresh 로 교체하고, 나머지 월의 기존 행은 순서 그대로 유지. 행 단위 중복 제거는 쓰지 않는다 — CSV 9열에 동(棟) 컬럼이 없어 같은 단지·면적·계약일·층·금액의 별개 거래가 구분되지 않는다(실측 충돌률 대전 4.33% / 광주 3.78%)
  - `read_existing_rows(sido: str) -> list[list[str]] | None` — `api_<sido>.csv` 없으면 `None`
  - CLI: `python scripts/fetch-trades.py --since YYYY-MM [시도...]`

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/fetch_trades_test.py` 생성:

```python
# scripts/fetch_trades_test.py — 증분 병합 순수 함수 검증
import datetime, importlib.util, os, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "fetch_trades", os.path.join(ROOT, "scripts", "fetch-trades.py"))
ft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ft)

# 헤더: 시군구, 단지명, 거래금액(만원), 계약년월, 해제사유발생일, 전용면적(㎡), 건축년도, 층, 일
def row(sigungu="서울특별시 강남구 역삼동", apt="래미안", amount="150000",
        ym="202606", cdeal="", area="84.97", built="2005", floor="7", day="15"):
    return [sigungu, apt, amount, ym, cdeal, area, built, floor, day]


class MonthsSince(unittest.TestCase):
    def test_excludes_current_month(self):
        # 2026-08-27 기준 --since 2026-06 → 06, 07 (08 은 공개 지연으로 제외)
        self.assertEqual(ft.months_since("2026-06", datetime.date(2026, 8, 27)),
                         ["202606", "202607"])

    def test_single_month(self):
        self.assertEqual(ft.months_since("2026-07", datetime.date(2026, 8, 1)),
                         ["202607"])

    def test_crosses_year_boundary(self):
        self.assertEqual(ft.months_since("2025-11", datetime.date(2026, 2, 3)),
                         ["202511", "202512", "202601"])

    def test_future_since_is_empty(self):
        self.assertEqual(ft.months_since("2026-09", datetime.date(2026, 8, 27)), [])


class MergeRows(unittest.TestCase):
    """월 단위 교체 병합: fresh 는 months 구간을 완전히 재수집한 결과이므로
    그 구간은 통째로 교체하고, 나머지 월의 기존 행은 그대로 둔다.
    행 단위 dedup 은 쓰지 않는다 — CSV 에 동(棟) 컬럼이 없어 같은 단지·면적·
    계약일·층·금액의 서로 다른 거래를 구분할 수 없기 때문이다."""

    def test_fetched_month_replaces_existing_rows(self):
        existing = [row(ym="202605", day="15"), row(ym="202605", day="16")]
        fresh = [row(ym="202605", day="20")]
        merged = ft.merge_rows(existing, fresh, ["202605"])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged, fresh)

    def test_months_outside_fetched_range_survive(self):
        existing = [row(ym="202604", day="10"), row(ym="202605", day="15")]
        fresh = [row(ym="202605", day="20")]
        merged = ft.merge_rows(existing, fresh, ["202605"])
        self.assertIn(existing[0], merged)

    def test_identical_looking_distinct_transactions_both_kept(self):
        # CSV 가 기록하는 모든 필드(시군구/단지명/전용면적/계약년월/일/층/거래금액)가
        # 같아도, 동(棟)이 달라 실제로는 별개인 거래 — 둘 다 살아남아야 한다.
        existing = []
        fresh = [row(ym="202606"), row(ym="202606")]
        merged = ft.merge_rows(existing, fresh, ["202606"])
        self.assertEqual(len(merged), 2)

    def test_month_with_no_fresh_rows_is_not_replaced(self):
        # 신규 수집분에 해당 월이 하나도 없으면 수집 실패일 수 있으므로
        # 기존 행을 지우지 않는다.
        existing = [row(ym="202605", day="15"), row(ym="202606", day="16")]
        fresh = [row(ym="202606", day="20")]
        merged = ft.merge_rows(existing, fresh, ["202605", "202606"])
        self.assertIn(existing[0], merged)

    def test_empty_fresh_preserves_everything(self):
        existing = [row(ym="202606", day="15"), row(ym="202606", day="16")]
        merged = ft.merge_rows(existing, [], ["202606"])
        self.assertEqual(merged, existing)

    def test_ordering_kept_existing_first_then_fresh(self):
        existing = [row(ym="202604", day="10"), row(ym="202605", day="15")]
        fresh = [row(ym="202605", day="20")]
        merged = ft.merge_rows(existing, fresh, ["202605"])
        self.assertEqual(merged, [existing[0]] + fresh)


class ReadExisting(unittest.TestCase):
    def test_missing_sido_returns_none(self):
        self.assertIsNone(ft.read_existing_rows("존재하지않는시도"))

    def test_present_sido_returns_rows_without_header(self):
        rows = ft.read_existing_rows("서울특별시")
        self.assertIsNotNone(rows)
        self.assertGreater(len(rows), 0)
        self.assertNotEqual(rows[0][0], "시군구")
        self.assertEqual(len(rows[0]), 9)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
python scripts/fetch_trades_test.py -v
```

Expected: FAIL — `AttributeError: module 'fetch_trades' has no attribute 'months_since'`

- [ ] **Step 3: load_env 를 .env.local 없이도 견디게**

`scripts/fetch-trades.py:25-31`의 `load_env`를 다음으로 교체:

```python
def load_env():
    e = {}
    p = os.path.join(ROOT, ".env.local")
    if not os.path.exists(p):
        return e
    for line in open(p, encoding="utf-8"):
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1); e[k.strip()] = v.strip()
    return e
```

- [ ] **Step 4: 순수 함수 3개 추가**

`scripts/fetch-trades.py`의 `recent_months` 정의 바로 아래에 삽입:

```python
def months_since(since_ym, today=None):
    """since_ym('YYYY-MM') 부터 지난달까지의 'YYYYMM' 목록.
    오늘이 속한 달은 공개 지연(계약일 +2주) 때문에 제외한다."""
    if today is None: today = datetime.date.today()
    y, m = int(since_ym[:4]), int(since_ym[5:7])
    end_y, end_m = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    out = []
    while (y, m) <= (end_y, end_m):
        out.append(f"{y}{m:02d}")
        m += 1
        if m == 13: m = 1; y += 1
    return out


def merge_rows(existing, fresh, months):
    """fresh 는 months 구간을 완전히 재수집한 결과다.
    그 구간은 통째로 교체하고, 나머지 월의 기존 행은 그대로 둔다.

    행 단위 중복 제거는 쓰지 않는다 — CSV 에 동(棟) 컬럼이 없어서
    같은 단지·면적·계약일·층·금액의 서로 다른 거래가 구분되지 않는다.
    실측 충돌률 대전 4.33% / 광주 3.78% (전부 실제 별개 거래).

    fresh 가 한 건도 없는 월은 수집 실패일 수 있으므로 교체하지 않는다.
    """
    fetched = {m for m in months if any(r[3] == m for r in fresh)}
    kept = [r for r in existing if r[3] not in fetched]
    return kept + fresh


def read_existing_rows(sido):
    """api_<sido>.csv 를 헤더 제외하고 읽는다. 파일이 없으면 None."""
    path = os.path.join(DATA, f"api_{sido}.csv")
    if not os.path.exists(path): return None
    with open(path, encoding="cp949", errors="replace", newline="") as f:
        rows = list(csv.reader(f))
    return [r for r in rows[1:] if len(r) == len(HEADER)]
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
python scripts/fetch_trades_test.py -v
```

Expected: 15 tests, OK

- [ ] **Step 6: fetch_sido 에 병합 경로 추가**

`scripts/fetch-trades.py`의 `fetch_sido` 시그니처를 교체:

```python
def fetch_sido(sido, codes_for_sido, months, calls, merge=False):
```

`out_path = os.path.join(DATA, f"api_{sido}.csv")` 줄 **직전**에 삽입:

```python
    if merge:
        existing = read_existing_rows(sido)
        if existing is None:
            raise SystemExit(
                f"❌ {sido}: api_{sido}.csv 가 없어 증분 병합 불가. "
                f"먼저 전량 수집하세요 — python scripts/fetch-trades.py {sido} --months 38")
        before = len(rows)
        rows = merge_rows(existing, rows, months)
        print(f"    병합: 기존 {len(existing)}건 + 신규 {before}건 → {len(rows)}건")
```

그리고 `backup_old_manual(sido)` 호출을 조건부로 바꾼다 — 증분 모드는 전량 교체가 아니므로 수동 CSV를 옮기면 안 된다:

```python
    if not merge:
        backup_old_manual(sido)
```

- [ ] **Step 7: __main__ 인자 파싱에 --since 추가**

`months_n = 36` 부터 `sido_args = ...` 까지를 다음으로 교체:

```python
    months_n = 36
    since = None
    if "--since" in argv: since = argv[argv.index("--since") + 1]
    if "--months" in argv: months_n = int(argv[argv.index("--months") + 1])
    resume = "--resume" in argv
    sido_args = [a for a in argv if not a.startswith("--") and not a.isdigit()
                 and a != since]
```

`months = recent_months(months_n)` 를 교체:

```python
    months = months_since(since) if since else recent_months(months_n)
    if not months:
        print("수집할 월이 없습니다. --since 값을 확인하세요."); sys.exit(1)
```

`print(f"대상 시도 ...")` 줄의 `({months_n}개월)` 부분을 `({len(months)}개월)` 로 교체.

`total_rows += fetch_sido(sido, by_sido[sido], months, calls)` 를 교체:

```python
            total_rows += fetch_sido(sido, by_sido[sido], months, calls, merge=bool(since))
```

- [ ] **Step 8: 사용법 주석 갱신**

`scripts/fetch-trades.py:4-10` 사용법 블록에 추가:

```python
#   python scripts/fetch-trades.py --since 2026-06         # 증분: 2026-06~지난달만 받아 기존 CSV 에 병합
```

- [ ] **Step 9: 테스트 재실행 + CLI 가드 확인**

```bash
python scripts/fetch_trades_test.py -v
```

Expected: 15 tests, OK

```bash
python scripts/fetch-trades.py --since 2026-09
```

Expected: `수집할 월이 없습니다.` 후 종료 코드 1

- [ ] **Step 10: 커밋**

```bash
git add scripts/fetch-trades.py scripts/fetch_trades_test.py
git commit -m "feat: fetch-trades --since 증분 병합 모드 (월 단위 교체·기존 이력 보존)"
```

---

### Task 3: 실거래 수집 실행

`api_*.csv`는 15개 시도만 있다. 충청남도·충청북도는 2026-06-25 수집이 일일 한도에 걸려 중단돼 아직 수동 CSV(2025-05~2026-05) 상태다. 이 둘에 `--since`를 쓰면 Task 2 Step 6의 가드가 막아준다 — 전량 수집으로 따로 돌린다.

**Files:**
- Modify: `scripts/data/api_*.csv` (gitignore 대상 — 커밋 없음)
- Create: `scripts/data/api_충청남도.csv`, `scripts/data/api_충청북도.csv`

**Interfaces:**
- Consumes: Task 2의 `--since` CLI
- Produces: 2026-07까지 덮는 전국 17개 시도 `api_*.csv`. Task 5가 입력으로 쓴다.

- [ ] **Step 1: API 키 동작 확인**

```bash
python scripts/fetch-trades.py --probe
```

Expected: `rc=00 total=<숫자>` 와 샘플 행 1줄. `rc` 가 00이 아니면 `.env.local`의 `MOLIT_API_KEY`(디코딩 키)를 점검하고 여기서 멈춘다.

- [ ] **Step 2: 기존 행 수 기록 (병합 검증 기준선)**

```bash
python -c "import glob,os; print({os.path.basename(p): sum(1 for _ in open(p,encoding='cp949',errors='replace'))-1 for p in sorted(glob.glob('scripts/data/api_*.csv'))})"
```

출력을 메모해 둔다. Step 4 이후 어떤 시도도 이 값보다 줄면 안 된다.

- [ ] **Step 3: 충청남도·충청북도 전량 수집**

38개월(2023-07~2026-08)로 기존 api_ 시도와 기간을 맞춘다. 30 시군구 × 38개월 ≈ 1,140 요청.

```bash
python scripts/fetch-trades.py 충청남도 충청북도 --months 38
```

Expected: `충청남도: <건수>건 → api_충청남도.csv` 및 충청북도 동일. `backup_old_manual`이 `충청남도250529~260529.csv`를 `_manual_backup/`으로 옮긴 로그도 함께 나온다.

일일 한도(종료 코드 2)에 걸리면 다음 날 `--resume`으로 이어받는다:

```bash
python scripts/fetch-trades.py 충청남도 충청북도 --months 38 --resume
```

- [ ] **Step 4: 나머지 15개 시도 증분 수집**

254 - 30 = 224 시군구 × 2개월 ≈ 448 요청.

```bash
python scripts/fetch-trades.py --since 2026-06 강원특별자치도 경기도 경상남도 경상북도 광주광역시 대구광역시 대전광역시 부산광역시 서울특별시 세종특별자치시 울산광역시 인천광역시 전라남도 전북특별자치도 제주특별자치도
```

Expected: 시도마다 `병합: 기존 N건 + 신규 M건 → K건` (K >= N) 로그가 나온다.

- [ ] **Step 5: 행 수가 줄지 않았는지 검증**

```bash
python -c "import glob,os; print({os.path.basename(p): sum(1 for _ in open(p,encoding='cp949',errors='replace'))-1 for p in sorted(glob.glob('scripts/data/api_*.csv'))})"
```

Expected: 17개 파일. 각 시도 행 수가 Step 2 기록치 이상.

- [ ] **Step 6: 2026-07 행이 실제로 들어왔는지 검증**

`scripts/output/_check_months.py` 를 만들어 실행한다:

```python
import csv, glob, collections
c = collections.Counter()
for p in glob.glob('scripts/data/api_*.csv'):
    with open(p, encoding='cp949', errors='replace', newline='') as f:
        for r in list(csv.reader(f))[1:]:
            if len(r) == 9:
                c[r[3]] += 1
for ym in sorted(c)[-5:]:
    print(ym, c[ym])
```

```bash
python scripts/output/_check_months.py
```

Expected: 마지막 줄이 `202607 <0보다 큰 수>`. `202608`이 보이면 무시해도 된다 — Task 5의 집계가 기간을 다시 자른다.

- [ ] **Step 7: git 청결 확인 (커밋 없음)**

```bash
git status --short
```

Expected: `scripts/data/` 하위 파일이 나타나지 않는다. 이 태스크는 커밋하지 않는다.

---

### Task 4: public 번들 생성 스크립트 신설

`build-*.mjs`는 `scripts/output/*.csv`까지만 만든다. `public/data/complex_prices.json`과 `market_snapshots.json`을 만드는 코드가 리포에 없다. 현행 번들을 역설계한 규칙: `complex_prices.json` = `complex_prices.csv`를 `sample_size` 내림차순 정렬한 상위 4,000행(현행 최소값 69). `market_snapshots.json` = `src/data/marketData.json`의 키 재매핑(`build-market-snapshots-seed-sql.mjs:47-55`와 동일).

**Files:**
- Create: `scripts/build-public-bundles.mjs`
- Test: `scripts/build-public-bundles.test.mjs`

**Interfaces:**
- Consumes: `scripts/output/complex_prices.csv` (Task 5가 생성), `src/data/marketData.json` (Task 5가 생성)
- Produces:
  - `topComplexRows(csvText: string, limit?: number) -> object[]` — `sample_size` 내림차순 상위 N행. 숫자 필드(`area_m2`, `median_price`, `sample_size`, `built_year`)는 number, 나머지는 string. `built_year`가 빈 문자열이면 `null`.
  - `buildMarketSnapshots(marketData: object) -> object` — `{regional, monthly, area_type, top_urgent, insights, metadata}` 키를 가진 객체
  - CLI: `node scripts/build-public-bundles.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/build-public-bundles.test.mjs` 생성:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { topComplexRows, buildMarketSnapshots } from './build-public-bundles.mjs';

const CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '가단지,서울특별시 중구 신당동,서울특별시 중구,84,60–85㎡,900000000,12,2023-07,2026-07,2005',
  '나단지,경기도 성남시 분당구 정자동,경기도 성남시 분당구,59,60㎡ 이하,700000000,40,2023-08,2026-06,2011',
  '다단지,인천광역시 연수구 송도동,인천광역시 연수구,101,85–102㎡,800000000,25,2024-01,2026-07,',
].join('\n');

test('topComplexRows sorts by sample_size descending', () => {
  const rows = topComplexRows(CSV);
  assert.deepEqual(rows.map((r) => r.complex), ['나단지', '다단지', '가단지']);
});

test('topComplexRows respects the limit', () => {
  assert.equal(topComplexRows(CSV, 2).length, 2);
});

test('topComplexRows coerces numeric fields', () => {
  const [first] = topComplexRows(CSV);
  assert.equal(first.sample_size, 40);
  assert.equal(first.median_price, 700000000);
  assert.equal(first.area_m2, 59);
  assert.equal(first.built_year, 2011);
});

test('topComplexRows maps a blank built_year to null', () => {
  const row = topComplexRows(CSV).find((r) => r.complex === '다단지');
  assert.equal(row.built_year, null);
});

test('topComplexRows preserves the area_bucket en-dash label', () => {
  const row = topComplexRows(CSV).find((r) => r.complex === '가단지');
  assert.equal(row.area_bucket, '60–85㎡');
});

test('buildMarketSnapshots remaps marketData keys', () => {
  const snapshots = buildMarketSnapshots({
    regionalSnapshots: [{ region: '경기' }],
    monthlyMarketTrend: [{ month: '2026-07' }],
    areaTypeBreakdown: [{ bucket: '60㎡ 이하' }],
    topUrgentComplexes: [{ complex: '가단지' }],
    marketInsights: [{ title: 'x' }],
    dataSource: { lastUpdated: '2026-08-27', months: ['2026-07'] },
  });
  assert.deepEqual(snapshots.regional, [{ region: '경기' }]);
  assert.deepEqual(snapshots.monthly, [{ month: '2026-07' }]);
  assert.deepEqual(snapshots.area_type, [{ bucket: '60㎡ 이하' }]);
  assert.deepEqual(snapshots.top_urgent, [{ complex: '가단지' }]);
  assert.deepEqual(snapshots.insights, [{ title: 'x' }]);
  assert.equal(snapshots.metadata.lastUpdated, '2026-08-27');
});

test('buildMarketSnapshots defaults missing keys to empty collections', () => {
  const snapshots = buildMarketSnapshots({});
  assert.deepEqual(snapshots.regional, []);
  assert.deepEqual(snapshots.monthly, []);
  assert.deepEqual(snapshots.area_type, []);
  assert.deepEqual(snapshots.top_urgent, []);
  assert.deepEqual(snapshots.insights, []);
  assert.deepEqual(snapshots.metadata, {});
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
node --test scripts/build-public-bundles.test.mjs
```

Expected: FAIL — `Cannot find module .../scripts/build-public-bundles.mjs`

- [ ] **Step 3: 구현 작성**

`scripts/build-public-bundles.mjs` 생성:

```javascript
/*
 * build-public-bundles.mjs
 *
 * scripts/output/complex_prices.csv + src/data/marketData.json 을
 * 프론트가 읽는 public/data/*.json 번들로 변환한다.
 *
 *   → public/data/complex_prices.json   (sample_size 내림차순 상위 4,000행)
 *   → public/data/market_snapshots.json (key/value 스냅샷 객체)
 *
 * 실행: node scripts/build-public-bundles.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const COMPLEX_LIMIT = 4000;
const NUMERIC = new Set(['area_m2', 'median_price', 'sample_size', 'built_year']);

export function topComplexRows(csvText, limit = COMPLEX_LIMIT) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const rows = records.map((rec) => {
    const out = {};
    for (const [key, raw] of Object.entries(rec)) {
      if (!NUMERIC.has(key)) { out[key] = raw; continue; }
      const trimmed = String(raw ?? '').trim();
      out[key] = trimmed === '' ? null : Number(trimmed);
    }
    return out;
  });
  rows.sort((a, b) => (b.sample_size ?? 0) - (a.sample_size ?? 0));
  return rows.slice(0, limit);
}

export function buildMarketSnapshots(marketData) {
  return {
    regional: marketData.regionalSnapshots ?? [],
    monthly: marketData.monthlyMarketTrend ?? [],
    area_type: marketData.areaTypeBreakdown ?? [],
    top_urgent: marketData.topUrgentComplexes ?? [],
    insights: marketData.marketInsights ?? [],
    metadata: marketData.dataSource ?? {},
  };
}

function main() {
  const publicData = path.join(projectRoot, 'public', 'data');
  fs.mkdirSync(publicData, { recursive: true });

  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_prices.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`${csvPath} 가 없습니다. node scripts/build-complex-prices.mjs 를 먼저 실행하세요.`);
  }
  const complexRows = topComplexRows(fs.readFileSync(csvPath, 'utf8'));
  const complexOut = path.join(publicData, 'complex_prices.json');
  fs.writeFileSync(complexOut, JSON.stringify(complexRows), 'utf8');
  const minSample = complexRows.length ? complexRows[complexRows.length - 1].sample_size : 0;
  console.log(`[bundles] complex_prices.json: ${complexRows.length}행 (최소 sample_size ${minSample})`);

  const marketPath = path.join(projectRoot, 'src', 'data', 'marketData.json');
  if (!fs.existsSync(marketPath)) {
    throw new Error(`${marketPath} 가 없습니다. node scripts/import-trades-csv.mjs 를 먼저 실행하세요.`);
  }
  const snapshots = buildMarketSnapshots(JSON.parse(fs.readFileSync(marketPath, 'utf8')));
  const snapshotOut = path.join(publicData, 'market_snapshots.json');
  fs.writeFileSync(snapshotOut, JSON.stringify(snapshots), 'utf8');
  const months = snapshots.metadata.months ?? [];
  console.log(`[bundles] market_snapshots.json: ${months.length}개월 (~${months[months.length - 1] ?? '?'}), lastUpdated ${snapshots.metadata.lastUpdated ?? '?'}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
node --test scripts/build-public-bundles.test.mjs
```

Expected: `# pass 7`, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add scripts/build-public-bundles.mjs scripts/build-public-bundles.test.mjs
git commit -m "feat: public/data 번들 생성 스크립트 (complex_prices, market_snapshots)"
```

---

### Task 5: 집계 + 번들 재생성

Task 3의 새 CSV 위에서 모든 파생 산출물을 다시 만든다. 순서가 중요하다 — `complex_prices.csv`가 할인율 판정의 기준선이라 Task 6·8·10보다 먼저 나와야 한다.

**Files:**
- Modify: `scripts/output/complex_prices.csv`, `complex_trades.csv`, `price_trends.csv` (gitignore)
- Modify: `src/data/marketData.json`, `src/data/complexLookup.json` (gitignore)
- Modify: `public/data/complex_prices.json`, `public/data/market_snapshots.json` (git 추적 — 커밋 대상)

**Interfaces:**
- Consumes: Task 3의 `scripts/data/api_*.csv`, Task 4의 `build-public-bundles.mjs`
- Produces: 2026-07 기준 `scripts/output/complex_prices.csv`. Task 6·10·11이 입력으로 쓴다.

- [ ] **Step 1: 단지×면적 중앙값 재생성**

```bash
node scripts/build-complex-prices.mjs
```

Expected: `[complex] 단지+구+평형 그룹 <8만 이상>개` 와 `scripts/output/complex_prices.csv (약 11MB)`

- [ ] **Step 2: 최신 거래월이 2026-07 인지 검증**

`scripts/output/_check_latest.mjs` 를 만들어 실행한다:

```javascript
import fs from 'node:fs';
const t = fs.readFileSync('scripts/output/complex_prices.csv', 'utf8').split(/\r?\n/).filter(Boolean);
const h = t[0].split(',');
const i = h.indexOf('latest_year_month');
let max = '';
for (let k = 1; k < t.length; k += 1) {
  const v = t[k].split(',')[i];
  if (v > max) max = v;
}
console.log('latest_year_month 최댓값:', max, '| 행:', t.length - 1);
```

```bash
node scripts/output/_check_latest.mjs
```

Expected: `latest_year_month 최댓값: 2026-07`

- [ ] **Step 3: 단지별 개별 실거래 재생성**

```bash
node scripts/build-complex-trades.mjs
```

Expected: `scripts/output/complex_trades.csv` 생성 로그

- [ ] **Step 4: 시세 추이 재생성**

```bash
node scripts/build-price-trends.mjs
```

Expected: `[trends] 기간: <시작> ~ 2026-07` 로그

- [ ] **Step 5: 시장 집계 재생성**

```bash
node scripts/import-trades-csv.mjs
```

Expected: `src/data/marketData.json` 과 `src/data/complexLookup.json` 기록 로그

- [ ] **Step 6: public 번들 재생성**

```bash
node scripts/build-public-bundles.mjs
```

Expected: 두 줄 로그. `market_snapshots.json` 줄의 `(~2026-07)` 확인.

- [ ] **Step 7: 번들 검증**

`scripts/output/_check_bundles.mjs` 를 만들어 실행한다:

```javascript
import fs from 'node:fs';
const ms = JSON.parse(fs.readFileSync('public/data/market_snapshots.json', 'utf8'));
const cp = JSON.parse(fs.readFileSync('public/data/complex_prices.json', 'utf8'));
console.log('months 끝:', ms.metadata.months.at(-1), '| lastUpdated:', ms.metadata.lastUpdated);
console.log('regional:', ms.regional.length, '| monthly:', ms.monthly.length);
console.log('complex_prices 행:', cp.length, '| 최소 sample_size:', cp.at(-1).sample_size);
```

```bash
node scripts/output/_check_bundles.mjs
```

Expected: `months 끝: 2026-07`, `regional: 17`, `complex_prices 행: 4000`

- [ ] **Step 8: 앱이 새 번들로 뜨는지 확인**

`npm run dev` 후 `/report` 와 `/` 를 열어 콘솔 에러가 없는지 본다. 확인 뒤 서버를 종료한다.

- [ ] **Step 9: 커밋**

```bash
git add public/data/complex_prices.json public/data/market_snapshots.json
git commit -m "chore: 실거래 2026-07 기준 집계·번들 재생성"
```

---

### Task 6: 크롤링 타겟 단지 목록 추출

수도권 고유 단지는 16,225개이나, 표본이 얇은 단지는 `import-listings.py`의 `MIN_SAMPLE = 3`에서 어차피 탈락한다. `sample_size` 최댓값 20 이상인 단지만 뽑는다(Task 5 재생성 직후 기준 약 5,853개).

**Files:**
- Create: `scripts/build-crawl-targets.mjs`
- Test: `scripts/build-crawl-targets.test.mjs`
- Output: `scripts/output/crawl_targets.csv` (gitignore)

**Interfaces:**
- Consumes: `scripts/output/complex_prices.csv` (Task 5)
- Produces:
  - `pickCapitalTargets(csvText: string, minSample?: number) -> {gu: string, complex: string, max_sample: number, areas: number[]}[]` — `max_sample` 내림차순 정렬
  - `scripts/output/crawl_targets.csv` — 열 `gu,complex,max_sample,areas` (`areas`는 `|` 구분). Task 8·9의 수집 대상 목록.

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/build-crawl-targets.test.mjs` 생성:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCapitalTargets } from './build-crawl-targets.mjs';

const CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '가단지,서울특별시 중구 신당동,서울특별시 중구,84,60–85㎡,900000000,25,2023-07,2026-07,2005',
  '가단지,서울특별시 중구 신당동,서울특별시 중구,59,60㎡ 이하,700000000,8,2023-07,2026-07,2005',
  '나단지,경기도 성남시 분당구 정자동,경기도 성남시 분당구,59,60㎡ 이하,700000000,40,2023-08,2026-06,2011',
  '다단지,인천광역시 연수구 송도동,인천광역시 연수구,101,85–102㎡,800000000,19,2024-01,2026-07,2018',
  '라단지,강원특별자치도 원주시 무실동,강원특별자치도 원주시,84,60–85㎡,300000000,90,2023-07,2026-07,2015',
].join('\n');

test('keeps only capital-region complexes', () => {
  const gus = pickCapitalTargets(CSV).map((t) => t.gu);
  assert.ok(!gus.some((g) => g.startsWith('강원')));
});

test('drops complexes whose max sample_size is below the threshold', () => {
  // 다단지 최댓값 19 < 20
  assert.deepEqual(pickCapitalTargets(CSV).map((t) => t.complex), ['나단지', '가단지']);
});

test('keeps a complex when any one area row clears the threshold', () => {
  // 가단지는 84㎡ 가 25 라 살아남는다 (59㎡ 는 8)
  const target = pickCapitalTargets(CSV).find((t) => t.complex === '가단지');
  assert.equal(target.max_sample, 25);
});

test('collects every area of a kept complex, sorted ascending', () => {
  const target = pickCapitalTargets(CSV).find((t) => t.complex === '가단지');
  assert.deepEqual(target.areas, [59, 84]);
});

test('sorts targets by max_sample descending', () => {
  const samples = pickCapitalTargets(CSV).map((t) => t.max_sample);
  assert.deepEqual(samples, [...samples].sort((a, b) => b - a));
});

test('honours a custom threshold', () => {
  assert.equal(pickCapitalTargets(CSV, 19).length, 3);
});

test('separates same-named complexes in different gu', () => {
  const dup = [
    'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
    '한신,서울특별시 중구 신당동,서울특별시 중구,84,60–85㎡,900000000,25,2023-07,2026-07,2005',
    '한신,경기도 수원시 팔달구 인계동,경기도 수원시 팔달구,84,60–85㎡,500000000,30,2023-07,2026-07,2001',
  ].join('\n');
  assert.equal(pickCapitalTargets(dup).length, 2);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
node --test scripts/build-crawl-targets.test.mjs
```

Expected: FAIL — `Cannot find module .../scripts/build-crawl-targets.mjs`

- [ ] **Step 3: 구현 작성**

`scripts/build-crawl-targets.mjs` 생성:

```javascript
/*
 * build-crawl-targets.mjs
 *
 * complex_prices.csv 에서 수도권(서울·경기·인천) 단지 중
 * 실거래 표본이 두꺼운 곳만 추려 수집 대상 목록을 만든다.
 *
 * 표본이 얇은 단지는 import-listings.py 의 MIN_SAMPLE(3) 에서 탈락하므로
 * 미리 걸러 요청 수를 줄인다.
 *
 *   → scripts/output/crawl_targets.csv
 *
 * 실행: node scripts/build-crawl-targets.mjs [minSample]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const CAPITAL = /^(서울특별시|경기도|인천광역시)/;
export const MIN_SAMPLE = 20;

export function pickCapitalTargets(csvText, minSample = MIN_SAMPLE) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const byComplex = new Map();
  for (const rec of records) {
    const gu = String(rec.gu ?? '').trim();
    if (!CAPITAL.test(gu)) continue;
    const complex = String(rec.complex ?? '').trim();
    if (!complex) continue;
    const key = `${gu}|${complex}`;
    let entry = byComplex.get(key);
    if (!entry) {
      entry = { gu, complex, max_sample: 0, areas: new Set() };
      byComplex.set(key, entry);
    }
    const sample = Number(rec.sample_size) || 0;
    if (sample > entry.max_sample) entry.max_sample = sample;
    const area = Number(rec.area_m2);
    if (Number.isFinite(area)) entry.areas.add(area);
  }
  return [...byComplex.values()]
    .filter((e) => e.max_sample >= minSample)
    .map((e) => ({ ...e, areas: [...e.areas].sort((a, b) => a - b) }))
    .sort((a, b) => b.max_sample - a.max_sample);
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const minSample = Number(process.argv[2]) || MIN_SAMPLE;
  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_prices.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`${csvPath} 가 없습니다. node scripts/build-complex-prices.mjs 를 먼저 실행하세요.`);
  }
  const targets = pickCapitalTargets(fs.readFileSync(csvPath, 'utf8'), minSample);

  const lines = ['gu,complex,max_sample,areas'];
  for (const t of targets) {
    lines.push([csvCell(t.gu), csvCell(t.complex), t.max_sample, csvCell(t.areas.join('|'))].join(','));
  }
  const outDir = path.join(projectRoot, 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'crawl_targets.csv');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  const byGu = new Map();
  for (const t of targets) byGu.set(t.gu, (byGu.get(t.gu) ?? 0) + 1);
  console.log(`[targets] sample_size >= ${minSample} · 수도권 ${targets.length}단지 / ${byGu.size}개 구`);
  console.log(`[targets] 출력: ${path.relative(projectRoot, outPath)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
node --test scripts/build-crawl-targets.test.mjs
```

Expected: `# pass 7`, `# fail 0`

- [ ] **Step 5: 실제 타겟 목록 생성**

```bash
node scripts/build-crawl-targets.mjs
```

Expected: `[targets] sample_size >= 20 · 수도권 <약 5,800>단지 / <약 70>개 구`

- [ ] **Step 6: 커밋 (스크립트만, 산출 CSV 는 gitignore)**

```bash
git add scripts/build-crawl-targets.mjs scripts/build-crawl-targets.test.mjs
git commit -m "feat: 수도권 크롤링 타겟 단지 추출 스크립트"
```

---

### Task 7: 정규화 JSON → 매물입력 엑셀 변환기

수집 방식은 미확정이지만 **출력 계약은 확정할 수 있다.** 정규화 JSON을 인터페이스로 두면 수집기(Task 8·9)와 엑셀 생성이 분리되고, 엑셀 쪽은 지금 TDD로 끝낼 수 있다.

**Files:**
- Create: `scripts/write-listing-excel.py`
- Test: `scripts/write_listing_excel_test.py`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `build_workbook(rows: list[dict]) -> openpyxl.Workbook` — 시트명 `매물입력`, 1행 한글 헤더
  - `header_for(rows: list[dict]) -> list[str]` — 필수 4열 + 등장한 선택열 + `사진1..N`
  - CLI: `python scripts/write-listing-excel.py <input.json> <output.xlsx>`
  - **정규화 JSON 계약** — 객체 배열. 키는 엑셀 열 이름 그대로.

```json
[
  {
    "단지명": "래미안대치팰리스",
    "구/시군구": "서울특별시 강남구",
    "전용면적(㎡)": 84,
    "호가(원)": 2650000000,
    "층": "12층",
    "향": "남향",
    "매물설명": "즉시입주 가능",
    "도로명주소": "서울특별시 강남구 삼성로 212",
    "사진": ["https://example.com/1.jpg"]
  }
]
```

필수 4키(`단지명`, `구/시군구`, `전용면적(㎡)`, `호가(원)`)가 없는 객체는 폐기하고 개수를 보고한다. `사진`은 배열이며 `사진1`, `사진2`… 열로 펼쳐진다. **중개사무소명·중개사 전화번호·중개사 등록번호 키는 허용하지 않는다 — 있으면 오류로 중단한다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/write_listing_excel_test.py` 생성:

```python
# scripts/write_listing_excel_test.py
import importlib.util, os, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "write_listing_excel", os.path.join(ROOT, "scripts", "write-listing-excel.py"))
wle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wle)

FULL = {"단지명": "래미안대치팰리스", "구/시군구": "서울특별시 강남구",
        "전용면적(㎡)": 84, "호가(원)": 2650000000}


class HeaderTest(unittest.TestCase):
    def test_required_columns_come_first(self):
        h = wle.header_for([FULL])
        self.assertEqual(h[:4], ["단지명", "구/시군구", "전용면적(㎡)", "호가(원)"])

    def test_optional_columns_appended_in_canonical_order(self):
        h = wle.header_for([{**FULL, "향": "남향", "층": "12층"}])
        self.assertEqual(h[4:], ["층", "향"])  # FIELD_ORDER 순서, 등장 순서가 아님

    def test_photo_columns_expand_to_max_count(self):
        h = wle.header_for([{**FULL, "사진": ["a"]}, {**FULL, "사진": ["a", "b", "c"]}])
        self.assertEqual(h[-3:], ["사진1", "사진2", "사진3"])

    def test_no_photo_columns_when_absent(self):
        self.assertNotIn("사진1", wle.header_for([FULL]))


class BuildWorkbookTest(unittest.TestCase):
    def test_sheet_is_named_maemul(self):
        wb = wle.build_workbook([FULL])
        self.assertEqual(wb.sheetnames, ["매물입력"])

    def test_row_values_land_under_their_header(self):
        wb = wle.build_workbook([{**FULL, "향": "남향"}])
        ws = wb["매물입력"]
        header = [c.value for c in ws[1]]
        row = [c.value for c in ws[2]]
        self.assertEqual(row[header.index("단지명")], "래미안대치팰리스")
        self.assertEqual(row[header.index("호가(원)")], 2650000000)
        self.assertEqual(row[header.index("향")], "남향")

    def test_photos_spread_across_columns(self):
        wb = wle.build_workbook([{**FULL, "사진": ["u1", "u2"]}])
        ws = wb["매물입력"]
        header = [c.value for c in ws[1]]
        row = [c.value for c in ws[2]]
        self.assertEqual(row[header.index("사진1")], "u1")
        self.assertEqual(row[header.index("사진2")], "u2")

    def test_rows_missing_required_fields_are_dropped(self):
        wb = wle.build_workbook([FULL, {"단지명": "이름만"}])
        self.assertEqual(wb["매물입력"].max_row, 2)  # 헤더 + 1행

    def test_blank_optional_cell_is_none(self):
        wb = wle.build_workbook([{**FULL, "향": "남향"}, FULL])
        ws = wb["매물입력"]
        header = [c.value for c in ws[1]]
        self.assertIsNone([c.value for c in ws[3]][header.index("향")])


class PrivacyGuardTest(unittest.TestCase):
    def test_agent_columns_are_rejected(self):
        for banned in ("중개사무소명", "중개사 전화번호", "중개사 등록번호"):
            with self.assertRaises(ValueError, msg=banned):
                wle.build_workbook([{**FULL, banned: "x"}])


class RoundTripTest(unittest.TestCase):
    def test_saved_file_reopens_with_expected_shape(self):
        from openpyxl import load_workbook
        wb = wle.build_workbook([FULL, {**FULL, "단지명": "두번째"}])
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "out.xlsx")
            wb.save(p)
            reopened = load_workbook(p, data_only=True)
        self.assertIn("매물입력", reopened.sheetnames)
        self.assertEqual(reopened["매물입력"].max_row, 3)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
python scripts/write_listing_excel_test.py -v
```

Expected: FAIL — `FileNotFoundError` (`write-listing-excel.py` 없음)

- [ ] **Step 3: 구현 작성**

`scripts/write-listing-excel.py` 생성:

```python
#!/usr/bin/env python
# 정규화 매물 JSON → import-listings.py 가 읽는 "매물입력" 엑셀
#
# 사용:
#   python scripts/write-listing-excel.py <input.json> <output.xlsx>
#
# 입력 JSON: 객체 배열. 키는 엑셀 열 이름 그대로.
#   필수 — 단지명, 구/시군구, 전용면적(㎡), 호가(원)
#   선택 — 제목, 층, 방수, 욕실수, 준공연도, 향, 공급면적(㎡), 관리비(원),
#          주차, 입주가능일, 거주상태, 세대수, 매물설명, 도로명주소, 주소
#   사진 — 문자열 배열. 사진1, 사진2 … 열로 펼쳐진다.
#
# 중개사 개인정보 열은 금지한다.
import json, re, sys
from openpyxl import Workbook

REQUIRED = ["단지명", "구/시군구", "전용면적(㎡)", "호가(원)"]

# import-listings.py:200 의 FIELDS 와 같은 집합. 엑셀 열 순서를 고정한다.
FIELD_ORDER = ["제목", "층", "방수", "욕실수", "준공연도", "향", "공급면적(㎡)",
               "관리비(원)", "주차", "입주가능일", "거주상태", "세대수",
               "매물설명", "도로명주소", "주소"]

# 중개사 개인정보 열 차단. 정확 일치가 아니라 부분 문자열로 판정한다 —
# 수집기가 "중개사무소 전화", "담당자 연락처" 같은 변형 라벨을 보낼 수 있다.
# 허용 열(REQUIRED + FIELD_ORDER + 사진N) 중 어느 것도 아래 조각을 포함하지 않는다.
BANNED_PARTS = ["중개", "전화", "연락처", "휴대", "등록번호", "담당자"]


def _assert_no_private_columns(rows):
    for row in rows:
        for key in row:
            flat = re.sub(r"\s+", "", str(key))
            for part in BANNED_PARTS:
                if part in flat:
                    raise ValueError(
                        f"중개사 개인정보 열은 수집·저장하지 않습니다: {key!r}")


def _is_complete(row):
    return all(row.get(k) not in (None, "") for k in REQUIRED)


def header_for(rows):
    """필수 4열 + 등장한 선택열(FIELD_ORDER 순) + 사진1..N"""
    present = {k for row in rows for k in row}
    header = list(REQUIRED)
    header += [f for f in FIELD_ORDER if f in present]
    max_photos = 0
    for row in rows:
        photos = row.get("사진") or []
        if isinstance(photos, list):
            max_photos = max(max_photos, len(photos))
    header += [f"사진{i + 1}" for i in range(max_photos)]
    return header


def build_workbook(rows):
    _assert_no_private_columns(rows)
    kept = [r for r in rows if _is_complete(r)]
    header = header_for(kept)
    wb = Workbook()
    ws = wb.active
    ws.title = "매물입력"
    ws.append(header)
    for row in kept:
        photos = row.get("사진") or []
        line = []
        for col in header:
            if col.startswith("사진"):
                idx = int(col[2:]) - 1
                line.append(photos[idx] if idx < len(photos) else None)
            else:
                line.append(row.get(col))
        ws.append(line)
    return wb


def main():
    if len(sys.argv) < 3:
        print("사용: python scripts/write-listing-excel.py <input.json> <output.xlsx>")
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        rows = json.load(f)
    wb = build_workbook(rows)
    wb.save(dst)
    kept = wb["매물입력"].max_row - 1
    print(f"입력 {len(rows)}행 → 채택 {kept}행 (필수 4열 미충족 {len(rows) - kept}행 폐기)")
    print(f"출력: {dst}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
python scripts/write_listing_excel_test.py -v
```

Expected: 11 tests, OK

- [ ] **Step 5: 커밋**

```bash
git add scripts/write-listing-excel.py scripts/write_listing_excel_test.py
git commit -m "feat: 정규화 매물 JSON → 매물입력 엑셀 변환기 (중개사 개인정보 열 차단)"
```

---

### Task 8: 호갱노노 페이지 구조 확인 + 1개 구 시범 수집

**이 태스크는 조사다.** 호갱노노의 단지별 URL 매핑을 보유하고 있지 않아, 단지 단위 순회가 맞는지 지도 영역 단위가 맞는지 실제 페이지를 보고 정한다. 수집기 코드는 여기서 확인한 구조에 맞춰 Task 9에서 쓴다.

**Files:**
- Create: `scripts/output/crawl_notes.md` (gitignore — 조사 결과 기록)
- Create: `scripts/data/normalized_인천광역시_연수구.json` (gitignore)
- Create: `scripts/data/hogangnono_인천광역시_연수구.xlsx` (gitignore)

**Interfaces:**
- Consumes: Task 6의 `scripts/output/crawl_targets.csv`, Task 7의 `write-listing-excel.py`
- Produces: `crawl_notes.md` — 매물 목록이 실린 요청의 URL 형태, 응답 포맷(HTML/JSON), 단지 식별자 체계, 단지명·전용면적·호가에 대응하는 필드명, 레이트리밋 관측치. Task 9의 수집기가 이 문서를 근거로 작성된다.

- [ ] **Step 1: 시범 대상 구의 타겟 수 확인**

인천 연수구는 현행 395건 중 70건이 나온 최다 지역이라 매칭률 비교 기준이 있다.

`scripts/output/_check_yeonsu.mjs` 를 만들어 실행한다:

```javascript
import fs from 'node:fs';
const lines = fs.readFileSync('scripts/output/crawl_targets.csv', 'utf8')
  .split(/\r?\n/).filter(Boolean).slice(1);
const rows = lines.filter((l) => l.startsWith('인천광역시 연수구,'));
console.log('연수구 타겟 단지:', rows.length);
console.log(rows.slice(0, 5).join('\n'));
```

```bash
node scripts/output/_check_yeonsu.mjs
```

Expected: `연수구 타겟 단지: <수십>` 과 샘플 5행

- [ ] **Step 2: 페이지 구조 확인**

브라우저로 호갱노노 단지 페이지를 하나 연다. 확인할 것:

1. 매물 목록이 HTML에 인라인인지, 별도 요청(XHR/fetch) 응답인지
2. 그 요청의 URL 형태와 단지 식별자 체계 (`crawl_targets.csv`의 `단지명 + gu`로 그 식별자를 얻는 경로가 있는지)
3. 응답에서 **단지명 · 전용면적 · 호가 · 층 · 향 · 매물설명**에 해당하는 필드명
4. 응답에 중개사 정보가 섞여 있는지 (있어도 **읽지 않고 버린다**)
5. 연속 요청 시 레이트리밋·차단이 언제 걸리는지

**중단 조건:** CAPTCHA, 접근 거부, 레이트리밋 차단 중 하나라도 나오면 우회하지 않고 중단한다. 그 사실을 `crawl_notes.md`에 적고 Task 9·10을 건너뛴 뒤, 현행 395건 유지로 Task 11(강원 재계산)·Task 12(리포트)만 진행한다.

- [ ] **Step 3: 조사 결과 기록**

`scripts/output/crawl_notes.md`에 위 5항목의 답을 적는다. 실제 요청 URL 예시 1개와 응답 필드 매핑 표를 포함한다.

- [ ] **Step 4: 연수구 정규화 JSON 생성**

Task 7의 계약대로 `scripts/data/normalized_인천광역시_연수구.json`을 만든다. `구/시군구` 값은 반드시 `crawl_targets.csv`의 `gu` 표기와 문자 단위로 일치해야 한다 (예: `인천광역시 연수구`). **중개사 키는 넣지 않는다** — Task 7의 가드가 오류로 막는다.

- [ ] **Step 5: 엑셀 변환**

```bash
python scripts/write-listing-excel.py scripts/data/normalized_인천광역시_연수구.json scripts/data/hogangnono_인천광역시_연수구.xlsx
```

Expected: `입력 <N>행 → 채택 <M>행` 과 출력 경로

- [ ] **Step 6: 매칭률 검증 (이 태스크의 통과 기준)**

```bash
python scripts/import-listings.py "scripts/data/hogangnono_인천광역시_연수구.xlsx"
```

```bash
cat scripts/output/_import_report.txt
```

Expected: `단지미매칭` 비율이 총행의 50% 미만. 6월 전국 기준선은 20,997행 중 5,492행(26%)이었다.

**50%를 넘으면 여기서 멈춘다.** 크롤링 단지명 표기가 국토부 표기와 체계적으로 다르다는 뜻이다. 미매칭 단지명 표본을 `crawl_notes.md`에 적고, `import-listings.py`의 `resolve_complex` 정규화 규칙을 손볼지 크롤링 쪽 표기를 바꿀지 정한 뒤 Step 4로 돌아온다.

- [ ] **Step 7: 라이브 번들 미변경 확인**

```bash
git status --short
```

Expected: 출력 없음. `public/data/properties.json`이 나타나면 Task 1이 제대로 안 된 것이다 — 진행을 멈추고 Task 1로 돌아간다.

- [ ] **Step 8: 커밋 (코드 변경이 있을 때만)**

Step 6에서 `resolve_complex`를 손봤다면:

```bash
git add scripts/import-listings.py
git commit -m "fix: 단지명 정규화 규칙 보정 — 수집 표기 대응"
```

손댄 게 없으면 이 태스크는 커밋 없이 넘어간다.

---

### Task 9: 수도권 전체 수집 → 엑셀

Task 8에서 확인한 구조로 나머지 수도권 구를 수집한다.

**Files:**
- Create: `scripts/data/normalized_수도권_20260827.json` (gitignore)
- Create: `scripts/data/hogangnono_수도권_20260827.xlsx` (gitignore)

**Interfaces:**
- Consumes: Task 6의 `crawl_targets.csv`, Task 8의 `crawl_notes.md`, Task 7의 `write-listing-excel.py`
- Produces: Task 10이 dry-run에 넣을 엑셀 1개

- [ ] **Step 1: 구 단위로 나눠 수집**

`crawl_targets.csv`를 `gu` 기준으로 처리하고, 구 하나가 끝날 때마다 `scripts/data/normalized_<gu>.json`으로 저장한다. 중간 중단에 대비한 체크포인트다.

**중단 조건은 Task 8과 같다** — CAPTCHA·접근 거부·레이트리밋 차단이 나오면 우회하지 않고 중단하고, 그때까지 저장된 구들로 다음 단계를 진행한다.

- [ ] **Step 2: 구별 JSON 병합**

`scripts/output/_merge_normalized.mjs` 를 만들어 실행한다:

```javascript
import fs from 'node:fs';
import path from 'node:path';

const dir = 'scripts/data';
const OUT = 'normalized_수도권_20260827.json';
const files = fs.readdirSync(dir)
  .filter((f) => f.startsWith('normalized_') && f.endsWith('.json') && f !== OUT);
const all = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
fs.writeFileSync(path.join(dir, OUT), JSON.stringify(all), 'utf8');
console.log('병합:', files.length, '개 구 →', all.length, '행');
console.log('구 수:', new Set(all.map((r) => r['구/시군구'])).size);
```

```bash
node scripts/output/_merge_normalized.mjs
```

Expected: `병합: <N>개 구 → <M>행`

- [ ] **Step 3: 엑셀 변환**

```bash
python scripts/write-listing-excel.py scripts/data/normalized_수도권_20260827.json scripts/data/hogangnono_수도권_20260827.xlsx
```

Expected: `입력 <M>행 → 채택 <K>행`

- [ ] **Step 4: 개인정보 열이 없는지 최종 확인**

`scripts/output/_check_privacy.py` 를 만들어 실행한다:

```python
from openpyxl import load_workbook

REQUIRED = ['단지명', '구/시군구', '전용면적(㎡)', '호가(원)']

ws = load_workbook('scripts/data/hogangnono_수도권_20260827.xlsx', data_only=True)['매물입력']
header = [c.value for c in ws[1]]
print('열:', header)

missing = [c for c in REQUIRED if c not in header]
print('누락 필수열:', missing)
assert not missing, missing

banned = [h for h in header if h and ('중개' in h or '연락처' in h or '전화' in h)]
print('금지열:', banned)
assert not banned, banned

print('행 수:', ws.max_row - 1)
print('OK - 필수 4열 존재, 개인정보 열 없음')
```

```bash
python scripts/output/_check_privacy.py
```

Expected: `OK - 필수 4열 존재, 개인정보 열 없음`

- [ ] **Step 5: git 청결 확인 (커밋 없음)**

```bash
git status --short
```

Expected: 출력 없음

---

### Task 10: dry-run 검증 + 주입 결정 게이트

**Files:**
- Create: `scripts/output/_import_report.txt`, `scripts/output/properties_insert.sql` (gitignore)

**Interfaces:**
- Consumes: Task 9의 엑셀, Task 5의 `complex_prices.csv`, Task 1의 `--emit-bundle` 게이트
- Produces: 채택 건수·지역 분포. 주입 여부 결정의 근거.

- [ ] **Step 1: dry-run 실행**

`--apply`도 `--emit-bundle`도 붙이지 않는다.

```bash
python scripts/import-listings.py "scripts/data/hogangnono_수도권_20260827.xlsx"
```

Expected: 마지막 줄에 `번들 미기록(dry-run). --emit-bundle 로 public/data/properties.json 갱신.`

- [ ] **Step 2: 리포트 확인**

```bash
cat scripts/output/_import_report.txt
```

확인 항목:
- **단지 미매칭률** — 총행 대비 50% 미만이어야 한다 (6월 기준선 26%)
- **채택 건수** — 6월 수율은 20,997행 → 395건(1.9%)
- **지역별 급매 수** — 서울·경기·인천에 고르게 퍼지는지
- **지오코딩 API 신규 호출** — Google Geocoding 과금분

- [ ] **Step 3: 라이브 번들 미변경 확인**

```bash
git status --short public/data/properties.json
```

Expected: 출력 없음

- [ ] **Step 4: 결정 보고 — 여기서 멈춘다**

Step 2의 네 숫자를 사용자에게 보고하고 다음 셋 중 무엇을 할지 확인받는다. **확인 없이 진행하지 않는다.**

1. 엑셀까지만 보관 (기본값 — 추가 작업 없음)
2. 로컬 번들에만 반영 — `--emit-bundle` 실행. `public/data/properties.json`이 git 추적 대상이므로 **커밋하면 배포된다**는 점을 함께 알린다.
3. Supabase 주입 — `--apply` 실행. `src/lib/dataClient.js:96`의 오버레이 때문에 **즉시 guepmae.vercel.app에 노출된다.**

Task 11·12는 이 결정과 무관하게 진행한다.

---

### Task 11: 강원 매물 price_basis 재계산

수도권을 교체하든 안 하든 강원 141건은 6월 기준선(`computedAt: 2026-06-24`)으로 남는다. 새 중앙값으로 다시 계산하고, 할인율이 5% 아래로 떨어진 매물은 "검증된 급매"가 아니므로 제외한다.

**Files:**
- Create: `scripts/recompute-price-basis.mjs`
- Test: `scripts/recompute-price-basis.test.mjs`
- Modify: `public/data/properties.json` (git 추적 — 커밋 대상)

**Interfaces:**
- Consumes: Task 5의 `scripts/output/complex_prices.csv`
- Produces:
  - `normalizeComplex(name: string) -> string` — 공백과 `아파트` 제거. `import-listings.py`의 `norm` 과 같은 규칙
  - `buildComplexIndex(csvText: string) -> Map<string, object[]>` — 키 `` `${gu}|${normalizeComplex(complex)}` ``
  - `recomputeBasis(property: object, index: Map, today: string) -> {actual_transaction_price, discount_rate, price_basis} | null` — 기준 미달이면 `null`
  - CLI: `node scripts/recompute-price-basis.mjs <지역접두사> [--write]`

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/recompute-price-basis.test.mjs` 생성:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComplex, buildComplexIndex, recomputeBasis } from './recompute-price-basis.mjs';

const CSV = [
  'complex,sigungu,gu,area_m2,area_bucket,median_price,sample_size,earliest_year_month,latest_year_month,built_year',
  '한신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,84,60–85㎡,400000000,30,2023-07,2026-07,2015',
  '한신아파트,강원특별자치도 원주시 무실동,강원특별자치도 원주시,59,60㎡ 이하,300000000,2,2023-07,2026-07,2015',
].join('\n');

const INDEX = buildComplexIndex(CSV);
const TODAY = '2026-08-27';

const prop = (over = {}) => ({
  id: 'gm-x', region: '강원특별자치도 원주시', title: '한신 전용84㎡',
  price: 320000000, area: 84,
  price_basis: { source: 'complex', coordSource: 'places' },
  ...over,
});

test('normalizeComplex strips spaces and the 아파트 suffix', () => {
  assert.equal(normalizeComplex(' 한신 아파트 '), '한신');
  assert.equal(normalizeComplex('래미안대치팰리스'), '래미안대치팰리스');
});

test('buildComplexIndex keys on gu and normalized complex name', () => {
  assert.ok(INDEX.has('강원특별자치도 원주시|한신'));
  assert.equal(INDEX.get('강원특별자치도 원주시|한신').length, 2);
});

test('recomputeBasis returns the new median and discount', () => {
  const out = recomputeBasis(prop(), INDEX, TODAY);
  assert.equal(out.actual_transaction_price, 400000000);
  assert.equal(out.discount_rate, 20);  // (400000000-320000000)/400000000*100
});

test('recomputeBasis stamps the sample window and computedAt', () => {
  const out = recomputeBasis(prop(), INDEX, TODAY);
  assert.equal(out.price_basis.sampleSize, 30);
  assert.equal(out.price_basis.periodStart, '2023-07');
  assert.equal(out.price_basis.periodEnd, '2026-07');
  assert.equal(out.price_basis.computedAt, TODAY);
  assert.match(out.price_basis.method, /84㎡ · 2023-07~2026-07 30건 중앙값/);
});

test('recomputeBasis preserves unrelated price_basis fields', () => {
  assert.equal(recomputeBasis(prop(), INDEX, TODAY).price_basis.coordSource, 'places');
});

test('recomputeBasis returns null below MIN_DISC', () => {
  // 중앙값 400,000,000 대비 3% 할인
  assert.equal(recomputeBasis(prop({ price: 388000000 }), INDEX, TODAY), null);
});

test('recomputeBasis returns null above MAX_DISC', () => {
  // 55% 할인 — 이상치
  assert.equal(recomputeBasis(prop({ price: 180000000 }), INDEX, TODAY), null);
});

test('recomputeBasis returns null when the sample is too thin', () => {
  // 59㎡ 행은 sample_size 2 < MIN_SAMPLE(3)
  assert.equal(recomputeBasis(prop({ area: 59, price: 200000000 }), INDEX, TODAY), null);
});

test('recomputeBasis returns null when the complex is unknown', () => {
  assert.equal(recomputeBasis(prop({ region: '서울특별시 중구' }), INDEX, TODAY), null);
});

test('recomputeBasis falls back to an area within 2 and flags it approximate', () => {
  const out = recomputeBasis(prop({ area: 83 }), INDEX, TODAY);
  assert.equal(out.actual_transaction_price, 400000000);
  assert.equal(out.price_basis.approxArea, true);
  assert.equal(out.price_basis.areaM2, 84);
  assert.equal(out.price_basis.requestedAreaM2, 83);
});

test('recomputeBasis marks an exact area match as not approximate', () => {
  assert.equal(recomputeBasis(prop(), INDEX, TODAY).price_basis.approxArea, false);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
node --test scripts/recompute-price-basis.test.mjs
```

Expected: FAIL — `Cannot find module .../scripts/recompute-price-basis.mjs`

- [ ] **Step 3: 구현 작성**

`scripts/recompute-price-basis.mjs` 생성:

```javascript
/*
 * recompute-price-basis.mjs
 *
 * public/data/properties.json 의 매물 할인율 근거를 최신 complex_prices.csv 로 다시 계산한다.
 * 실거래를 갱신하면 6월 기준선으로 박제된 price_basis 가 새 중앙값과 어긋나기 때문이다.
 *
 * 재계산 후 할인율이 MIN_DISC 아래이거나 MAX_DISC 위면 "검증된 급매"가 아니므로 제외한다.
 *
 * 실행:
 *   node scripts/recompute-price-basis.mjs 강원            # 미리보기
 *   node scripts/recompute-price-basis.mjs 강원 --write    # public/data/properties.json 갱신
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// import-listings.py:19 와 같은 값
export const MIN_SAMPLE = 3;
export const MIN_DISC = 5.0;
export const MAX_DISC = 40.0;

export function normalizeComplex(name) {
  return String(name ?? '').replace(/\s+|아파트/g, '').trim();
}

export function buildComplexIndex(csvText) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const index = new Map();
  for (const rec of records) {
    const key = `${String(rec.gu ?? '').trim()}|${normalizeComplex(rec.complex)}`;
    const row = {
      complex: rec.complex,
      area_m2: Number(rec.area_m2),
      median_price: Number(rec.median_price),
      sample_size: Number(rec.sample_size),
      earliest_year_month: rec.earliest_year_month,
      latest_year_month: rec.latest_year_month,
    };
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

function pickBaseline(rows, areaM2) {
  const usable = rows.filter((r) => r.sample_size >= MIN_SAMPLE);
  const exact = usable.find((r) => r.area_m2 === areaM2);
  if (exact) return { row: exact, approx: false };
  const near = usable
    .filter((r) => Math.abs(r.area_m2 - areaM2) <= 2)
    .sort((a, b) => b.sample_size - a.sample_size)[0];
  return near ? { row: near, approx: true } : null;
}

export function recomputeBasis(property, index, today) {
  // 매물 title 은 "<단지명> 전용NN㎡ ..." 형태라 " 전용" 앞이 단지명이다
  const complexName = String(property.title ?? '').split(' 전용')[0];
  const key = `${String(property.region ?? '').trim()}|${normalizeComplex(complexName)}`;
  const rows = index.get(key);
  if (!rows) return null;

  const areaM2 = Number(property.area);
  const picked = pickBaseline(rows, areaM2);
  if (!picked) return null;

  const { row, approx } = picked;
  const price = Number(property.price);
  const discount = Math.round(((row.median_price - price) / row.median_price) * 1000) / 10;
  if (discount < MIN_DISC || discount > MAX_DISC) return null;

  return {
    actual_transaction_price: row.median_price,
    discount_rate: discount,
    price_basis: {
      ...(property.price_basis ?? {}),
      source: 'complex',
      baselinePrice: row.median_price,
      areaM2: row.area_m2,
      requestedAreaM2: areaM2,
      approxArea: approx,
      sampleSize: row.sample_size,
      periodStart: row.earliest_year_month,
      periodEnd: row.latest_year_month,
      confidence: row.sample_size >= 10 ? 'high' : 'medium',
      method: `동일 단지 ${row.area_m2}㎡ · ${row.earliest_year_month}~${row.latest_year_month} ${row.sample_size}건 중앙값`,
      computedAt: today,
    },
  };
}

function main() {
  const prefix = process.argv[2];
  const write = process.argv.includes('--write');
  if (!prefix) {
    console.error('사용: node scripts/recompute-price-basis.mjs <지역접두사> [--write]');
    process.exit(1);
  }

  const csvPath = path.join(projectRoot, 'scripts', 'output', 'complex_prices.csv');
  const index = buildComplexIndex(fs.readFileSync(csvPath, 'utf8'));
  const bundlePath = path.join(projectRoot, 'public', 'data', 'properties.json');
  const all = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  let touched = 0;
  let dropped = 0;
  const kept = [];
  for (const property of all) {
    if (!String(property.region ?? '').startsWith(prefix)) { kept.push(property); continue; }
    const next = recomputeBasis(property, index, today);
    if (!next) {
      dropped += 1;
      console.log(`  제외 ${property.title} (${property.region}) — 기준 미달`);
      continue;
    }
    touched += 1;
    kept.push({ ...property, ...next, last_verified_at: today });
  }

  console.log('-'.repeat(40));
  console.log(`[재계산] ${prefix}: 갱신 ${touched}건 / 제외 ${dropped}건 / 전체 ${all.length} → ${kept.length}건`);
  if (!write) {
    console.log('[재계산] 미리보기입니다. 반영하려면 --write 를 붙이세요.');
    return;
  }
  fs.writeFileSync(bundlePath, JSON.stringify(kept), 'utf8');
  console.log('[재계산] 기록: public/data/properties.json');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
node --test scripts/recompute-price-basis.test.mjs
```

Expected: `# pass 11`, `# fail 0`

- [ ] **Step 5: 강원 미리보기**

```bash
node scripts/recompute-price-basis.mjs 강원
```

Expected: `[재계산] 강원: 갱신 <N>건 / 제외 <M>건 / 전체 395 → <395-M>건`

제외가 141건 전부라면 단지명 매칭이 실패한 것이다. `title` 이 `"<단지명> 전용NN㎡"` 형태라는 가정을 실제 데이터로 확인한다:

`scripts/output/_check_titles.mjs` 를 만들어 실행한다:

```javascript
import fs from 'node:fs';
const all = JSON.parse(fs.readFileSync('public/data/properties.json', 'utf8'));
console.log(all.filter((p) => p.region.startsWith('강원')).slice(0, 5).map((p) => p.title));
```

```bash
node scripts/output/_check_titles.mjs
```

- [ ] **Step 6: 반영**

```bash
node scripts/recompute-price-basis.mjs 강원 --write
```

- [ ] **Step 7: 검증**

`scripts/output/_check_gangwon.mjs` 를 만들어 실행한다:

```javascript
import fs from 'node:fs';
const all = JSON.parse(fs.readFileSync('public/data/properties.json', 'utf8'));
const gw = all.filter((p) => p.region.startsWith('강원'));
console.log('강원 건수:', gw.length);
console.log('computedAt 종류:', [...new Set(gw.map((p) => p.price_basis.computedAt))]);
console.log('최소 할인율:', Math.min(...gw.map((p) => p.discount_rate)));
console.log('최대 할인율:', Math.max(...gw.map((p) => p.discount_rate)));
```

```bash
node scripts/output/_check_gangwon.mjs
```

Expected: `computedAt 종류`가 오늘 날짜 하나뿐. 최소 할인율 >= 5, 최대 <= 40.

- [ ] **Step 8: 커밋**

```bash
git add scripts/recompute-price-basis.mjs scripts/recompute-price-basis.test.mjs public/data/properties.json
git commit -m "chore: 강원 매물 price_basis 를 2026-07 실거래 기준으로 재계산"
```

---

### Task 12: 리포트 재생성 + 최종 검증

**Files:**
- Modify: `public/data/ai_market_reports.json`, `public/data/property_reports.json` (git 추적 — 커밋 대상)

**Interfaces:**
- Consumes: Task 5의 `market_snapshots.json`, Task 11의 `properties.json`
- Produces: 2026-07 기준 AI 리포트

- [ ] **Step 1: 시장 리포트 재생성**

```bash
node scripts/generate-market-report.mjs
```

Expected: `완료: 인사이트 <N>개 → public/data/ai_market_reports.json`

- [ ] **Step 2: 시장 리포트 기준일 검증**

`scripts/output/_check_reports.mjs` 를 만들어 실행한다:

```javascript
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync('public/data/ai_market_reports.json', 'utf8'));
const ms = JSON.parse(fs.readFileSync('public/data/market_snapshots.json', 'utf8'));
console.log('data_as_of:', r[0].data_as_of);
console.log('metadata.lastUpdated:', ms.metadata.lastUpdated, '| months 끝:', ms.metadata.months.at(-1));
```

```bash
node scripts/output/_check_reports.mjs
```

Expected: `months 끝: 2026-07`. `data_as_of`가 `2026-07`이어야 한다 — Gemini가 생성하는 값이라 어긋나면 `metadata.lastUpdated` 쪽이 정답이다.

- [ ] **Step 3: 매물 리포트 커버리지 확인 후 재생성**

Task 10 Step 4의 결정에 따라 최종 매물 건수가 정해진 뒤 실행한다. 기본값은 15건이고, 인자로 개수를 올릴 수 있다.

```bash
node scripts/generate-reports.mjs 15
```

Expected: `완료: <N>/15건 → public/data/property_reports.json`

- [ ] **Step 4: 앱 전체 화면 확인**

`npm run dev` 후 `/`, `/properties`, `/map`, `/report`, 매물 상세 1건을 열어 콘솔 에러가 없는지 본다. 매물 상세에서 할인율 근거 문구(`price_basis.method`)가 2026-07까지의 기간을 보여주는지 확인한다.

- [ ] **Step 5: 빌드 검증**

```bash
npm run build
```

Expected: vite 빌드 성공 + `generate-static-pages.mjs` 완료 로그

- [ ] **Step 6: 임시 점검 스크립트 정리**

Task 3·5·8·9·11·12에서 만든 `scripts/output/_check_*.{mjs,py}` 와 `_merge_normalized.mjs` 를 삭제한다. `scripts/output/` 는 gitignore 대상이라 커밋에는 영향이 없지만, 다음 실행 때 혼동을 준다.

```bash
rm -f scripts/output/_check_*.mjs scripts/output/_check_*.py scripts/output/_merge_normalized.mjs
```

- [ ] **Step 7: git 청결 최종 확인**

```bash
git status --short
```

Expected: `scripts/data/`·`scripts/output/` 하위 파일이 하나도 나타나지 않는다. 크롤링 엑셀·정규화 JSON·수집 CSV가 보이면 `.gitignore`를 점검한다.

- [ ] **Step 8: 커밋**

```bash
git add public/data/ai_market_reports.json public/data/property_reports.json
git commit -m "chore: AI 시장·매물 리포트를 2026-07 실거래 기준으로 재생성"
```
