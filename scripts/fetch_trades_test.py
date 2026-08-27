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
    def test_identical_rows_deduped(self):
        self.assertEqual(len(ft.merge_rows([row()], [row()])), 1)

    def test_fresh_row_appended(self):
        merged = ft.merge_rows([row(ym="202605")], [row(ym="202606")])
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0][3], "202605")  # 기존 순서 유지

    def test_fresh_wins_on_key_collision(self):
        # 해제사유발생일은 dedup 키에 없으므로, 나중에 취소된 거래는 신규 값이 이겨야 한다
        merged = ft.merge_rows([row(cdeal="")], [row(cdeal="26.07.20")])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0][4], "26.07.20")

    def test_different_floor_is_distinct(self):
        self.assertEqual(len(ft.merge_rows([row(floor="7")], [row(floor="8")])), 2)

    def test_different_amount_is_distinct(self):
        self.assertEqual(len(ft.merge_rows([row(amount="150000")],
                                           [row(amount="151000")])), 2)

    def test_empty_existing(self):
        self.assertEqual(len(ft.merge_rows([], [row(), row(day="16")])), 2)


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
