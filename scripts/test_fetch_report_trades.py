import importlib.util
import os
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('report_collector', os.path.join(os.path.dirname(__file__), 'fetch-report-trades.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def xml(total, items='', code='000'):
    return f'<response><header><resultCode>{code}</resultCode></header><body><totalCount>{total}</totalCount><items>{items}</items></body></response>'


class ReportCollectionTests(unittest.TestCase):
    def test_current_province_options_ignore_other_selects_and_blank_options(self):
        parser = collector.ProvinceOptions()
        parser.feed('<select name="srhSidoCode"><option value="">선택</option><option value="12">전남광주통합특별시</option></select><select name="other"><option value="99">잘못된 지역</option></select>')
        self.assertEqual(parser.options, {'12': '전남광주통합특별시'})

    def test_collection_preserves_ids_lots_and_cancellation_flags(self):
        item = '<item><aptSeq>29200-10</aptSeq><jibun>1-2</jibun><cdealType>O</cdealType><aptNm>동명</aptNm><dealYear>2026</dealYear><dealMonth>9</dealMonth></item>'
        with patch.object(collector.api, 'CODES', {'12330': '전남광주통합특별시 광산구'}), patch.object(collector.api, 'fetch_page', return_value=xml(1, item)):
            rows = collector.collect_pair('12330', '202609')
        self.assertEqual(rows[0][-3:], ['29200-10', '1-2', 'O'])
        self.assertEqual(rows[0][0], '전남광주통합특별시 광산구')

    def test_empty_valid_district_is_allowed_but_error_response_is_not(self):
        with patch.object(collector.api, 'fetch_page', return_value=xml(0)):
            self.assertEqual(collector.collect_pair('12330', '202609'), [])
        for payload in [xml(0, code='22'), '<response/>', xml('', code='000')]:
            with patch.object(collector.api, 'fetch_page', return_value=payload):
                with self.assertRaises(ValueError): collector.collect_pair('12330', '202609')

    def test_pagination_must_finish_without_a_changing_total(self):
        item = '<item><aptNm>동명</aptNm></item>'
        with patch.object(collector.api, 'CODES', {'12330': '전남광주통합특별시 광산구'}), patch.object(collector.time, 'sleep'):
            with patch.object(collector.api, 'fetch_page', side_effect=[xml(2, item), xml(2, item)]):
                self.assertEqual(len(collector.collect_pair('12330', '202609')), 2)
            with patch.object(collector.api, 'fetch_page', side_effect=[xml(2, item), xml(3, item)]):
                with self.assertRaises(ValueError): collector.collect_pair('12330', '202609')
            with patch.object(collector.api, 'fetch_page', side_effect=[xml(2, item), xml(2)]):
                with self.assertRaises(ValueError): collector.collect_pair('12330', '202609')


if __name__ == '__main__':
    unittest.main()
