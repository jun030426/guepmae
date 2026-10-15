import datetime
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('market_collector',Path(__file__).with_name('fetch-market-trades.py'))
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class MarketCollectionTests(unittest.TestCase):
    def test_window_excludes_current_month_and_spans_year_boundary(self):
        months=collector.months_window(datetime.date(2026,1,15))
        self.assertEqual((months[0],months[-1],len(months)),('202301','202512',36))

    def test_failed_refresh_preserves_previous_complete_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'trades.csv').write_text('previous')
            with self.assertRaises(ValueError):
                collector.collect(root,{'11':'서울 강남구'},['202609'],fetch=lambda *_: (_ for _ in ()).throw(ValueError('offline')))
            self.assertEqual((root/'trades.csv').read_text(),'previous')
            self.assertTrue((root/'partial.zip').exists())

    def test_refresh_replaces_old_pair_instead_of_appending_cancelled_transactions(self):
        row=['서울 강남구 역삼동','동명','10000','202609','','84','2000','12','1','중개거래','11-1','1','']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            collector.collect(root,{'11':'서울 강남구'},['202609'],fetch=lambda *_:[row,row])
            receipt=collector.collect(root,{'11':'서울 강남구'},['202609'],fetch=lambda *_:[row])
            self.assertEqual(receipt['rows'],1)
            self.assertEqual(receipt['completedPairs'],1)

    def test_zero_trade_region_is_not_silently_published(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                collector.collect(Path(directory),{'11':'서울 강남구'},['202609'],fetch=lambda *_:[])

if __name__=='__main__': unittest.main()
