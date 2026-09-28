#!/usr/bin/env python
# 국토교통부_아파트 매매 실거래가 "상세" API → scripts/data/ CP949 CSV (build-*.mjs 입력 포맷)
#
# 사용:
#   python scripts/fetch-trades.py --probe                # 단건 검증(강남 최근월)
#   python scripts/fetch-trades.py                        # 전국 254 시군구, 최근 36개월(3년) → 시도별 CSV
#   python scripts/fetch-trades.py --resume               # 이미 받은 시도(api_*.csv) 건너뛰고 이어받기
#   python scripts/fetch-trades.py 서울특별시 경기도        # 특정 시도만
#   python scripts/fetch-trades.py --months 13            # 기간 조정(기본 36)
#   python scripts/fetch-trades.py --since 2026-06         # 증분: 2026-06~지난달만 받아 기존 CSV 에 병합
#
# .env.local 의 MOLIT_API_KEY(디코딩 키) 필요. 시군구코드: scripts/_sigungu_codes.json
# 출력 컬럼: 시군구, 단지명, 거래금액(만원), 계약년월, 해제사유발생일, 전용면적(㎡), 건축년도, 층, 일
# 인코딩 CP949 (빌드 스크립트가 cp949 디코딩). 일 한도(10,000) 초과 시 멈춤 → --resume 으로 다음날 이어받기.
import os, sys, csv, time, json, datetime, urllib.request, urllib.parse, urllib.error
import http.client
import xml.etree.ElementTree as ET
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "scripts", "data")
BACKUP = os.path.join(DATA, "_manual_backup")
CODES_PATH = os.path.join(ROOT, "scripts", "_sigungu_codes.json")
BASE = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"

def load_env():
    e = {}
    p = os.path.join(ROOT, ".env.local")
    if not os.path.exists(p):
        return e
    for line in open(p, encoding="utf-8"):
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1); e[k.strip()] = v.strip()
    return e
KEY = load_env().get("MOLIT_API_KEY")
CODES = json.load(open(CODES_PATH, encoding="utf-8"))  # {code5: "시도 시군구"}

def recent_months(n):
    t = datetime.date.today(); y, m = t.year, t.month; out = []
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        m -= 1
        if m == 0: m = 12; y -= 1
    out.reverse(); return out

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


def district_of(sigungu, bases):
    """'경기도 성남시 분당구 정자동' → '경기도 성남시 분당구'.
    법정동이 비면 시군구만 들어 있다. bases 에 없으면 None (판단 불가 → 삭제하지 않음)."""
    head = sigungu.rsplit(" ", 1)[0]
    if head in bases:
        return head
    if sigungu in bases:
        return sigungu
    return None


def merge_rows(existing, fresh, done):
    """done: 완전히 수집된 (시군구, 계약년월) 쌍의 집합.

    그 쌍에 해당하는 기존 행만 버리고 fresh 로 교체한다. 수집이 중간에 끊긴
    쌍은 기존 행을 유지하고 fresh 쪽 부분 수집분을 버린다 — 부분 데이터로
    완전한 이력을 덮어쓰면 중복이 생기거나 행이 사라진다.

    행 단위 중복 제거는 쓰지 않는다 — CSV 에 동(棟) 컬럼이 없어서
    같은 단지·면적·계약일·층·금액의 서로 다른 거래가 구분되지 않는다.
    실측 충돌률 대전 4.33% / 광주 3.78% (전부 실제 별개 거래).
    """
    bases = {b for b, _ in done}
    # r[3]: 계약년월 (고정 9열 헤더 — 이 값이 어떤 (구, 월) 이 삭제 대상인지를 결정한다)
    kept_existing = [r for r in existing if (district_of(r[0], bases), r[3]) not in done]
    kept_fresh = [r for r in fresh if (district_of(r[0], bases), r[3]) in done]
    return kept_existing + kept_fresh


def read_existing_rows(sido):
    """api_<sido>.csv 를 헤더 제외하고 읽는다. 파일이 없으면 None."""
    path = os.path.join(DATA, f"api_{sido}.csv")
    if not os.path.exists(path): return None
    with open(path, encoding="cp949", errors="replace", newline="") as f:
        rows = list(csv.reader(f))
    body = rows[1:]
    kept = [r for r in body if len(r) == len(HEADER)]
    dropped = len(body) - len(kept)
    if dropped:
        print(f"    ⚠ {sido}: 형식이 깨진 행 {dropped}건 무시(컬럼 수 {len(HEADER)} 불일치)")
    return kept

