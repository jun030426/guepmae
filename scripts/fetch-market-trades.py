#!/usr/bin/env python
"""Complete 36-month MOLIT input with resumable district/month checkpoints.

Only a fully validated collection replaces trades.csv / collection.json. The
private cache is reusable; recent months are replaced, never appended, so late
reports and cancellations are reflected. No database writes in this command.
"""
import argparse
import concurrent.futures
import csv
import datetime
import hashlib
import importlib.util
import json
import os
import time
import urllib.error
from pathlib import Path
import zipfile

spec = importlib.util.spec_from_file_location('report_collector', Path(__file__).with_name('fetch-report-trades.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def months_window(today, count=36):
    end = today.year * 12 + today.month - 2
    return [f'{n // 12:04d}{n % 12 + 1:02d}' for n in range(end - count + 1, end + 1)]


def seed_report(directory, codes):
    """Reuse the previous *complete, hash-verified* report, including zero pairs."""
    receipt = json.loads((directory / 'collection.json').read_text(encoding='utf-8'))
    source = directory / 'trades.csv'
    with source.open('rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    if (digest != receipt['sha256'] or receipt['failures'] or receipt['missingRegionMonths']
            or receipt['completedPairs'] != receipt['expectedPairs'] or receipt['districts'] != len(codes)):
        raise ValueError('Report seed is incomplete or does not match current districts')
    months = report.api.months_since(receipt['start'],
        today=datetime.date.fromisoformat(receipt['end'] + '-01') + datetime.timedelta(days=32))
    months = [m for m in months if m <= receipt['end'].replace('-', '')]
    groups = {(code, month): [] for code in codes for month in months}
    names = sorted(codes.items(), key=lambda item: len(item[1]), reverse=True)
    count = 0
    with source.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.reader(handle)
        next(reader)
        for row in reader:
            code = next((code for code, name in names if row[0] == name or row[0].startswith(name + ' ')), None)
            key = (code, row[3])
            if key not in groups:
                raise ValueError('Seed contains an unknown district or month')
            groups[key].append(row)
            count += 1
    if count != receipt['rows']:
        raise ValueError('Seed row count mismatch')
    return groups


def read_pair(archive, code, month, district):
    if archive is None:
        return None
    try:
        data = json.loads(archive.read(f'pairs/{code}-{month}.json'))
    except KeyError:
        return None
    if data.get('district') != district or not isinstance(data.get('rows'), list):
        return None
    return data['rows']


def fetch_pair(code, month):
    for attempt in range(4):
        try:
            return report.collect_pair(code, month)
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
            if attempt == 3:
                raise
            time.sleep(min(30, 2 ** (attempt + 2)))


def collect(out_dir, codes, months, refresh_months=3, seed=None, fetch=fetch_pair):
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / 'cache.zip'
    partial_path = out_dir / 'partial.zip'
    old = zipfile.ZipFile(cache_path) if cache_path.exists() else None
    partial = zipfile.ZipFile(partial_path) if partial_path.exists() else None
    # Failed-run checkpoints may be resumed explicitly; never silently treat an
    # old recent-month response as today's refresh.
    resume = os.environ.get('MARKET_RESUME') == 'true'
    next_cache = out_dir / 'next.zip'
    temp_csv = out_dir / 'trades.csv.tmp'
    refresh = set(months[-refresh_months:]) if refresh_months else set()
    counts = {(name.split()[0], month): 0 for name in codes.values() for month in months}
    failures, pending = [], []
    row_count = completed = 0
    try:
        with zipfile.ZipFile(next_cache, 'w', compression=zipfile.ZIP_DEFLATED) as output, \
                temp_csv.open('w', encoding='utf-8-sig', newline='') as handle:
            writer = csv.writer(handle)
            writer.writerow(report.api.HEADER + ['아파트일련번호', '지번', '해제여부', '시군구코드', '시군구기준'])

            def save(code, month, rows):
                nonlocal row_count, completed
                output.writestr(f'pairs/{code}-{month}.json', json.dumps(
                    {'district': codes[code], 'rows': rows}, ensure_ascii=False, separators=(',', ':')))
                writer.writerows(row + [code, codes[code]] for row in rows)
                row_count += len(rows)
                counts[(codes[code].split()[0], month)] += len(rows)
                completed += 1

            for code in sorted(codes):
                for month in months:
                    rows = read_pair(partial, code, month, codes[code]) if resume else None
                    if rows is None and month not in refresh:
                        rows = read_pair(old, code, month, codes[code])
                        if rows is None and seed is not None:
                            rows = seed.get((code, month))
                    if rows is None:
                        pending.append((code, month))
                    else:
                        save(code, month, rows)
            print(f'Market collection: cached {completed}, fetch {len(pending)}, window {months[0]}~{months[-1]}', flush=True)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                futures = {pool.submit(fetch, code, month): (code, month) for code, month in pending}
                for future in concurrent.futures.as_completed(futures):
                    code, month = futures[future]
                    try:
                        save(code, month, future.result())
                    except Exception as error:
                        failures.append({'code': code, 'month': month, 'error': type(error).__name__, 'status': getattr(error, 'code', None)})
                        if len(failures) >= 20:
                            for queued in futures: queued.cancel()
                            break
                    if (completed + len(failures)) % 100 == 0:
                        print(f'Completed {completed}/{len(codes) * len(months)}; rows {row_count}; failures {len(failures)}', flush=True)
    finally:
        if old: old.close()
        if partial: partial.close()
    missing = [f'{region} {month}' for (region, month), count in counts.items() if not count]
    receipt = {'schemaVersion': 1, 'start': months[0][:4] + '-' + months[0][4:],
               'end': months[-1][:4] + '-' + months[-1][4:], 'months': len(months),
               'districts': codes, 'expectedPairs': len(codes) * len(months), 'completedPairs': completed,
               'rows': row_count, 'failures': failures, 'missingRegionMonths': missing,
               'collectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if failures or missing or not row_count:
        os.replace(next_cache, partial_path)
        (out_dir / 'failed-collection.json').write_text(json.dumps(receipt, ensure_ascii=False), encoding='utf-8')
        raise ValueError('Incomplete collection; previous published input is preserved')
    with temp_csv.open('rb') as handle:
        receipt['sha256'] = hashlib.file_digest(handle, 'sha256').hexdigest()
    os.replace(next_cache, cache_path)
    os.replace(temp_csv, out_dir / 'trades.csv')
    (out_dir / 'collection.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Validated {row_count} rows across {completed} district-months', flush=True)
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed-report', type=Path)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--refresh-months', type=int, default=3)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.refresh_months <= 36:
        parser.error('refresh-months must be between 0 and 36')
    if args.env_file:
        for line in args.env_file.read_text(encoding='utf-8-sig').splitlines():
            if line.startswith('MOLIT_API_KEY='):
                report.api.KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
    report.api.KEY = os.environ.get('MOLIT_API_KEY') or report.api.KEY
    if not report.api.KEY:
        raise SystemExit('MOLIT_API_KEY is missing')
    codes = report.current_district_codes()
    report.api.CODES = codes
    seed = seed_report(args.seed_report, codes) if args.seed_report else None
    if args.resume: os.environ['MARKET_RESUME'] = 'true'
    collect(Path(report.api.DATA) / 'market', codes, months_window(datetime.date.today()), args.refresh_months, seed)


if __name__ == '__main__':
    main()
