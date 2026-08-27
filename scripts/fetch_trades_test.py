# scripts/fetch_trades_test.py — 증분 병합 순수 함수 검증
import csv, datetime, http.client, importlib.util, os, tempfile, unittest, urllib.error

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
    """(시군구, 계약년월) 단위 완료 추적 병합: done 에 있는 (구, 월) 쌍만
    기존 행을 버리고 fresh 로 교체한다. done 에 없는 쌍은 기존 행을 그대로
    두고 fresh 쪽 부분 수집분은 버린다 — 부분 데이터로 완전한 이력을
    덮어쓰면 중복이 생기거나 행이 사라지기 때문이다.
    행 단위 dedup 은 쓰지 않는다 — CSV 에 동(棟) 컬럼이 없어 같은 단지·면적·
    계약일·층·금액의 서로 다른 거래를 구분할 수 없기 때문이다."""

    GANGNAM = "서울특별시 강남구"
    SEOCHO = "서울특별시 서초구"

    def test_completed_pair_replaces_existing_rows(self):
        existing = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="15"),
                    row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="16")]
        fresh = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="20")]
        merged = ft.merge_rows(existing, fresh, {(self.GANGNAM, "202605")})
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged, fresh)

    def test_incomplete_pair_keeps_existing_and_discards_partial_fresh(self):
        existing = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="15")]
        fresh = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="99")]
        # 강남구 자체는 done 에 다른 월로 등장해 알려진 구지만, 202605 는 수집 도중
        # 끊겨 done 에 없다 — district_of 의 '판단 불가' 분기가 아니라 진짜
        # 미완료 (구, 월) 분기를 검증한다.
        done = {(self.GANGNAM, "202606")}
        merged = ft.merge_rows(existing, fresh, done)
        self.assertEqual(merged, existing)  # 기존 유지
        self.assertNotIn(fresh[0], merged)  # 부분 수집분 폐기

    def test_second_district_same_month_unaffected_by_first(self):
        existing = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202606", day="1"),
                    row(sigungu=f"{self.SEOCHO} 서초동", ym="202606", day="2")]
        fresh = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202606", day="9")]
        # 강남구만 완료, 서초구는 실패(done 에 없음)
        merged = ft.merge_rows(existing, fresh, {(self.GANGNAM, "202606")})
        self.assertIn(existing[1], merged)          # 서초구 기존 행 보존
        self.assertNotIn(existing[0], merged)       # 강남구 기존 행 교체됨
        self.assertIn(fresh[0], merged)

    def test_month_outside_done_survives_untouched(self):
        existing = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202604", day="10"),
                    row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="15")]
        fresh = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="20")]
        merged = ft.merge_rows(existing, fresh, {(self.GANGNAM, "202605")})
        self.assertIn(existing[0], merged)

    def test_empty_done_preserves_existing_and_adds_nothing(self):
        existing = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202606", day="15"),
                    row(sigungu=f"{self.GANGNAM} 역삼동", ym="202606", day="16")]
        fresh = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202606", day="99")]
        merged = ft.merge_rows(existing, fresh, set())
        self.assertEqual(merged, existing)

    def test_ordering_kept_existing_first_then_fresh(self):
        existing = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202604", day="10"),
                    row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="15")]
        fresh = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202605", day="20")]
        merged = ft.merge_rows(existing, fresh, {(self.GANGNAM, "202605")})
        self.assertEqual(merged, [existing[0]] + fresh)

    def test_identical_looking_distinct_transactions_both_kept(self):
        # CSV 가 기록하는 모든 필드(시군구/단지명/전용면적/계약년월/일/층/거래금액)가
        # 같아도, 동(棟)이 달라 실제로는 별개인 거래 — 둘 다 살아남아야 한다.
        existing = []
        fresh = [row(sigungu=f"{self.GANGNAM} 역삼동", ym="202606"),
                 row(sigungu=f"{self.GANGNAM} 역삼동", ym="202606")]
        merged = ft.merge_rows(existing, fresh, {(self.GANGNAM, "202606")})
        self.assertEqual(len(merged), 2)


