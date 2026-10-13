// Shared by the importer, bundle builder, AI generator and report UI.
export const MARKET_AGGREGATION_VERSION = 2;
export const TOP_COMPLEX_MIN_SAMPLE = 10;
export const TOP_COMPLEX_SOLID_SAMPLE = 30;
export const REPORT_WINDOW_MONTHS = 12;

export function selectTopComplexes(rows, limit = 10) {
  return (rows || []).filter((row) => row.sampleSize >= TOP_COMPLEX_MIN_SAMPLE)
    .sort((a, b) => b.urgentRatio - a.urgentRatio || b.dealCount - a.dealCount || b.sampleSize - a.sampleSize || String(a.complexId).localeCompare(String(b.complexId)))
    .slice(0, limit).map((row, i) => ({ ...row, rank: i + 1 }));
}

export function regionCategories(rows = []) {
  return {
    premium: rows.filter((r) => Number.isFinite(r.averageDiscount) && r.averageDiscount < 0),
    discount: rows.filter((r) => Number.isFinite(r.averageDiscount) && r.averageDiscount > 0),
    neutral: rows.filter((r) => r.averageDiscount === 0),
    insufficient: rows.filter((r) => r.averageDiscount == null),
  };
}

export function reportPeriodLabel(metadata) {
  const period = metadata?.reportPeriod;
  return period?.start && period?.end ? `${period.start} ~ ${period.end} (${period.months}개월)` : '집계 기간 확인 중';
}

export function prepareMarketSnapshot(snapshot) {
  const metadata = snapshot?.metadata || {};
  const sum = (rows, key) => (rows || []).reduce((total, r) => total + (r[key] || 0), 0);
  const monthIndex = (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') ? Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 : NaN;
  const firstMonth = monthIndex(metadata.reportPeriod?.start);
  const lastMonth = monthIndex(metadata.reportPeriod?.end);
  const monthly = snapshot?.monthly || [];
  const slices = ['regional', 'monthly', 'area_type'];
  const ready = metadata.aggregationVersion === MARKET_AGGREGATION_VERSION
    && typeof metadata.snapshotId === 'string' && metadata.snapshotId.length > 0
    && metadata.reportPeriod?.months === REPORT_WINDOW_MONTHS
    && lastMonth - firstMonth === REPORT_WINDOW_MONTHS - 1
    && monthly.length === REPORT_WINDOW_MONTHS
    && monthly.every((row, index) => monthIndex(row.month) === firstMonth + index)
    && Number.isSafeInteger(metadata.totalRows) && metadata.totalRows > 0
    && metadata.comparableRows + metadata.unclassifiedRows === metadata.totalRows
    && slices.every((key) => sum(snapshot[key], 'transactionVolume') === metadata.totalRows
      && sum(snapshot[key], 'comparableVolume') === metadata.comparableRows
      && sum(snapshot[key], 'urgentCount') === sum(monthly, 'urgentCount'));
  if (!ready) return {
    regional: [], monthly: [], area_type: [], top_urgent: [], insights: [], home_trend: [],
    metadata: { ...metadata, status: 'needs-rebuild' },
  };
  return { ...snapshot, top_urgent: selectTopComplexes(snapshot.top_urgent), metadata: { ...metadata, status: 'ready' } };
}

export function isCurrentMarketReport(row, metadata) {
  return metadata?.status === 'ready'
    && row?.report_data?.sourceSnapshotId === metadata.snapshotId
    && row?.report_data?.aggregationVersion === MARKET_AGGREGATION_VERSION
    && row.data_as_of === metadata.reportPeriod?.end;
}
