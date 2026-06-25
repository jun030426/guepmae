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
import { PRIMARY, BORDER } from '../styles/tokens.js';

const fmtArea = (a) => `${a}㎡`;
const fmtYm = (ym) => (ym ? ym.replace('-', '.') : '');
const fmtDate = (ym, day) => `${fmtYm(ym)}${day ? '.' + String(day).padStart(2, '0') : ''}`;
const eok = (won) => {
  if (!won && won !== 0) return '-';
  const v = won / 1e8;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}억`;
};

function PriceReport({ property }) {
  const discountRate = calculateDiscountRate(property.price, property.actualTransactionPrice);
  const priceGap = calculatePriceGap(property.price, property.actualTransactionPrice);
  const urgent = isUrgentSale(property.price, property.actualTransactionPrice);

  // 실거래만 (재생산/추정 없음)
  const chartData = Array.isArray(property.priceHistory) ? property.priceHistory : [];
  const hasChart = chartData.length >= 2;

  const table = property.priceTable || {};
  const areaSummary = Array.isArray(table.areaSummary) ? table.areaSummary : [];
  const recentTrades = Array.isArray(table.recentTrades) ? table.recentTrades : [];
  const hasTable = areaSummary.length > 0 || recentTrades.length > 0;

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
          <h3>{table.complexName || '동일 단지'} 실거래가 (최근 3년)</h3>
          <span>국토부 실거래 · 추정 없음</span>
        </div>

        {hasChart && (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid stroke={BORDER} vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} interval="preserveStartEnd" fontSize={12} />
              <YAxis
                width={64}
                tickLine={false}
                axisLine={false}
                fontSize={12}
                tickFormatter={(value) => eok(value)}
              />
              <Tooltip
                formatter={(value, _n, item) => [
                  `${formatPrice(value)}${item?.payload?.count ? ` (${item.payload.count}건)` : ''}`,
                  '실거래 중앙값',
                ]}
                labelFormatter={(label) => `${label} 거래`}
              />
              <Line type="monotone" dataKey="price" stroke={PRIMARY} strokeWidth={2.5} dot={{ r: 3, fill: PRIMARY }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {hasTable ? (
          <>
            {areaSummary.length > 0 && (
              <div className="trade-block">
                <h4>평형별 실거래 요약 <span className="trade-note">최근 3년 · 실거래만</span></h4>
                <table className="trade-table">
                  <thead>
                    <tr>
                      <th>전용면적</th>
                      <th>거래</th>
                      <th>최근 거래가</th>
                      <th>3년 최저~최고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {areaSummary.map((r) => (
                      <tr key={r.areaM2} className={r.isMine ? 'mine' : ''}>
                        <td>
                          {fmtArea(r.areaM2)}
                          {r.isMine && <span className="mine-tag">내 매물</span>}
                        </td>
                        <td>{r.count}건</td>
                        <td>
                          {eok(r.recentPrice)} <span className="muted">{fmtYm(r.recentMonth)}</span>
                        </td>
                        <td className="muted">{eok(r.minPrice)} ~ {eok(r.maxPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {recentTrades.length > 0 && (
              <div className="trade-block">
                <h4>최근 실거래 내역 <span className="trade-note">전용 {table.myAreaM2}㎡</span></h4>
                <div className="trade-scroll">
                  <table className="trade-table">
                    <thead>
                      <tr>
                        <th>계약</th>
                        <th>전용</th>
                        <th>층</th>
                        <th>거래가</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTrades.map((r, i) => (
                        <tr key={`${r.yearMonth}-${r.day}-${i}`}>
                          <td>{fmtDate(r.yearMonth, r.day)}</td>
                          <td>{fmtArea(r.areaM2)}</td>
                          <td>{r.floor ? `${r.floor}층` : '-'}</td>
                          <td>{formatPrice(r.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          !hasChart && <p className="chart-empty">동일 단지의 최근 실거래 내역이 아직 없습니다.</p>
        )}
      </div>
    </section>
  );
}

export default PriceReport;