class DistrictOf(unittest.TestCase):
    def test_resolves_three_token_sigungu(self):
        bases = {"경기도 성남시 분당구"}
        self.assertEqual(ft.district_of("경기도 성남시 분당구 정자동", bases), "경기도 성남시 분당구")

    def test_resolves_two_token_sigungu(self):
        bases = {"서울특별시 강남구"}
        self.assertEqual(ft.district_of("서울특별시 강남구 역삼동", bases), "서울특별시 강남구")

    def test_unknown_prefix_returns_none(self):
        bases = {"서울특별시 강남구"}
        self.assertIsNone(ft.district_of("부산광역시 해운대구 우동", bases))


class MergeRowsUnresolvedDistrict(unittest.TestCase):
    def test_row_with_unresolvable_district_is_never_deleted(self):
        # bases 에 없는(판단 불가) 시군구를 가진 기존 행은 done 이 무엇이든 삭제되지 않는다.
        existing = [row(sigungu="부산광역시 해운대구 우동", ym="202606", day="1")]
        merged = ft.merge_rows(existing, [], {("서울특별시 강남구", "202606")})
        self.assertIn(existing[0], merged)


class ReadExisting(unittest.TestCase):
    def test_missing_sido_returns_none(self):
        self.assertIsNone(ft.read_existing_rows("존재하지않는시도"))

    def test_present_sido_returns_rows_without_header(self):
        rows = ft.read_existing_rows("서울특별시")
        self.assertIsNotNone(rows)
        self.assertGreater(len(rows), 0)
        self.assertNotEqual(rows[0][0], "시군구")
        self.assertEqual(len(rows[0]), 9)


HEADER_9 = ["시군구", "단지명", "거래금액(만원)", "계약년월",
            "해제사유발생일", "전용면적(㎡)", "건축년도", "층", "일"]

# 실제 시도명과 절대 충돌하지 않는 가짜 시도명
FAKE_SIDO = "테스트도"


class FetchSidoMergePath(unittest.TestCase):
    """fetch_sido 의 write/merge 경로 회귀 테스트.

    codes_for_sido 를 빈 리스트로 넘기면 API 호출이 전혀 일어나지 않고
    rows=[] 로 fetch_sido 의 나머지 로직(merge → write)만 실행된다.
    이는 정확히 회귀 시나리오다: "신규 수집분이 0건이어도 merge=True 면
    기존 이력이 그대로 보존되어야 한다."
    DATA 를 모듈 전역에서 임시 디렉터리로 바꿔치기해 실제
    scripts/data 는 절대 건드리지 않는다.
    """

    def setUp(self):
        self._orig_data = ft.DATA
        self._tmpdir = tempfile.TemporaryDirectory()
        ft.DATA = self._tmpdir.name

    def tearDown(self):
        ft.DATA = self._orig_data
        self._tmpdir.cleanup()

    def _csv_path(self):
        return os.path.join(ft.DATA, f"api_{FAKE_SIDO}.csv")

    def _write_existing_csv(self, rows):
        with open(self._csv_path(), "w", encoding="cp949", errors="replace", newline="") as f:
            w = csv.writer(f)
            w.writerow(HEADER_9)
            w.writerows(rows)

    def _read_data_rows(self):
        with open(self._csv_path(), encoding="cp949", errors="replace", newline="") as f:
            all_rows = list(csv.reader(f))
        return all_rows[1:]

    def test_merge_preserves_existing_rows_when_nothing_new(self):
        existing = [row(day="15"), row(day="16"), row(day="17")]
        self._write_existing_csv(existing)

        result_count = ft.fetch_sido(FAKE_SIDO, [], ["202606"], [0], merge=True)

        data_rows = self._read_data_rows()
        self.assertEqual(len(data_rows), 3)
        self.assertEqual(data_rows, existing)
        self.assertEqual(result_count, 3)

    def test_non_merge_overwrites_existing_rows(self):
        existing = [row(day="15"), row(day="16"), row(day="17")]
        self._write_existing_csv(existing)

        result_count = ft.fetch_sido(FAKE_SIDO, [], ["202606"], [0], merge=False)

        data_rows = self._read_data_rows()
        self.assertEqual(len(data_rows), 0)
        self.assertEqual(result_count, 0)

    def test_merge_without_existing_file_raises(self):
        self.assertFalse(os.path.exists(self._csv_path()))
        with self.assertRaises(SystemExit):
            ft.fetch_sido(FAKE_SIDO, [], ["202606"], [0], merge=True)
        self.assertFalse(os.path.exists(self._csv_path()))


