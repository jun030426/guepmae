#!/usr/bin/env python
# scripts/output/ 의 complex_prices.csv / price_trends.csv 를 Supabase 테이블에 교체 적재.
# 안전 교체: 새 행 먼저 insert → 옛 행(insert 직전 max id 이하) 삭제 (빈 테이블 구간 없음).
# .env.local 의 SUPABASE_SERVICE_ROLE_KEY 필요.
#
# 사용: python scripts/reload-supabase-tables.py            # 두 테이블 모두
#       python scripts/reload-supabase-tables.py complex    # complex_prices 만
#       python scripts/reload-supabase-tables.py trends     # price_trends 만
import os, sys, csv, json, time, urllib.request, urllib.error
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "scripts", "output")
def ld():
    e = {}
    for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1); e[k.strip()] = v.strip()
    return e
E = ld(); URL = E["VITE_SUPABASE_URL"].rstrip("/"); SVC = E["SUPABASE_SERVICE_ROLE_KEY"]
HDR = {"apikey": SVC, "Authorization": "Bearer " + SVC, "Content-Type": "application/json"}

def to_int(v):
    try: return int(float(str(v).replace(",", "")))
    except: return None

def req(method, path, data=None, extra=None):
    h = dict(HDR)
    if extra: h.update(extra)
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=body, method=method, headers=h)
    return urllib.request.urlopen(r, timeout=120)

def max_id(table):
    resp = req("GET", f"{table}?select=id&order=id.desc&limit=1")
    rows = json.load(resp)
    return rows[0]["id"] if rows else 0

def count(table):
    resp = req("GET", f"{table}?select=id&limit=1", extra={"Prefer": "count=exact", "Range": "0-0"})
    cr = resp.headers.get("Content-Range", "")
    return cr.split("/")[-1] if cr else "?"

def reload(table, rows, label):
    # 유니크 제약(complex,gu,area_m2 / gu,area_bucket,year_month)이 있어 전체 삭제 후 재적재.
    print(f"\n=== {table} 교체 ===")
    print(f"  현재 행수: {count(table)} | 새 행수: {len(rows)}")
    req("DELETE", f"{table}?id=gte.0", extra={"Prefer": "return=minimal"}).read()
    print(f"  전체 삭제 완료 (잔여 {count(table)})")
    ok = 0
    for i in range(0, len(rows), 1000):
        chunk = rows[i:i+1000]
        try:
            req("POST", table, data=chunk, extra={"Prefer": "return=minimal"}).read()
            ok += len(chunk)
        except urllib.error.HTTPError as e:
            print(f"  ! insert 실패 @ {i}: {e.code} {e.read().decode('utf-8','ignore')[:200]} (재실행 필요)")
            return False
        if (i // 1000) % 10 == 0:
            print(f"    insert 진행 {ok}/{len(rows)}")
    print(f"  완료 | 최종 행수: {count(table)}")
    return True

def load_complex():
    rows = []
    with open(os.path.join(OUT, "complex_prices.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append({
                "complex": r["complex"], "sigungu": r["sigungu"], "gu": r["gu"],
                "area_m2": to_int(r["area_m2"]), "area_bucket": r["area_bucket"],
                "median_price": to_int(r["median_price"]), "sample_size": to_int(r["sample_size"]),
                "earliest_year_month": r.get("earliest_year_month") or None,
                "latest_year_month": r.get("latest_year_month") or None,
                "built_year": to_int(r.get("built_year")),
            })
    return rows

def load_trends():
    rows = []
    with open(os.path.join(OUT, "price_trends.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append({
                "region": r["region"], "gu": r["gu"], "area_bucket": r["area_bucket"],
                "year_month": r["year_month"], "price": to_int(r["price"]),
                "sample_size": to_int(r["sample_size"]),
                "is_estimated": str(r["is_estimated"]).lower() in ("true", "t", "1"),
            })
    return rows

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "complex"):
        reload("complex_prices", load_complex(), "complex")
    if which in ("all", "trends"):
        reload("price_trends", load_trends(), "trends")
    print("\n끝.")
