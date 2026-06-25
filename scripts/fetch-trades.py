#!/usr/bin/env python
# 국토교통부_아파트 매매 실거래가 "상세" API → scripts/data/ CP949 CSV (build-*.mjs 입력 포맷)
#
# 사용:
#   python scripts/fetch-trades.py --probe                # 단건 검증(강남 최근월)
#   python scripts/fetch-trades.py                        # 전국 254 시군구, 최근 36개월(3년) → 시도별 CSV
#   python scripts/fetch-trades.py --resume               # 이미 받은 시도(api_*.csv) 건너뛰고 이어받기
#   python scripts/fetch-trades.py 서울특별시 경기도        # 특정 시도만
#   python scripts/fetch-trades.py --months 13            # 기간 조정(기본 36)
#
# .env.local 의 MOLIT_API_KEY(디코딩 키) 필요. 시군구코드: scripts/_sigungu_codes.json
# 출력 컬럼: 시군구, 단지명, 거래금액(만원), 계약년월, 해제사유발생일, 전용면적(㎡), 건축년도, 층, 일
# 인코딩 CP949 (빌드 스크립트가 cp949 디코딩). 일 한도(10,000) 초과 시 멈춤 → --resume 으로 다음날 이어받기.
import os, sys, csv, time, json, datetime, urllib.request, urllib.parse, urllib.error
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
    for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
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

def fetch_page(lawd, ymd, page, rows=1000):
    qs = urllib.parse.urlencode({"serviceKey": KEY, "LAWD_CD": lawd, "DEAL_YMD": ymd, "pageNo": page, "numOfRows": rows})
    with urllib.request.urlopen(BASE + "?" + qs, timeout=40) as r:
        return r.read().decode("utf-8", "replace")

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

def fetch_sido(sido, codes_for_sido, months, calls):
    rows = []; cancelled = 0
    for lawd in codes_for_sido:
        base = CODES[lawd]; rc = 0
        for ymd in months:
            page = 1
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
                if total is None or page * 1000 >= total or not items: break
                page += 1; time.sleep(0.05)
            time.sleep(0.04)
    out_path = os.path.join(DATA, f"api_{sido}.csv")
    with open(out_path, "w", encoding="cp949", errors="replace", newline="") as f:
        w = csv.writer(f); w.writerow(HEADER); w.writerows(rows)
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
    if "--months" in argv: months_n = int(argv[argv.index("--months") + 1])
    resume = "--resume" in argv
    sido_args = [a for a in argv if not a.startswith("--") and not a.isdigit()]

    # 시도별 그룹
    by_sido = {}
    for code, name in CODES.items():
        by_sido.setdefault(name.split()[0], []).append(code)
    targets = sido_args if sido_args else sorted(by_sido)
    months = recent_months(months_n)
    print(f"대상 시도 {len(targets)}개 | 기간 {months[0]}~{months[-1]} ({months_n}개월) | 총 시군구 {sum(len(by_sido[s]) for s in targets if s in by_sido)}")

    calls = [0]; total_rows = 0
    prevent_sleep(True)
    try:
        for sido in targets:
            if sido not in by_sido: print(f"  ? '{sido}' 코드없음 건너뜀", flush=True); continue
            if resume and os.path.exists(os.path.join(DATA, f"api_{sido}.csv")):
                print(f"  ⏭ {sido} 이미 있음(--resume) 건너뜀", flush=True); continue
            total_rows += fetch_sido(sido, by_sido[sido], months, calls)
            print(f"     누적 API 호출 {calls[0]}회", flush=True)
    except LimitError as e:
        print(f"\n⛔ 일일 한도 도달({e}). 받은 시도까지 저장됨. `--resume` 으로 이어받으세요. (호출 {calls[0]}회)", flush=True)
        sys.exit(2)
    finally:
        prevent_sleep(False)
    print(f"\n총 {total_rows}건 | API 호출 {calls[0]}회 | 시도 {len(targets)}개 완료", flush=True)
