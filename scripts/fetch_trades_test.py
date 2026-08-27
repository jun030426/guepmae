# scripts/fetch_trades_test.py — 증분 병합 순수 함수 검증
import csv, datetime, importlib.util, os, tempfile, unittest

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


if __name__ == "__main__":
    unittest.main()
