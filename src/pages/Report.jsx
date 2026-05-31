import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Database, Info } from 'lucide-react';
import SectionTitle from '../components/SectionTitle.jsx';
import AiMarketReport from '../components/report/AiMarketReport.jsx';
import {
  fetchAreaTypeBreakdown,
  fetchMarketInsights,
  fetchMonthlyTrend,
  fetchRegionalSnapshots,
  fetchTopUrgentComplexes,
  getDataSource,
} from '../services/reportData.js';
import { fetchMarketReport } from '../services/marketReport.js';
import { formatPrice } from '../utils/priceUtils.js';
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

function InsightCard({ insight }) {
  const isUp = insight.direction === 'up';
  const Arrow = isUp ? ArrowUpRight : ArrowDownRight;
  const className = isUp ? 'report-insight up' : 'report-insight down';

  return (
    <div className={className}>
      <span className="report-insight-label">{insight.label}</span>
      <strong>{insight.value}</strong>
      <span className="report-insight-delta">
        <Arrow size={14} />
        {insight.delta} <em>· {insight.note}</em>
      </span>
    </div>
  );
}

// Hero 아래 분류 카드 — 평균 부호로 프리미엄/할인 분류, 17개 시도 다 표시
function MarketCategoryCards({ rows }) {
  const { premium, discount } = useMemo(() => {
    if (!rows?.length) return { premium: [], discount: [] };
    return {
      premium: rows
        .filter((r) => r.averageDiscount < 0)
        .sort((a, b) => a.averageDiscount - b.averageDiscount), // 음수가 큰(=프리미엄 강한) 순
      discount: rows
        .filter((r) => r.averageDiscount > 0)
        .sort((a, b) => b.averageDiscount - a.averageDiscount), // 양수가 큰(=할인 강한) 순
    };
  }, [rows]);

  if (!premium.length && !discount.length) return null;

  const fmtMedian = (v) => {
    if (v == null) return '—';
    if (v === 0) return '0%';
    return v > 0 ? `+${v}%` : `${v}%`;
  };

  return (
    <section className="container market-category-section">
      <div className="market-category-grid">
        <article className="market-category-card market-category-premium">
          <header className="market-category-header">
            <span className="market-category-dot" aria-hidden="true" />
            <div>
              <h2>
                프리미엄 지역 <strong>{premium.length}곳</strong>
              </h2>
              <p>또래 시세 대비 평균 음수 — 시세 상승세, 매수 신중</p>
            </div>
          </header>
          <ul className="market-category-list">
            {premium.map((r) => (
              <li key={r.region}>
                <span className="market-category-region">{r.region}</span>
                <span className="market-category-values">
                  <strong>{r.averageDiscount}%</strong>
                  <em>중앙값 {fmtMedian(r.medianDiscount)}</em>
                </span>
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
              <p>또래 시세 대비 평균 양수 — 급매 발굴 여지</p>
            </div>
          </header>
          <ul className="market-category-list">
            {discount.map((r) => (
              <li key={r.region}>
                <span className="market-category-region">{r.region}</span>
                <span className="market-category-values">
                  <strong>+{r.averageDiscount}%</strong>
                  <em>중앙값 {fmtMedian(r.medianDiscount)}</em>
                </span>
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
        막대 = 전체 거래 평균 · ● 점 = 일반 매물 기준(중앙값). 둘이 멀면 소수 고가 거래가 평균을 흔든 것입니다.
      </p>
      <ul className="chart-note-list">
        {notes.gapRows.length > 0 && (
          <li>
            <strong>{notes.gapRows.map((r) => r.region).join(' · ')}</strong>는 평균과 중앙값 차이가 큽니다 — 소수 고가 거래가 평균을 끌어내림(일반 매물은 거의 시세대로).
          </li>
        )}
        {notes.topDiscount && notes.topDiscount.averageDiscount > 0 && (
          <li>
            <strong>{notes.topDiscount.region}</strong>가 가장 할인 우세 (+{notes.topDiscount.averageDiscount}%) — 급매 발굴 여지.
          </li>
        )}
        {notes.premiumCount > 0 && (
          <li>
            프리미엄 우세 <strong>{notes.premiumCount}곳</strong> — 시세 상승세, 매수 신중.
          </li>
        )}
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
  const [areaBreakdown, setAreaBreakdown] = useState([]);
  const [topComplexes, setTopComplexes] = useState([]);
  const [dataSource, setDataSource] = useState({ name: '국토교통부 실거래가', lastUpdated: '-', disclosureLag: '데이터 로딩 중', totalTrades: 0 });
  const [aiReport, setAiReport] = useState(null);

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

      <MarketCategoryCards rows={regionalRows} />

      <section className="container report-insight-grid">
        {insights.map((insight) => (
          <InsightCard key={insight.label} insight={insight} />
        ))}
      </section>

      <section className="container report-grid-layout">
        <div className="chart-card chart-card-clickable">
          <div className="chart-title-row">
            <div className="chart-title-stack">
              <h3>지역별 시세 대비 등락</h3>
              <p className="chart-subtitle">
                음수 = 프리미엄(또래 시세보다 비싸게) · 양수 = 할인 · <strong>막대 클릭 → 해당 지역 매물</strong>
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
                formatter={(value, name) => {
                  const label = name === 'averageDiscount' ? '평균' : '중앙값(일반)';
                  return [`${value}%`, label];
                }}
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
            <h3>월별 거래량과 급매 매물 추이</h3>
            <span>최근 12개월</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthlyTrend} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <YAxis tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '12px', color: CHART_MUTED }} />
              <Line
                type="monotone"
                dataKey="transactionVolume"
                name="거래량"
                stroke={CHART_MUTED}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="urgentCount"
                name="급매 매물"
                stroke={CHART_INK}
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="container report-grid-layout">
        <div className="chart-card">
          <div className="chart-title-row">
            <h3>면적대별 평균 거래가</h3>
            <span>전용면적 기준</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={areaBreakdown} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <YAxis
                tickLine={false}
                axisLine={false}
                stroke={CHART_MUTED}
                tickFormatter={(value) => `${Math.round(value / 100000000)}억`}
              />
              <Tooltip formatter={(value) => [formatPrice(value), '평균 거래가']} />
              <Bar dataKey="averageDealPrice" fill={CHART_INK} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card chart-card-clickable">
          <div className="chart-title-row">
            <div className="chart-title-stack">
              <h3>지역별 거래량</h3>
              <p className="chart-subtitle">
                최근 30일 · <strong>막대 클릭 → 해당 지역 매물</strong>
              </p>
            </div>
            <span>건</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={regionalRows} layout="vertical" margin={{ top: 12, right: 12, left: 12, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <YAxis type="category" dataKey="region" tickLine={false} axisLine={false} stroke={CHART_MUTED} width={48} />
              <Tooltip formatter={(value) => [`${value}건`, '거래량']} />
              <Bar dataKey="transactionVolume" fill={CHART_INK} radius={[0, 2, 2, 0]}>
                {regionalRows.map((entry) => (
                  <Cell
                    key={entry.region}
                    fill={CHART_INK}
                    onClick={() => goToRegion(entry.region)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="container">
        <div className="report-table-card">
          <div className="chart-title-row">
            <h3>급매 집중 단지 Top 10</h3>
            <span>거래 표본 30건 이상</span>
          </div>
          <div className="report-table-wrap">
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
                {topComplexes.map((row) => (
                  <tr key={row.rank}>
                    <td>{row.rank}</td>
                    <td><strong>{row.complex}</strong></td>
                    <td>{row.region}</td>
                    <td style={{ textAlign: 'right' }}>{row.dealCount}건</td>
                    <td style={{ textAlign: 'right' }}>{row.sampleSize}건</td>
                    <td style={{ textAlign: 'right' }}>{formatPercent(row.averageDiscount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <AiMarketReport report={aiReport} />

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