class _FakeResponse:
    """urlopen 이 돌려주는 컨텍스트 매니저를 흉내낸다."""

    def __init__(self, body):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False

    def read(self):
        return self._body


class FetchPageRetry(unittest.TestCase):
    """fetch_page 의 지수 백오프 재시도 검증.

    ft.urllib.request.urlopen 은 미리 큐에 넣어둔 예외/응답을 순서대로
    소비하는 가짜로, ft.time.sleep 은 실제로 잠들지 않고 대기 시간만
    기록하는 가짜로 바꿔치운다 — 어떤 테스트도 네트워크를 타거나 잠들지 않는다."""

    def setUp(self):
        self._orig_urlopen = ft.urllib.request.urlopen
        self._orig_sleep = ft.time.sleep
        self._urlopen_effects = []
        self._urlopen_calls = 0
        self._sleeps = []

        def fake_urlopen(url, timeout=None):
            self._urlopen_calls += 1
            effect = self._urlopen_effects.pop(0)
            if isinstance(effect, BaseException):
                raise effect
            return _FakeResponse(effect)

        def fake_sleep(seconds):
            self._sleeps.append(seconds)

        ft.urllib.request.urlopen = fake_urlopen
        ft.time.sleep = fake_sleep

    def tearDown(self):
        ft.urllib.request.urlopen = self._orig_urlopen
        ft.time.sleep = self._orig_sleep

    def test_success_on_first_attempt(self):
        self._urlopen_effects = [b"<xml>ok</xml>"]
        result = ft.fetch_page("11680", "202606", 1)
        self.assertEqual(result, "<xml>ok</xml>")
        self.assertEqual(self._urlopen_calls, 1)
        self.assertEqual(self._sleeps, [])

    def test_transient_failure_then_success(self):
        self._urlopen_effects = [urllib.error.URLError("boom"), b"<xml>ok</xml>"]
        result = ft.fetch_page("11680", "202606", 1)
        self.assertEqual(result, "<xml>ok</xml>")
        self.assertEqual(self._urlopen_calls, 2)
        self.assertEqual(len(self._sleeps), 1)

    def test_remote_disconnected_is_transient(self):
        # 실제 운영에서 관측된 두 오류 중 하나: RemoteDisconnected 도 재시도 대상이어야 한다.
        self._urlopen_effects = [
            http.client.RemoteDisconnected("Remote end closed connection without response"),
            b"<xml>ok</xml>",
        ]
        result = ft.fetch_page("11680", "202606", 1)
        self.assertEqual(result, "<xml>ok</xml>")
        self.assertEqual(self._urlopen_calls, 2)
        self.assertEqual(len(self._sleeps), 1)

    def test_exhausting_attempts_reraises(self):
        self._urlopen_effects = [urllib.error.URLError("boom1"), urllib.error.URLError("boom2")]
        with self.assertRaises(urllib.error.URLError):
            ft.fetch_page("11680", "202606", 1, attempts=2)
        self.assertEqual(self._urlopen_calls, 2)

    def test_http_error_not_retried(self):
        # 429(일일 한도)를 비롯한 HTTPError 는 즉시 올려보내야 한다 —
        # 호출부의 LimitError 처리가 이 동작에 의존한다.
        # HTTPError(fp=None) 은 내부에 닫히지 않은 BytesIO 를 들고 있어 GC 시
        # ResourceWarning 을 낼 수 있으므로 명시적으로 닫아 pristine 출력을 유지한다.
        http_err = urllib.error.HTTPError("http://x", 429, "Too Many Requests", {}, None)
        self._urlopen_effects = [http_err]
        try:
            with self.assertRaises(urllib.error.HTTPError):
                ft.fetch_page("11680", "202606", 1)
        finally:
            http_err.close()
        self.assertEqual(self._urlopen_calls, 1)
        self.assertEqual(self._sleeps, [])

    def test_backoff_is_exponential(self):
        self._urlopen_effects = [
            urllib.error.URLError("boom1"),
            urllib.error.URLError("boom2"),
            urllib.error.URLError("boom3"),
            b"<xml>ok</xml>",
        ]
        result = ft.fetch_page("11680", "202606", 1, attempts=4)
        self.assertEqual(result, "<xml>ok</xml>")
        self.assertEqual(self._sleeps, [2, 4, 8])


if __name__ == "__main__":
    unittest.main()
