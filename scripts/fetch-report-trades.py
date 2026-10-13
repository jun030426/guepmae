#!/usr/bin/env python
"""Existing MOLIT API collector → a complete, isolated 12-month report input.

python scripts/fetch-report-trades.py
Then: node scripts/import-trades-csv.mjs --report-input
No database writes. Incomplete collections never replace the report input.
"""
import concurrent.futures
import csv
import datetime
import importlib.util
import hashlib
import json
import os
import re
import time
import urllib.request
import urllib.parse
from html.parser import HTMLParser

spec = importlib.util.spec_from_file_location('fetch_trades', os.path.join(os.path.dirname(__file__), 'fetch-trades.py'))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class ProvinceOptions(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.code = None
        self.options = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'select':
            self.active = attrs.get('name') == 'srhSidoCode'
        if tag == 'option' and self.active:
            self.code = attrs.get('value')

    def handle_data(self, data):
        if self.active and self.code and re.fullmatch(r'\d{2}', self.code) and data.strip():
            self.options[self.code] = data.strip()

    def handle_endtag(self, tag):
        if tag == 'select': self.active = False
        if tag == 'option': self.code = None


def current_district_codes():
    # The old static table misses the 2026 Jeonnam-Gwangju and Incheon changes.
    # Read the same current legal-district lists used by MOLIT's public website.
    url = 'https://rt.molit.go.kr/pt/gis/gis.do?mobileAt=&srhThingSecd=A'
    parser = ProvinceOptions()
    with urllib.request.urlopen(url, timeout=30) as response:
        parser.feed(response.read().decode('utf-8'))
    if len(parser.options) < 10:
        raise ValueError('MOLIT province list is incomplete')
    codes = {}
    for province, name in parser.options.items():
        with urllib.request.urlopen('https://rt.molit.go.kr/cmm/signguList.do',
                                    data=urllib.parse.urlencode({'code': province}).encode(), timeout=30) as response:
            districts = json.load(response)['signguList']
        if not districts:
            raise ValueError('MOLIT district list is incomplete')
        for district in districts:
            code = district['code']
            if not re.fullmatch(r'\d{5}', code) or not code.startswith(province) or code in codes:
                raise ValueError('Invalid or duplicate district code')
            codes[code] = name + ' ' + district['codeNm']
    return codes


def collect_pair(code, month):
    rows = []
    page = 1
    expected = None
    while True:
        xml = api.fetch_page(code, month, page)
        status, _, total, items = api.parse_items(xml)
        if status not in ('00', '000') or total is None:
            raise ValueError('API did not confirm a complete response')
        if expected is not None and expected != total:
            raise ValueError('Result count changed during pagination; retry collection')
        expected = total
        for item in items:
            rows.append(api.row_from(item, api.CODES[code]) + [api.cv(item, 'aptSeq'), api.cv(item, 'jibun'), api.cv(item, 'cdealType')])
        if len(rows) == total:
            return rows
        if not items or len(rows) > total:
            raise ValueError('Incomplete pagination')
        page += 1
        time.sleep(0.05)


def main():
    if not api.KEY:
        raise SystemExit('MOLIT_API_KEY is missing')
    api.CODES = current_district_codes()
    today = datetime.date.today()
    end = today.replace(day=1) - datetime.timedelta(days=1)
    start = datetime.date(end.year - (end.month < 12), end.month % 12 + 1, 1)
    months = api.months_since(start.strftime('%Y-%m'), today=today)
    pairs = [(code, month) for code in sorted(api.CODES) for month in months]
    out_dir = os.path.join(api.DATA, 'report')
    os.makedirs(out_dir, exist_ok=True)
    output = os.path.join(out_dir, 'trades.csv')
    temp = output + '.tmp'
    failures = []
    region_month_counts = {(name.split()[0], month): 0 for name in api.CODES.values() for month in months}
    count = completed = 0
    print(f'Report API collection: {months[0]} ~ {months[-1]}, {len(pairs)} district-months', flush=True)
    with open(temp, 'w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(api.HEADER + ['아파트일련번호', '지번', '해제여부'])
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(collect_pair, code, month): (code, month) for code, month in pairs}
            for future in concurrent.futures.as_completed(futures):
                code, month = futures[future]
                try:
                    rows = future.result()
                    writer.writerows(rows)
                    count += len(rows)
                    region_month_counts[(api.CODES[code].split()[0], month)] += len(rows)
                except Exception as error:
                    # Never log URLs: they contain the service key.
                    failures.append({'code': code, 'month': month, 'error': type(error).__name__})
                completed += 1
                if completed % 100 == 0 or completed == len(pairs):
                    print(f'Completed {completed}/{len(pairs)}; rows {count}; failed {len(failures)}', flush=True)
    missing = [f'{name} {month}' for (name, month), amount in region_month_counts.items() if amount == 0]
    receipt = {'start': start.strftime('%Y-%m'), 'end': end.strftime('%Y-%m'),
               'districts': len(api.CODES), 'expectedPairs': len(pairs), 'completedPairs': completed - len(failures),
               'rows': count, 'failures': failures, 'missingRegionMonths': missing,
               'regions': sorted({name.split()[0] for name in api.CODES.values()}),
               'codeSource': 'https://rt.molit.go.kr/pt/gis/gis.do?mobileAt=&srhThingSecd=A',
               'collectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if failures or count == 0 or missing:
        with open(os.path.join(out_dir, 'failed-collection.json'), 'w', encoding='utf-8') as handle:
            json.dump(receipt, handle, ensure_ascii=False, indent=2)
        raise SystemExit('Collection incomplete. Previous report input preserved; see failed-collection.json.')
    with open(temp, 'rb') as handle:
        receipt['sha256'] = hashlib.file_digest(handle, 'sha256').hexdigest()
    os.replace(temp, output)
    with open(os.path.join(out_dir, 'collection.json'), 'w', encoding='utf-8') as handle:
        json.dump(receipt, handle, ensure_ascii=False, indent=2)
    print(f'Saved complete report input: {count} rows', flush=True)


if __name__ == '__main__':
    main()
