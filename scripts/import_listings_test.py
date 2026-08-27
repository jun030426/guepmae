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
                                  capture_output=True, text=True, cwd=ROOT)
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
                                      capture_output=True, text=True, cwd=ROOT)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                rows = json.load(io.open(BUNDLE, encoding="utf-8"))
                self.assertIsInstance(rows, list)
                self.assertGreaterEqual(len(rows), 1)
            finally:
                shutil.copyfile(backup, BUNDLE)


if __name__ == "__main__":
    unittest.main()
