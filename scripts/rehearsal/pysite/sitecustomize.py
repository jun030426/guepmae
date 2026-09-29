# 리허설용 가짜 국토부 API — urllib.request.urlopen 을 가로채 가짜 XML 을 돌려준다. 실제 네트워크는 쓰지 않는다.
# PYTHONPATH 에 이 폴더를 넣으면 파이썬이 시작할 때 자동으로 불러온다(sitecustomize).
# FAKE_MOLIT_TRUTH 가 없으면 아무것도 하지 않는다 — 평소 실행에는 영향이 없다.
#
#   FAKE_MOLIT_TRUTH  "API 가 알고 있는 거래" CSV 폴더 (CP949, fetch-trades.py 출력 형식)
#   FAKE_MOLIT_CODES  scripts/_sigungu_codes.json 경로
#   FAKE_MOLIT_MODE   normal | outage:<시도명> | limit:<N> | shrink:<시도명> | keyerror | http500
#   FAKE_MOLIT_LOG    호출 기록 파일 (선택) — 한 줄에 "시군구코드<TAB>계약년월<TAB>쪽"
import csv, io, os, json, hashlib, time, urllib.request, urllib.parse, urllib.error

_TRUTH = os.environ.get("FAKE_MOLIT_TRUTH")
if _TRUTH:
    _MODE = os.environ.get("FAKE_MOLIT_MODE", "normal")
    _CODES = json.load(open(os.environ["FAKE_MOLIT_CODES"], encoding="utf-8"))
    _BASES = sorted(set(_CODES.values()), key=len, reverse=True)
    _INDEX = {}
    _calls = [0]

    def _base_of(sigungu):
        for b in _BASES:
            if sigungu == b or sigungu.startswith(b + " "):
                return b
        return None

    for name in os.listdir(_TRUTH):
        if not (name.startswith("api_") and name.endswith(".csv")):
            continue
        with open(os.path.join(_TRUTH, name), encoding="cp949", newline="") as f:
            rows = list(csv.reader(f))[1:]
        for r in rows:
            base = _base_of(r[0])
            if base:
                _INDEX.setdefault((base, r[3]), []).append(r)

    def _esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def _item(r, base):
        sigungu, apt, amount, ym, cdeal, area, built, floor, day, dealing = r
        umd = sigungu[len(base):].strip()
        amount_fmt = f"{int(amount):,}" if amount.isdigit() else amount
        fields = {
            "aptNm": apt, "excluUseAr": area, "dealAmount": amount_fmt,
            "dealYear": ym[:4], "dealMonth": str(int(ym[4:6])), "dealDay": day,
            "buildYear": built, "umdNm": umd, "floor": floor,
            "cdealDay": cdeal, "dealingGbn": dealing,
        }
        return "<item>" + "".join(f"<{k}>{_esc(v)}</{k}>" for k, v in fields.items()) + "</item>"

    def _late_reports(base, ymd):
        """신고 지연분 — (구, 월) 의 약 1/3 에 거래 1건이 새로 나타난다 (결정적)."""
        h = int(hashlib.md5(f"{base}|{ymd}".encode("utf-8")).hexdigest(), 16)
        if h % 3 != 0:
            return []
        return [[f"{base} 리허설동", "리허설신고단지", "45000", ymd, "", "59.90", "2010", str(3 + h % 15), str(1 + h % 28), "중개거래"]]

    def _xml(code, msg, total, items):
        return ("<response><header><resultCode>%s</resultCode><resultMsg>%s</resultMsg></header>"
                "<body><items>%s</items><numOfRows>1000</numOfRows><pageNo>1</pageNo>"
                "<totalCount>%d</totalCount></body></response>") % (code, _esc(msg), "".join(items), total)

    class _Response:
        def __init__(self, text):
            self._data = text.encode("utf-8")
        def read(self):
            return self._data
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return False

    def _fake_urlopen(url, *args, **kwargs):
        url = url if isinstance(url, str) else url.full_url
        if "RTMSDataSvcAptTradeDev" not in url:
            raise urllib.error.URLError("리허설: 실제 네트워크 호출은 막혀 있습니다 — " + url[:80])
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        lawd, ymd = q["LAWD_CD"][0], q["DEAL_YMD"][0]
        page, rows = int(q.get("pageNo", ["1"])[0]), int(q.get("numOfRows", ["1000"])[0])
        _calls[0] += 1
        log = os.environ.get("FAKE_MOLIT_LOG")
        if log:
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"{lawd}\t{ymd}\t{page}\n")
        if _MODE == "keyerror" or not q.get("serviceKey", [""])[0]:
            return _Response(_xml("30", "SERVICE KEY IS NOT REGISTERED ERROR", 0, []))
        if _MODE == "http500":
            raise urllib.error.HTTPError(url, 500, "Internal Server Error", {}, io.BytesIO(b""))
        if _MODE.startswith("limit:") and _calls[0] > int(_MODE.split(":", 1)[1]):
            return _Response(_xml("22", "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR", 0, []))
        base = _CODES.get(lawd)
        if base is None:
            return _Response(_xml("000", "OK", 0, []))
        sido = base.split(" ")[0]
        if _MODE == f"outage:{sido}":
            return _Response(_xml("000", "OK", 0, []))
        truth = list(_INDEX.get((base, ymd), [])) + _late_reports(base, ymd)
        if _MODE == f"shrink:{sido}":
            truth = truth[: len(truth) // 10]
        chunk = truth[(page - 1) * rows: page * rows]
        return _Response(_xml("000", "OK", len(truth), [_item(r, base) for r in chunk]))

    urllib.request.urlopen = _fake_urlopen
    time.sleep = lambda seconds: None  # 호출 간격·재시도 대기는 가짜 API 에 필요 없다
