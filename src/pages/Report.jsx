import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Database, Sparkles, Lock } from 'lucide-react';
import SectionTitle from '../components/SectionTitle.jsx';
import {
  fetchAreaTypeBreakdown,
  fetchMarketInsights,
  fetchMonthlyTrend,
  fetchRegionalSnapshots,
  fetchTopUrgentComplexes,
  getDataSource,
} from '../services/reportData.js';
import { formatPrice } from '../utils/priceUtils.js';

const CHART_INK = '#0f0f0f';
const CHART_MUTED = '#8a8a8a';
const CHART_GRID = '#e5e5e5';

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

function Report() {
  const [insights, setInsights] = useState([]);
  const [regionalRows, setRegionalRows] = useState([]);
  const [monthlyTrend, setMonthlyTrend] = useState([]);
  const [areaBreakdown, setAreaBreakdown] = useState([]);
  const [topComplexes, setTopComplexes] = useState([]);
  const [dataSource, setDataSource] = useState({ name: '국토교통부 실거래가', lastUpdated: '-', disclosureLag: '데이터 로딩 중', totalTrades: 0 });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchMarketInsights(),
      fetchRegionalSnapshots(),
      fetchMonthlyTrend(12),
      fetchAreaTypeBreakdown(),
      fetchTopUrgentComplexes(10),
      getDataSource(),
    ]).then(([nextInsights, nextRegional, nextMonthly, nextArea, nextTop, nextSource]) => {
      if (!active) return;
      setInsights(nextInsights);
      setRegionalRows(nextRegional);
      setMonthlyTrend(nextMonthly);
      setAreaBreakdown(nextArea);
      setTopComplexes(nextTop);
      if (nextSource) setDataSource(nextSource);
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

      <section className="container report-insight-grid">
        {insights.map((insight) => (
          <InsightCard key={insight.label} insight={insight} />
        ))}
      </section>

      <section className="container report-grid-layout">
        <div className="chart-card">
          <div className="chart-title-row">
            <h3>지역별 평균 할인율</h3>
            <span>단위 %</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={regionalRows} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="region" tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <YAxis tickLine={false} axisLine={false} unit="%" stroke={CHART_MUTED} />
              <Tooltip
                cursor={{ fill: 'rgba(15,15,15,0.04)' }}
                formatter={(value) => [`${value}%`, '평균 할인율']}
              />
              <Bar dataKey="averageDiscount" fill={CHART_INK} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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

        <div className="chart-card">
          <div className="chart-title-row">
            <h3>지역별 거래량</h3>
            <span>최근 30일</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={regionalRows} layout="vertical" margin={{ top: 12, right: 12, left: 12, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} stroke={CHART_MUTED} />
              <YAxis type="category" dataKey="region" tickLine={false} axisLine={false} stroke={CHART_MUTED} width={48} />
              <Tooltip formatter={(value) => [`${value}건`, '거래량']} />
              <Bar dataKey="transactionVolume" fill={CHART_INK} radius={[0, 2, 2, 0]} />
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

      <section className="container ai-teaser-section">
        <div className="ai-teaser-card">
          <div className="ai-teaser-header">
            <span className="ai-teaser-badge">
              <Sparkles size={13} />
              COMING SOON
            </span>
            <h2>AI 시장 분석 리포트</h2>
            <p>
              국토부 실거래가 데이터와 국토연구원·부동산시장조사 보고서를 종합하여
              <strong> 매주 자동으로 정성 분석을 생성</strong>합니다. 단지·지역별 상승·하락 흐름,
              관찰 포인트, 다음 달 모니터링 지표까지 한 화면에서.
            </p>
          </div>

          <div className="ai-teaser-preview" aria-hidden="true">
            <div className="ai-teaser-row">
              <span className="ai-teaser-eyebrow">상승 관찰 지역</span>
              <div className="ai-teaser-chips">
                <span>서울 강남구 +0.8%p</span>
                <span>경기 성남시 +0.6%p</span>
                <span>인천 연수구 +0.5%p</span>
              </div>
            </div>
            <div className="ai-teaser-row">
              <span className="ai-teaser-eyebrow">관찰 포인트</span>
              <p>
                ████████ 거래량이 ████ 증가하는 패턴이 관찰됩니다. ██████ 면적대에서 ████████
                할인율이 ██████ 형성되어 있어 ████████.
              </p>
            </div>
            <div className="ai-teaser-lock">
              <Lock size={18} />
              <span>AI 분석은 출시 후 공개됩니다</span>
            </div>
          </div>

          <div className="ai-teaser-meta">
            <div>
              <strong>예정 기능</strong>
              <ul>
                <li>지역·단지별 상승·하락 자동 추천</li>
                <li>국토연구원 보고서 자동 인용</li>
                <li>주간 리포트 이메일 발송</li>
              </ul>
            </div>
            <div>
              <strong>현재 상태</strong>
              <ul>
                <li>데이터 파이프라인 ✓</li>
                <li>분석 모델 설계 중</li>
                <li>법무 검토 대기</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

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
