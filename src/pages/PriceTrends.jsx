/*
 * PriceTrends — /trends 시세 동향 페이지 (단계별 구축 중)
 *
 * 1단계 셸: URL 쿼리로 (sido, gu, bucket) 보존 + 디폴트 진입(서울 강남구 60–85㎡)
 *           + fetchRegionOptions + fetchPriceTrend 병렬 호출 + 로딩/임시 디버그 출력.
 *
 * 다음 단계: TrendsHero / TrendFilterBar / TrendChartCard / TrendStatGrid 컴포넌트로 교체.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchPriceTrend, fetchRegionOptions } from '../services/trendData.js';
import TrendsHero from '../components/trends/TrendsHero.jsx';

// 디폴트 진입 — 표본 풍부 + 사용자 가장 궁금할 영역
const DEFAULT_SIDO = '서울특별시';
const DEFAULT_GU = '서울특별시 강남구';
const DEFAULT_BUCKET = '60–85㎡';

function PriceTrends() {
  const [searchParams] = useSearchParams();
  const sido = searchParams.get('sido') ?? DEFAULT_SIDO;
  const gu = searchParams.get('gu') ?? DEFAULT_GU;
  const bucket = searchParams.get('bucket') ?? DEFAULT_BUCKET;

  const [options, setOptions] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchRegionOptions(),
      fetchPriceTrend({ gu, areaBucket: bucket }),
    ])
      .then(([opts, res]) => {
        if (!active) return;
        setOptions(opts);
        setResult(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gu, bucket]);

  const lastYearMonth = result?.series?.at(-1)?.yearMonth;

  return (
    <div className="trends-page page-shell">
      <TrendsHero lastYearMonth={lastYearMonth} />

      <section className="container" style={{ padding: '32px 24px' }}>
        <h1 style={{ marginBottom: 16, fontSize: 18, color: '#999' }}>
          개발 중 · 디버그 출력 (다음 단계에서 FilterBar·차트·카드로 교체)
        </h1>
        {loading && <p>로딩 중...</p>}
        {!loading && (
          <pre
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              background: '#f7f7f7',
              padding: 16,
              border: '1px solid #e5e5e5',
              borderRadius: 4,
              overflow: 'auto',
            }}
          >
{JSON.stringify(
  {
    selection: { sido, gu, bucket },
    regionOptions: {
      sidos: options?.sidos?.length ?? 0,
      sampleSidos: options?.sidos?.slice(0, 5),
      guCountForSelectedSido: options?.guBySido?.[sido]?.length ?? 0,
      sampleGu: options?.guBySido?.[sido]?.slice(0, 5),
    },
    trendResult: {
      seriesLength: result?.series?.length ?? 0,
      reliability: result?.reliability,
      realMonths: result?.realMonths,
      sampleTotal: result?.sampleTotal,
      firstMonth: result?.series?.[0]?.yearMonth,
      lastMonth: result?.series?.at(-1)?.yearMonth,
      firstPrice: result?.series?.[0]?.price,
      lastPrice: result?.series?.at(-1)?.price,
    },
  },
  null,
  2,
)}
          </pre>
        )}
      </section>
    </div>
  );
}

export default PriceTrends;