def prevent_sleep(on=True):
    # Windows: 장시간 백그라운드 실행 중 시스템 절전 진입 방지(노트북 뚜껑 닫음은 막지 못함).
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(
            (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) if on else ES_CONTINUOUS)
    except Exception:
        pass

def cv(item, *names):
    for n in names:
        el = item.find(n)
        if el is not None and el.text is not None and el.text.strip() != "":
            return el.text.strip()
    return ""

class LimitError(Exception): pass

def fetch_page(lawd, ymd, page, rows=1000, attempts=4):
    """일시적 네트워크 오류(연결 끊김·타임아웃)는 지수 백오프로 재시도한다.

    HTTPError 는 재시도하지 않고 그대로 올려보낸다 — 호출부가 429(일일 한도)와
    그 밖의 상태코드를 구분해 처리하기 때문이다.
    """
    qs = urllib.parse.urlencode({"serviceKey": KEY, "LAWD_CD": lawd, "DEAL_YMD": ymd, "pageNo": page, "numOfRows": rows})
    url = BASE + "?" + qs
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
            if attempt == attempts:
                raise
            wait = 2 ** attempt
            print(f"    ! 네트워크 오류({type(e).__name__}) {attempt}/{attempts} — {wait}초 후 재시도", flush=True)
            time.sleep(wait)

def parse_items(xml_text):
    root = ET.fromstring(xml_text)
    code = (root.findtext(".//resultCode") or "").strip()
    msg = (root.findtext(".//resultMsg") or "").strip()
    total = root.findtext(".//totalCount")
    return code, msg, (int(total) if total and total.isdigit() else None), root.findall(".//item")

def row_from(item, sigungu_base):
    apt = cv(item, "aptNm", "아파트")
    area = cv(item, "excluUseAr", "전용면적")
    amount = cv(item, "dealAmount", "거래금액").replace(",", "").strip()
    year = cv(item, "dealYear", "년"); month = cv(item, "dealMonth", "월"); day = cv(item, "dealDay", "일")
    built = cv(item, "buildYear", "건축년도")
    umd = cv(item, "umdNm", "법정동")
    floor = cv(item, "floor", "층")
    cdeal = cv(item, "cdealDay", "해제사유발생일")
    ym = f"{year}{int(month):02d}" if year and month and month.isdigit() else ""
    return [(sigungu_base + " " + umd).strip(), apt, amount, ym, cdeal, area, built, floor, day]

HEADER = ["시군구", "단지명", "거래금액(만원)", "계약년월", "해제사유발생일", "전용면적(㎡)", "건축년도", "층", "일"]

def backup_old_manual(sido):
    # 해당 시도의 옛 수동 CSV(api_ 아님)를 _manual_backup 으로 이동 (이중집계 방지)
    os.makedirs(BACKUP, exist_ok=True)
    for f in os.listdir(DATA):
        if f.endswith(".csv") and not f.startswith("api_") and f.startswith(sido):
            os.replace(os.path.join(DATA, f), os.path.join(BACKUP, f))
            print(f"    옛 수동 CSV 백업: {f}")

