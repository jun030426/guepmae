import { basisFromComplexRow, computePriceBasis, expandTradeRow, heldBasis, MIN_SAMPLE as BASIS_MIN_SAMPLE } from './priceBasis.js';

export async function resolveReferencePrice(db, { complexName, gu, areaM2, floor, price }) {
  const today = new Date().toISOString().slice(0, 10);
  const requested = Number.isFinite(Number(areaM2)) ? Math.floor(Number(areaM2)) : null;
  if (!gu || !complexName || requested == null) {
    return { price: null, source: null, basis: heldBasis('no_data', { requestedAreaM2: requested, areaM2: requested, computedAt: today }) };
  }

  // 1순위: 개별 실거래 (요청 면적 ±2㎡ 행만)
  const { data: tradeRows, error: tradeError } = await db
    .from('complex_trades')
    .select('area_m2, trades, latest_year_month')
    .eq('complex', complexName)
    .eq('gu', gu);
  if (tradeError) throw tradeError;
  const rows = Array.isArray(tradeRows)
    ? tradeRows.filter((row) => Math.abs(Number(row.area_m2) - requested) <= 2)
    : [];
  if (rows.length > 0) {
    const trades = rows.flatMap(expandTradeRow);
    const asOf = rows.map((row) => row.latest_year_month).filter(Boolean).sort().pop() ?? undefined;
    const basis = computePriceBasis({ trades, areaM2: requested, floor, price, asOf, computedAt: today });
    return { price: basis.baselinePrice, source: basis.status === 'ok' ? 'complex' : null, basis };
  }

  // 2순위: 중앙값 테이블 — 동일 면적 → 근접 면적(±2㎡, 표본 최다)
  const columns = 'median_price, sample_size, area_m2, earliest_year_month, latest_year_month';
  const enough = (row) => row?.median_price && (Number(row.sample_size) || 0) >= BASIS_MIN_SAMPLE;
  const { data: exact, error: exactError } = await db
    .from('complex_prices')
    .select(columns)
    .eq('complex', complexName)
    .eq('gu', gu)
    .eq('area_m2', requested)
    .maybeSingle();
  if (exactError) throw exactError;
  if (enough(exact)) {
    const basis = basisFromComplexRow(exact, { requestedAreaM2: requested, approxArea: false, price, computedAt: today });
    return { price: basis.baselinePrice, source: 'complex', basis };
  }
  const { data: near, error: nearError } = await db
    .from('complex_prices')
    .select(columns)
    .eq('complex', complexName)
    .eq('gu', gu)
    .gte('area_m2', requested - 2)
    .lte('area_m2', requested + 2)
    .order('sample_size', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (nearError) throw nearError;
  if (enough(near)) {
    const basis = basisFromComplexRow(near, { requestedAreaM2: requested, approxArea: true, price, computedAt: today });
    return { price: basis.baselinePrice, source: 'complex', basis };
  }

  // 판정 보류 — 표본이 얇은 값(1~2건)을 기준가로 쓰지 않는다
  const thin = exact ?? near;
  const basis = thin
    ? heldBasis('low_sample', {
        requestedAreaM2: requested,
        areaM2: Number(thin.area_m2),
        approxArea: Number(thin.area_m2) !== requested,
        totalSample36: Number(thin.sample_size) || 0,
        dataAsOf: thin.latest_year_month ?? null,
        computedAt: today,
        method: `동일 단지 ${thin.area_m2}㎡ 실거래 ${Number(thin.sample_size) || 0}건 — 표본 부족(${BASIS_MIN_SAMPLE}건 미만)으로 판정 보류`,
      })
    : heldBasis('no_data', { requestedAreaM2: requested, areaM2: requested, computedAt: today });
  return { price: null, source: null, basis };
}

