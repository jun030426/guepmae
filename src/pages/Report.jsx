import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowRight as ArrowFlatRight, ArrowUpRight, Database, Info } from 'lucide-react';
import SectionTitle from '../components/SectionTitle.jsx';
import AiMarketReport from '../components/report/AiMarketReport.jsx';
import RegionRadar from '../components/report/RegionRadar.jsx';
import {
  fetchAreaTypeBreakdown,
  fetchMarketInsights,
  fetchMonthlyTrend,
  fetchRegionalSnapshots,
  fetchTopUrgentComplexes,
  TOP_COMPLEX_MIN_SAMPLE,
  TOP_COMPLEX_SOLID_SAMPLE,
  getDataSource,
} from '../services/reportData.js';
import { fetchMarketReport } from '../services/marketReport.js';
import { formatRegionName } from '../utils/regionName.js';
import { reportPeriodLabel, regionCategories } from '../utils/marketReportModel.js';
import { PRIMARY, TEXT_STRONG, TEXT_STRONG_SOFT, TEXT_MUTED, BORDER } from '../styles/tokens.js';

// 차트 의미 이름 유지 + 토큰 미러 사용 (tokens.js가 truth 미러)
const CHART_INK = TEXT_STRONG;
const CHART_MUTED = TEXT_MUTED;
const CHART_GRID = BORDER;
// 부호별 막대 색 — 프리미엄(음수)=테라코타, 할인(양수)=차콜 (사이트 톤 통일)
const PREMIUM_FILL = PRIMARY;
const DISCOUNT_FILL = TEXT_STRONG_SOFT;

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

// 상단 헤드라인 카드 — 4개. 차콜 화살표(↗↘→) + 의미는 텍스트로.
function HeadlineCard({ tone, label, mainValue, mainSub, change, sub, meta, linkTo }) {
  const Wrap = linkTo ? Link : 'div';
  const wrapProps = linkTo ? { to: linkTo } : {};

  const ChangeIcon =
    change?.direction === 'up'
      ? ArrowUpRight
      : change?.direction === 'down'
        ? ArrowDownRight
        : ArrowFlatRight;

  return (
    <Wrap
      {...wrapProps}
      className={`headline-card headline-card-${tone}${linkTo ? ' headline-card-clickable' : ''}`}
    >
      <div className="headline-card-head">
        <span className="headline-card-dot" aria-hidden="true" />
        <h3>{label}</h3>
      </div>
      <div className="headline-card-main">
        <strong className="headline-card-value">{mainValue}</strong>
        {mainSub && <span className="headline-card-value-sub">{mainSub}</span>}
        {change && (
          <span className="headline-card-change">
            <ChangeIcon size={14} aria-hidden="true" />
            {change.text}
          </span>
        )}
      </div>
      {sub && <p className="headline-card-sub">{sub}</p>}
      {meta && <p className="headline-card-meta">{meta}</p>}
    </Wrap>
  );
}

