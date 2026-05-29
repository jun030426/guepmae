import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, TrendingDown } from 'lucide-react';
import {
  calculateDiscountRate,
  calculatePriceGap,
  formatPrice,
  isUrgentSale,
} from '../utils/priceUtils.js';

function PriceReport({ property }) {
  const discountRate = calculateDiscountRate(property.price, property.actualTransactionPrice);
  const priceGap = calculatePriceGap(property.price, property.actualTransactionPrice);
  const urgent = isUrgentSale(property.price, property.actualTransactionPrice);

  const chartData = property.priceHistory;
  const hasChart = Array.isArray(chartData) && chartData.length > 0;
  const hasEstimated = hasChart && chartData.some((point) => point.estimated);

  // 실거래=채운 점, 재생산 추정=빨강 테두리 빈 점
  const renderDot = (props) => {
    const { cx, cy, payload, index } = props;
    if (cx == null || cy == null) return null;
    if (payload?.estimated) {
      return (
        <circle key={payload.yearMonth ?? index} cx={cx} cy={cy} r={4} fill="#ffffff" stroke="#d83324" strokeWidth={2} />
      );
    }
    return <circle key={payload?.yearMonth ?? index} cx={cx} cy={cy} r={4} fill="#d83324" />;
  };

  return (
    <section className="price-report">
      <div className="report-header">
        <div>
          <p className="section-eyebrow">가격 검증 리포트</p>
          <h2>실거래가 대비 가격 차이</h2>
        </div>
        <span className={urgent ? 'verdict positive' : 'verdict'}>
          <CheckCircle2 size={18} />
          {urgent ? '급매 기준 충족' : '일반 매물'}
        </span>
      </div>

      <div className="report-grid">
        <div className="report-stat">
          <span>현재 매도가</span>
          <strong>{formatPrice(property.price)}</strong>
        </div>
        <div className="report-stat">
          <span>기준 실거래가</span>
          <strong>{formatPrice(property.actualTransactionPrice)}</strong>
        </div>
        <div className="report-stat">
          <span>차액</span>
          <strong>{formatPrice(priceGap)}</strong>
        </div>
        <div className="report-stat highlight">
          <span>할인율</span>
          <strong>{discountRate}%</strong>
        </div>
      </div>

      <div className="report-verdict-box">
        <TrendingDown size={22} />
        <p>
          이 매물은 기준 실거래가 대비 {discountRate}% 저렴하여{' '}
          {urgent ? '급매 기준을 충족합니다.' : '급매 기준에는 아직 도달하지 않았습니다.'}
        </p>
        <span>최근 실거래일 {property.recentTransactionDate}</span>
      </div>

      <div className="chart-card">
        <div className="chart-title-row">
          <h3>최근 1년 실거래가 추이</h3>
          <span>단위: 원</span>
        </div>
        {hasChart ? (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 20, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="#e7eaf0" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis
                  width={86}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => formatPrice(value).replace(' 원', '')}
                />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${formatPrice(value)}${item?.payload?.estimated ? ' (추정)' : ''}`,
                    item?.payload?.estimated ? '주변 시세 기반 추정' : '실거래가',
                  ]}
                  labelFormatter={(label) => `${label} 거래`}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#d83324"
                  strokeWidth={3}
                  dot={renderDot}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
            {hasEstimated && (
              <p className="chart-legend">
                <span className="legend-dot real" /> 실거래
                <span className="legend-dot est" /> 주변 시세 기반 추정(거래 없는 달)
              </p>
            )}
          </>
        ) : (
          <p className="chart-empty">이 지역·평형의 실거래가 추이 데이터가 아직 없습니다.</p>
        )}
      </div>
    </section>
  );
}

export default PriceReport;