def fetch_sido(sido, codes_for_sido, months, calls, merge=False, zero_yield=None):
    rows = []; cancelled = 0; done = set()
    for lawd in codes_for_sido:
        base = CODES[lawd]; rc = 0
        for ymd in months:
            page = 1
            complete = False
            while True:
                try:
                    xml = fetch_page(lawd, ymd, page); calls[0] += 1
                except urllib.error.HTTPError as e:
                    if e.code == 429: raise LimitError(f"HTTP 429 @ {base} {ymd}")
                    print(f"    ! {base} {ymd} HTTP {e.code}"); break
                code, msg, total, items = parse_items(xml)
                if code not in ("00", "000", ""):
                    if code in ("22",) or "LIMIT" in msg.upper(): raise LimitError(f"{code} {msg}")
                    print(f"    ! {base} {ymd} rc={code} {msg}"); break
                for it in items:
                    r = row_from(it, base)
                    if r[4]: cancelled += 1
                    rows.append(r); rc += 1
                if total is None or page * 1000 >= total or not items:
                    complete = True
                    break
                page += 1; time.sleep(0.05)
            if complete:
                done.add((base, ymd))
            time.sleep(0.04)
    if merge:
        existing = read_existing_rows(sido)
        if existing is None:
            raise SystemExit(
                f"❌ {sido}: api_{sido}.csv 가 없어 증분 병합 불가. "
                f"먼저 전량 수집하세요 — python scripts/fetch-trades.py {sido} --months 38")
        before = len(rows)
        rows = merge_rows(existing, rows, done)
        print(f"    병합: 기존 {len(existing)}건 + 신규 {before}건 → {len(rows)}건")
        if before == 0:
            print(f"    ⚠ {sido}: 요청한 {len(months)}개월에서 신규 0건 — 수집 실패 가능성. 기존 이력은 보존됨.")
            if zero_yield is not None:
                zero_yield.append(sido)
    out_path = os.path.join(DATA, f"api_{sido}.csv")
    with open(out_path, "w", encoding="cp949", errors="replace", newline="") as f:
        w = csv.writer(f); w.writerow(HEADER); w.writerows(rows)
    if not merge:
        backup_old_manual(sido)
    print(f"  ✅ {sido}: {len(rows)}건 (취소 {cancelled}) → api_{sido}.csv")
    return len(rows)

def probe():
    print("PROBE 강남(11680)", recent_months(1)[-1])
    code, msg, total, items = parse_items(fetch_page("11680", recent_months(1)[-1], 1, rows=3))
    print(f"rc={code} total={total}")
    if items: print("row:", row_from(items[0], CODES.get("11680", "서울특별시 강남구")))

if __name__ == "__main__":
    if not KEY: print("❌ MOLIT_API_KEY 없음"); sys.exit(1)
    argv = sys.argv[1:]
    if "--probe" in argv: probe(); sys.exit(0)
    months_n = 36
    since = None
    if "--since" in argv: since = argv[argv.index("--since") + 1]
    if "--months" in argv: months_n = int(argv[argv.index("--months") + 1])
    resume = "--resume" in argv
    if resume and since:
        print("❌ --resume 과 --since 는 함께 쓸 수 없습니다: --resume 은 api_<시도>.csv 가 이미 있는 "
              "시도를 건너뛰는데, --since 는 그 파일이 있어야만 병합할 수 있어 모든 대상이 건너뛰어지거나 "
              "실패합니다(총 0건으로 '성공' 출력). 하나만 선택하세요.")
        sys.exit(1)
    sido_args = [a for a in argv if not a.startswith("--") and not a.isdigit()
                 and a != since]

    # 시도별 그룹
    by_sido = {}
    for code, name in CODES.items():
        by_sido.setdefault(name.split()[0], []).append(code)
    targets = sido_args if sido_args else sorted(by_sido)
    months = months_since(since) if since else recent_months(months_n)
    if not months:
        print("수집할 월이 없습니다. --since 값을 확인하세요."); sys.exit(1)
    print(f"대상 시도 {len(targets)}개 | 기간 {months[0]}~{months[-1]} ({len(months)}개월) | 총 시군구 {sum(len(by_sido[s]) for s in targets if s in by_sido)}")

    calls = [0]; total_rows = 0; zero_yield_sidos = []
    prevent_sleep(True)
    try:
        for sido in targets:
            if sido not in by_sido: print(f"  ? '{sido}' 코드없음 건너뜀", flush=True); continue
            if resume and os.path.exists(os.path.join(DATA, f"api_{sido}.csv")):
                print(f"  ⏭ {sido} 이미 있음(--resume) 건너뜀", flush=True); continue
            total_rows += fetch_sido(sido, by_sido[sido], months, calls, merge=bool(since),
                                      zero_yield=zero_yield_sidos)
            print(f"     누적 API 호출 {calls[0]}회", flush=True)
    except LimitError as e:
        print(f"\n⛔ 일일 한도 도달({e}). 받은 시도까지 저장됨. `--resume` 으로 이어받으세요. (호출 {calls[0]}회)", flush=True)
        sys.exit(2)
    finally:
        prevent_sleep(False)
    print(f"\n총 {total_rows}건 | API 호출 {calls[0]}회 | 시도 {len(targets)}개 완료", flush=True)
    if zero_yield_sidos:
        print(f"⚠ 신규 0건 시도: {', '.join(zero_yield_sidos)}", flush=True)
        sys.exit(1)