// Hero 아래 분류 카드 — 평균 부호로 프리미엄/할인 분류, 조회된 시도 표시
function MarketCategoryCards({ rows }) {
  const { premium, discount, neutral, insufficient } = useMemo(() => {
    const categories = regionCategories(rows);
    return {
      ...categories,
      premium: categories.premium
        .sort((a, b) => a.averageDiscount - b.averageDiscount), // 음수가 큰(=프리미엄 강한) 순
      discount: categories.discount
        .sort((a, b) => b.averageDiscount - a.averageDiscount), // 양수가 큰(=할인 강한) 순
    };
  }, [rows]);

  if (!rows?.length) return null;

  const fmtMedian = (v) => {
    if (v == null) return '—';
    if (v === 0) return '0%';
    return v > 0 ? `+${v}%` : `${v}%`;
  };

  return (
    <section className="container market-category-section">
      {neutral.length > 0 && <p className="chart-subtitle">평균 할인율 0%: {neutral.map((r) => formatRegionName(r.region)).join(' · ')}</p>}
      {insufficient.length > 0 && <p className="chart-subtitle">비교 표본 부족: {insufficient.map((r) => formatRegionName(r.region)).join(' · ')}</p>}
      <div className="market-category-grid">
        <article className="market-category-card market-category-premium">
          <header className="market-category-header">
            <span className="market-category-dot" aria-hidden="true" />
            <div>
              <h2>
                프리미엄 지역 <strong>{premium.length}곳</strong>
              </h2>
              <p>집계 기간 비교 중앙값보다 높은 가격에 거래된 지역</p>
            </div>
          </header>
          <ul className="market-category-list">
            {premium.map((r) => (
              <li key={r.region}>
                <Link
                  to={`/properties?region=${encodeURIComponent(r.region)}`}
                  className="market-category-row"
                >
                  <span className="market-category-region">{formatRegionName(r.region)}</span>
                  <span className="market-category-values">
                    <strong>{r.averageDiscount}%</strong>
                    <em>중앙값 {fmtMedian(r.medianDiscount)}</em>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </article>

        <article className="market-category-card market-category-discount">
          <header className="market-category-header">
            <span className="market-category-dot" aria-hidden="true" />
            <div>
              <h2>
                할인 우세 지역 <strong>{discount.length}곳</strong>
              </h2>
              <p>집계 기간 비교 중앙값보다 낮은 가격에 거래된 지역</p>
            </div>
          </header>
          <ul className="market-category-list">
            {discount.map((r) => (
              <li key={r.region}>
                <Link
                  to={`/properties?region=${encodeURIComponent(r.region)}`}
                  className="market-category-row"
                >
                  <span className="market-category-region">{formatRegionName(r.region)}</span>
                  <span className="market-category-values">
                    <strong>+{r.averageDiscount}%</strong>
                    <em>중앙값 {fmtMedian(r.medianDiscount)}</em>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

// 지역 차트 아래 자동 해석 — 데이터 규칙으로 한 줄씩 자동 생성
function RegionChartNotes({ rows }) {
  const notes = useMemo(() => {
    if (!rows?.length) return null;
    const gapRows = rows.filter(
      (r) => Math.abs((r.averageDiscount ?? 0) - (r.medianDiscount ?? 0)) >= 5,
    );
    const topDiscount = [...rows].sort((a, b) => b.averageDiscount - a.averageDiscount)[0];
    const premiumCount = rows.filter((r) => r.averageDiscount < 0).length;
    return { gapRows, topDiscount, premiumCount };
  }, [rows]);

  if (!notes) return null;

  return (
    <div className="chart-note">
      <p className="chart-note-help">
        <Info size={13} aria-hidden="true" />
        막대 = 판정 가능한 거래의 평균 할인율 · ● 점 = 할인율 중앙값. 표본이 부족한 거래는 할인율 계산에서 제외합니다.
      </p>
      <ul className="chart-note-list">
        {notes.gapRows.length > 0 && (
          <li>
            <strong>{notes.gapRows.map((r) => formatRegionName(r.region)).join(' · ')}</strong>는 평균과 중앙값 차이가 큽니다. 거래별 할인율 분포를 함께 살펴봐야 합니다.
          </li>
        )}
        {notes.topDiscount && notes.topDiscount.averageDiscount > 0 && (
          <li>
            <strong>{formatRegionName(notes.topDiscount.region)}</strong>의 평균 할인율이 가장 높습니다 (+{notes.topDiscount.averageDiscount}%).
          </li>
        )}
        {notes.premiumCount > 0 && (
          <li>
            비교 중앙값 대비 평균 거래가가 높은 지역은 <strong>{notes.premiumCount}곳</strong>입니다.
          </li>
        )}
      </ul>
    </div>
  );
}

// 지역 차트 ComposedChart 의 custom Tooltip — 평균/중앙값/거래량 한꺼번에
function RegionDiscountTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const avg = row.averageDiscount;
  const med = row.medianDiscount;
  const meaning = avg == null ? '표본 부족' : avg > 0 ? '할인 우세' : avg < 0 ? '프리미엄' : '중립';
  return (
    <div className="region-tooltip">
      <p className="region-tooltip-name">{formatRegionName(row.region)}</p>
      <p className="region-tooltip-row">
        <span>평균</span>
        <strong>
          {formatPercent(avg)}
        </strong>
        <em>{meaning}</em>
      </p>
      <p className="region-tooltip-row">
        <span>중앙값</span>
        <strong>
          {formatPercent(med)}
        </strong>
        <em>할인율 중앙값</em>
      </p>
      <p className="region-tooltip-row">
        <span>거래</span>
        <strong>{row.transactionVolume?.toLocaleString() ?? '?'}건</strong>
      </p>
    </div>
  );
}

// 월별 추이 차트 custom Tooltip — null(반대 segment) 자동 제외, 한글 라벨
function MonthlyTrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const vol = payload.find(
    (p) =>
      p.dataKey === 'transactionVolume' &&
      p.value != null,
  );
  const urg = payload.find(
    (p) =>
      p.dataKey === 'urgentCount' &&
      p.value != null,
  );
  return (
    <div className="region-tooltip">
      <p className="region-tooltip-name">{label}</p>
      {vol && (
        <p className="region-tooltip-row">
          <span>거래량</span>
          <strong>{vol.value.toLocaleString()}건</strong>
        </p>
      )}
      {urg && (
        <p className="region-tooltip-row">
          <span>급매로 분류된 거래</span>
          <strong>{urg.value.toLocaleString()}건</strong>
        </p>
      )}
    </div>
  );
}

// 모든 카드·차트와 같은 12개월 전체 거래를 분모로 사용한다.
function MonthlyTrendNotes({ rows }) {
  const notes = useMemo(() => {
    if (!rows?.length || rows.length < 2) return null;
    const totalUrgent = rows.reduce((s, m) => s + (m.urgentCount ?? 0), 0);
    const totalVol = rows.reduce((s, m) => s + (m.transactionVolume ?? 0), 0);
    const avgUrgent = totalVol > 0 ? (totalUrgent / totalVol) * 100 : 0;
    const ratios = rows
      .map((m) => (m.transactionVolume > 0 ? (m.urgentCount / m.transactionVolume) * 100 : null))
      .filter((v) => v != null);
    const minRatio = ratios.length ? Math.min(...ratios) : 0;
    const maxRatio = ratios.length ? Math.max(...ratios) : 0;
    const last = rows[rows.length - 1];
    return {
      avgUrgent: avgUrgent.toFixed(1),
      range: `${minRatio.toFixed(1)} ~ ${maxRatio.toFixed(1)}`,
      lastMonth: last.month,
      lastVolume: last.transactionVolume,
    };
  }, [rows]);

  if (!notes) return null;

  return (
    <div className="chart-note">
      <p className="chart-note-help">
        <Info size={13} aria-hidden="true" />
        신고 지연과 해제 신고에 따라 과거 월의 수치도 바뀔 수 있습니다.
      </p>
      <ul className="chart-note-list">
        <li>
          집계 기간 전체 급매비율 <strong>{notes.avgUrgent}%</strong> (월별 {notes.range}% 범위)
        </li>
        <li>
          마지막 집계 월 <strong>{notes.lastMonth}</strong> 거래{' '}
          {notes.lastVolume?.toLocaleString()}건
        </li>
      </ul>
    </div>
  );
}

// 면적대 차트 X축 — bucket 이름 + 급매비율 + 표본 3줄
function AreaBucketTick({ x, y, payload, rows }) {
  const row = rows?.find((r) => r.bucket === payload?.value);
  if (!row) {
    return (
      <text x={x} y={y} dy={14} textAnchor="middle" fontSize={12} fill={TEXT_STRONG}>
        {payload?.value}
      </text>
    );
  }
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" dy={14} fontSize={12} fill={TEXT_STRONG}>
        {payload.value}
      </text>
      <text textAnchor="middle" dy={30} fontSize={12} fill={TEXT_MUTED}>
        급매 {Math.round((row.urgentRatio ?? 0) * 100)}%
      </text>
      <text textAnchor="middle" dy={44} fontSize={12} fill={TEXT_MUTED}>
        {row.transactionVolume?.toLocaleString() ?? '?'}건
      </text>
    </g>
  );
}

// 면적대 차트 아래 자동 인사이트 — 급매비율 1위·표본 1위·표본 최저
function AreaChartNotes({ rows }) {
  const notes = useMemo(() => {
    if (!rows?.length) return null;
    const byUrgent = [...rows].sort((a, b) => (b.urgentRatio ?? 0) - (a.urgentRatio ?? 0));
    const bySample = [...rows].sort(
      (a, b) => (b.transactionVolume ?? 0) - (a.transactionVolume ?? 0),
    );
    return {
      topUrgent: byUrgent[0],
      topSample: bySample[0],
      bottomSample: bySample[bySample.length - 1],
    };
  }, [rows]);

  if (!notes) return null;

  return (
    <div className="chart-note">
      <p className="chart-note-help">
        <Info size={13} aria-hidden="true" />
        막대 = 집계 기간 거래가 중앙값(억). 면적대 분류는 통계 표시용이며, 할인율은 같은 전용면적끼리 비교합니다.
      </p>
      <ul className="chart-note-list">
        <li>
          <strong>{notes.topUrgent.bucket}</strong> — 급매비율{' '}
          {Math.round((notes.topUrgent.urgentRatio ?? 0) * 100)}% 최고 ({rows.length}개 면적대 중)
        </li>
        <li>
          <strong>{notes.topSample.bucket}</strong> — 표본{' '}
          {notes.topSample.transactionVolume?.toLocaleString()}건 (가장 많음)
        </li>
        <li>
          <strong>{notes.bottomSample.bucket}</strong> — 표본{' '}
          {notes.bottomSample.transactionVolume?.toLocaleString()}건 (가장 적음 · 보조 주의)
        </li>
      </ul>
    </div>
  );
}

function Report() {
  const navigate = useNavigate();

  // 차트 막대 클릭 → 해당 시도 매물 목록으로 navigate.
  // Chart-level onClick 은 Recharts 버전 차이로 안 잡힐 수 있어 Cell/Bar 레벨에서 직접 처리.
  // 매물 0인 지역(강원·제주 등)도 navigate — Properties.jsx 의 empty-state 가 안내.
  const goToRegion = (region) => {
    if (!region) return;
    navigate(`/properties?region=${encodeURIComponent(region)}`);
  };

  const [insights, setInsights] = useState([]);
  const [regionalRows, setRegionalRows] = useState([]);
  const [monthlyTrend, setMonthlyTrend] = useState([]);

  const [dataSource, setDataSource] = useState({ name: '국토교통부 실거래가', lastUpdated: '-', disclosureLag: '데이터 로딩 중', totalTrades: 0 });
  const periodLabel = reportPeriodLabel(dataSource);

  // 4개 헤드라인 카드 데이터 — monthly·regional·insights 에서 추출/계산
  const headlineCards = useMemo(() => {
    if (!monthlyTrend.length || !regionalRows.length) return null;

    // 마지막 집계 월과 전월의 급매비율 비교
    const last = monthlyTrend[monthlyTrend.length - 1];
    const prev = monthlyTrend[monthlyTrend.length - 2];
    const lastRatio = last?.transactionVolume
      ? (last.urgentCount / last.transactionVolume) * 100
      : 0;
    const prevRatio = prev?.transactionVolume
      ? (prev.urgentCount / prev.transactionVolume) * 100
      : 0;
    const ratioDiff = lastRatio - prevRatio;
    const ratioDir =
      Math.abs(ratioDiff) <= 0.5 ? 'flat' : ratioDiff > 0 ? 'up' : 'down';
    const ratioText =
      ratioDir === 'flat'
        ? '≈ 0%p vs 전월'
        : `${ratioDir === 'up' ? '+' : ''}${ratioDiff.toFixed(1)}%p vs 전월`;
    const oneOutOfN = lastRatio > 0 ? Math.round(100 / lastRatio) : null;

    // --- 카드 2: 할인 강도 (집계 기간 누적, marketInsights 에서 추출) ---
    const discountInsight = insights.find((i) => i.label === '급매 평균 할인율');
    const discountNum = parseFloat(discountInsight?.value);
    const medianMatch = discountInsight?.delta?.match(/(\d+\.?\d*)/);
    const medianNum = medianMatch ? parseFloat(medianMatch[1]) : null;
    const discountPerEok = Math.round(discountNum * 100); // 1억당 만원

    // --- 카드 3: 오늘의 주목 지역 (regional 양수 1위) ---
    const featured = [...regionalRows]
      .filter((r) => r.averageDiscount > 0)
      .sort((a, b) => b.averageDiscount - a.averageDiscount)[0];

    // 같은 두 달의 거래량 비교
    const completed = last;
    const prevCompleted = prev;
    const volDiff =
      prevCompleted?.transactionVolume
        ? ((completed.transactionVolume - prevCompleted.transactionVolume) /
            prevCompleted.transactionVolume) *
          100
        : 0;
    const volDir =
      Math.abs(volDiff) < 0.5 ? 'flat' : volDiff > 0 ? 'up' : 'down';
    const volText =
      volDir === 'flat'
        ? '≈ 0% vs 전월'
        : `${volDir === 'up' ? '+' : ''}${volDiff.toFixed(1)}% vs 전월`;

    return {
      urgentPressure: {
        tone: 'primary',
        label: '마지막 집계 월 급매비율',
        mainValue: last.transactionVolume ? formatPercent(lastRatio) : '—',
        change: last.transactionVolume && prev?.transactionVolume ? { direction: ratioDir, text: ratioText } : null,
        sub: oneOutOfN ? `${oneOutOfN}건 중 1건이 급매` : null,
        meta: `${last.month} · 비교 중앙값 대비 5% 이상 할인`,
      },
      discountIntensity: {
        tone: 'primary',
        label: '할인 강도',
        mainValue: formatPercent(discountNum),
        mainSub: medianNum != null ? `중앙값 ${medianNum.toFixed(1)}%` : null,
        sub: Number.isFinite(discountNum) ? `1억당 ${discountPerEok.toLocaleString()}만원 할인` : '급매로 분류된 거래 없음',
        meta: periodLabel,
      },
      featuredRegion: featured
        ? {
            tone: 'soft',
            label: '평균 할인율 상위 지역',
            mainValue: formatRegionName(featured.region),
            mainSub: `+${featured.averageDiscount}%`,
            sub: '집계 기간 평균 할인율 기준',
            meta: `중앙값 ${formatPercent(featured.medianDiscount)} · 거래 ${featured.transactionVolume?.toLocaleString() ?? '?'}건 · → 매물 보기`,
            linkTo: `/properties?region=${encodeURIComponent(featured.region)}`,
          }
        : null,
      momentum: completed
        ? {
            tone: 'soft',
            label: '거래 모멘텀',
            mainValue: `${completed.transactionVolume?.toLocaleString() ?? '?'}건`,
            change: prev?.transactionVolume ? { direction: volDir, text: volText } : null,
            meta: `${completed.month} 기준 · 신고 지연으로 변동 가능`,
          }
        : null,
    };
  }, [monthlyTrend, regionalRows, insights, periodLabel]);
  const [areaBreakdown, setAreaBreakdown] = useState([]);
  const [topComplexes, setTopComplexes] = useState([]);
  const [aiReport, setAiReport] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // 'loading' | 'ready' | 'error'

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchMarketInsights(),
      fetchRegionalSnapshots(),
      fetchMonthlyTrend(12),
      fetchAreaTypeBreakdown(),
      fetchTopUrgentComplexes(10),
      getDataSource(),
      fetchMarketReport(),
    ]).then(([nextInsights, nextRegional, nextMonthly, nextArea, nextTop, nextSource, nextAi]) => {
      if (!active) return;
      setInsights(nextInsights);
      setRegionalRows(nextRegional);
      setMonthlyTrend(nextMonthly);
      setAreaBreakdown(nextArea);
      setTopComplexes(nextTop);
      if (nextSource) setDataSource(nextSource);
      setAiReport(nextAi);
      setLoadState('ready');
    }).catch((loadError) => {
      if (!active) return;
      console.warn('리포트 데이터 로드 실패.', loadError);
      setDataSource((prev) => ({ ...prev, disclosureLag: '데이터 로드 실패' }));
      setLoadState('error');
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="report-page page-shell">
      <section className="page-hero compact-hero">
        <div className="container report-hero-grid">
          <SectionTitle
            as="h1"
            eyebrow="시장 데이터"
            title="급매 리포트"
            description="국토교통부 실거래가 데이터를 기반으로 지역·면적·단지별 급매 흐름을 정리합니다."
          />
          <div className="report-source-meta">
            <Database size={15} />
            <div>
              <strong>{dataSource.name}</strong>
              <span>마지막 갱신 {dataSource.lastUpdated} · {dataSource.disclosureLag}</span>
            </div>
          </div>
        </div>
      </section>

      {loadState !== 'ready' || dataSource.status !== 'ready' ? (
        <section className="container report-disclaimer" role="status">
          <p>{loadState === 'loading' ? '리포트를 불러오는 중입니다.' : loadState === 'error' ? '리포트를 불러오지 못했습니다. 새로고침해 주세요.' : '통계를 다시 집계하고 있습니다. 준비가 끝나면 리포트를 제공하겠습니다.'}</p>
        </section>
      ) : <>
      <section className="container report-disclaimer">
        <p><strong>집계 기간 {periodLabel}</strong> · 거래 {dataSource.totalRows?.toLocaleString()}건</p>
        <p>수집 시점의 행정구역 기준 {regionalRows.length}개 시도 · 과거 거래 통계이며 현재 등록된 매물 수가 아닙니다.</p>
        <details>
        <summary>집계 기준과 표본 확인</summary>
        <p>같은 지역·단지·전용면적의 집계 기간 거래가 중앙값보다 5% 이상 낮은 거래를 급매로 분류합니다. 비교 표본은 3건 이상이며 대상 거래도 포함합니다. 층수 차이는 보정하지 않아 개별 매물의 가격 판정과는 다릅니다.</p>
        <p>판정 가능 {dataSource.comparableRows?.toLocaleString()}건 · 표본 부족 {dataSource.unclassifiedRows?.toLocaleString()}건. 급매비율의 분모는 표본 부족 거래를 포함한 전체 집계 거래입니다. 해제·직거래는 제외합니다.</p>
        {dataSource.unknownDealingRows > 0 && <p>거래유형 미상 {dataSource.unknownDealingRows.toLocaleString()}건은 포함되어 있습니다.</p>}
        {dataSource.fallbackIdentityRows > 0 && <p>단지 식별정보가 없는 {dataSource.fallbackIdentityRows.toLocaleString()}건은 법정동·단지명·건축년도로 구분했습니다.</p>}
        </details>
      </section>
      {headlineCards && (
        <section className="container headline-cards-grid">
          <HeadlineCard {...headlineCards.urgentPressure} />
          <HeadlineCard {...headlineCards.discountIntensity} />
          {headlineCards.featuredRegion && (
            <HeadlineCard {...headlineCards.featuredRegion} />
          )}
          {headlineCards.momentum && (
            <HeadlineCard {...headlineCards.momentum} />
          )}
        </section>
      )}

      <MarketCategoryCards rows={regionalRows} />

      <section className="container report-grid-layout">
        <div className="chart-card chart-card-clickable">
          <div className="chart-title-row">
            <div className="chart-title-stack">
              <h3>지역별 비교 중앙값 대비 할인율</h3>
              <p className="chart-subtitle">
                음수 = 비교 중앙값보다 비싸게 거래 · 양수 = 할인 · <strong>막대 클릭 → 해당 지역 매물</strong>
              </p>
            </div>
            <span>단위 %</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={regionalRows} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="region" tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <YAxis tickLine={false} axisLine={false} unit="%" stroke={CHART_MUTED} />
              <Tooltip
                cursor={{ fill: 'rgba(15,15,15,0.04)' }}
                content={<RegionDiscountTooltip />}
              />
              <Bar dataKey="averageDiscount" radius={[2, 2, 0, 0]}>
                {regionalRows.map((entry) => (
                  <Cell
                    key={entry.region}
                    fill={entry.averageDiscount < 0 ? PREMIUM_FILL : DISCOUNT_FILL}
                    onClick={() => goToRegion(entry.region)}
                  />
                ))}
              </Bar>
              <Scatter
                dataKey="medianDiscount"
                fill="#ffffff"
                stroke={TEXT_STRONG}
                strokeWidth={2}
                shape="circle"
                r={5}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <RegionChartNotes rows={regionalRows} />
        </div>

        <div className="chart-card">
          <div className="chart-title-row">
            <div className="chart-title-stack">
              <h3>월별 거래량과 급매 거래 추이</h3>
              <p className="chart-subtitle">{periodLabel} · 계약월 기준</p>
            </div>
            <span>건</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={monthlyTrend}
              margin={{ top: 20, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <YAxis tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <Tooltip content={<MonthlyTrendTooltip />} />
              <Legend wrapperStyle={{ fontSize: '12px', color: CHART_MUTED }} />
              <Line type="monotone" dataKey="transactionVolume" name="거래량" stroke={CHART_MUTED} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="urgentCount" name="급매로 분류된 거래" stroke={CHART_INK} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <MonthlyTrendNotes rows={monthlyTrend} />
        </div>
      </section>

      <section className="container report-grid-layout">
        <div className="chart-card">
          <div className="chart-title-row">
            <div className="chart-title-stack">
              <h3>면적대별 시장 분포</h3>
              <p className="chart-subtitle">
                {periodLabel} · 막대 = 거래가 <strong>중앙값</strong>(억)
              </p>
            </div>
            <span>단위 억</span>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={areaBreakdown} margin={{ top: 24, right: 12, left: 0, bottom: 36 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                stroke={CHART_MUTED}
                tick={<AreaBucketTick rows={areaBreakdown} />}
                interval={0}
                height={56}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                stroke={CHART_MUTED}
                tickFormatter={(value) => `${Math.round(value / 100000000)}억`}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15,15,15,0.04)' }}
                formatter={(value, _name, ctx) => {
                  const row = ctx?.payload;
                  const avg = row?.averageDealPrice
                    ? `(평균 ${(row.averageDealPrice / 100000000).toFixed(2)}억)`
                    : '';
                  return [`${(value / 100000000).toFixed(2)}억 ${avg}`, '중앙값 거래가'];
                }}
                labelFormatter={(label) => {
                  const row = areaBreakdown.find((r) => r.bucket === label);
                  if (!row) return label;
                  return `${label} · 평균할인 ${formatPercent(row.averageDiscount)} · 급매 ${Math.round((row.urgentRatio ?? 0) * 100)}% · 표본 ${row.transactionVolume?.toLocaleString()}건`;
                }}
              />
              <Bar dataKey="medianDealPrice" fill={DISCOUNT_FILL} radius={[2, 2, 0, 0]}>
                <LabelList
                  dataKey="averageDiscount"
                  position="top"
                  formatter={formatPercent}
                  fontSize={12}
                  fill={TEXT_MUTED}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <AreaChartNotes rows={areaBreakdown} />
        </div>

        <RegionRadar rows={regionalRows} periodLabel={periodLabel} />
      </section>

      <section className="container">
        <div className="report-table-card">
          <div className="chart-title-row">
            <h3>급매 집중 단지</h3>
            <span>
              {periodLabel} · 거래 표본 {TOP_COMPLEX_MIN_SAMPLE}건 이상
              {topComplexes.length > 0 && ` · ${topComplexes.length}곳`}
            </span>
          </div>
          <div className="report-table-wrap">
            <p className="chart-subtitle">급매비율이 높은 순서입니다. 평균 할인율은 급매 외의 비교 가능한 거래도 포함합니다.</p>
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>순위</th>
                  <th>단지명</th>
                  <th>지역</th>
                  <th style={{ textAlign: 'right' }}>급매 거래</th>
                  <th style={{ textAlign: 'right' }}>표본</th>
                  <th style={{ textAlign: 'right' }}>평균 할인율</th>
                </tr>
              </thead>
              <tbody>
                {topComplexes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="report-table-empty">
                      {loadState === 'loading'
                        ? '단지 데이터를 불러오는 중...'
                        : loadState === 'error'
                          ? '단지 데이터를 불러오지 못했습니다. 새로고침해 주세요.'
                          : `거래 표본 ${TOP_COMPLEX_MIN_SAMPLE}건 이상을 충족한 단지가 아직 없습니다.`}
                    </td>
                  </tr>
                ) : (
                  topComplexes.map((row) => (
                    <tr key={row.complexId}>
                      <td>{row.rank}</td>
                      <td><strong>{row.complex}</strong></td>
                      <td>{row.region}</td>
                      <td style={{ textAlign: 'right' }}>{row.dealCount}건</td>
                      <td style={{ textAlign: 'right' }}>
                        {row.sampleSize}건
                        {row.sampleSize < TOP_COMPLEX_SOLID_SAMPLE && (
                          <span className="sample-caution"> 표본 적음</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatPercent(row.averageDiscount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <AiMarketReport report={aiReport} />
      </>}

      <section className="container report-disclaimer">
        <p>
          본 리포트는 국토교통부 실거래가 데이터를 기반으로 자동 집계된 통계입니다.
          매수·매도 권유가 아닌 정보 제공 목적의 자료이며, 투자 의사결정은 본인의 책임 하에 진행하시기 바랍니다.
        </p>
      </section>
    </div>
  );
}

export default Report;
