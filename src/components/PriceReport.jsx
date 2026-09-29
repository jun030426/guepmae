import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, CheckCircle2, TrendingDown } from 'lucide-react';
import { basisConditions, isHeld } from '../utils/priceBasis.js';
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
  const basis = property.priceBasis;
  // 판정 보류 — 기준가가 없으므로 할인율·차액을 만들지 않는다
  const held = property.discountRate == null || isHeld(basis);
  const discountRate = calculateDiscountRate(property.price, property.actualTransactionPrice);
  const priceGap = calculatePriceGap(property.price, property.actualTransactionPrice);
  const urgent = !held && isUrgentSale(property.price, property.actualTransactionPrice);
  const conditions = basisConditions(basis);

  // 실거래만 (재생산/추정 없음)
  const chartData = Array.isArray(property.priceHistory) ? property.priceHistory : [];
  const hasChart = chartData.length >= 2;

  // ⑤ 산출 근거 — 검증의 핵심 증거를 판정문 바로 옆에 노출. priceBasis 없으면 안전 폴백.
  const basisLabel = held
    ? basis?.method || '기준 실거래가 미산출 — 판정 보류'
    : basis?.method
      ? `${basis.method} · 국토부 실거래${basis.confidence === 'low' || basis.confidence === 'medium' ? ' (표본 적음)' : ''}`
      : '동일 단지 · 유사 면적 최근 실거래가 기준';

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
        <span className={held ? 'verdict held' : urgent ? 'verdict positive' : 'verdict'}>
          {held ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {held ? '판정 보류' : urgent ? '급매 기준 충족' : '일반 매물'}
        </span>
      </div>

      <div className="report-grid">
        <div className="report-stat">
          <span>현재 매도가</span>
          <strong>{formatPrice(property.price)}</strong>
        </div>
        <div className="report-stat">
          <span>기준 실거래가</span>
          <strong>{held ? '—' : formatPrice(property.actualTransactionPrice)}</strong>
        </div>
        <div className="report-stat">
          <span>차액</span>
          <strong>{held ? '—' : formatPrice(priceGap)}</strong>
        </div>
        <div className="report-stat highlight">
          <span>할인율</span>
          <strong>{held ? '판정 보류' : `${discountRate}%`}</strong>
        </div>
      </div>

      <div className="report-verdict-box">
        <TrendingDown size={22} />
        {held ? (
          <p>
            표본이 부족하거나 단지 실거래 데이터가 없어 <strong>판정을 보류</strong>했습니다. 기준가를 추정해 만들지 않습니다.
          </p>
        ) : (
          <p>
            이 매물은 기준 실거래가 대비 {discountRate}% 저렴하여{' '}
            {urgent ? '급매 기준을 충족합니다.' : '급매 기준에는 아직 도달하지 않았습니다.'}
          </p>
        )}
        {!held && <span>최근 실거래일 {property.recentTransactionDate}</span>}
        <span className="verdict-basis">산출 근거: {basisLabel}</span>
        {conditions.length > 0 && (
          <ul className="basis-conditions" aria-label="산출 조건">
            {conditions.map((condition) => (
              <li key={condition.label}>
                <span>{condition.label}</span>
                <strong>
                  {condition.value}
                  {condition.price != null ? ` ${formatPrice(condition.price)}` : ''}
                </strong>
              </li>
            ))}
          </ul>
        )}
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
                          <td>
                            {formatPrice(r.price)}
                            {r.dealing === 'd' && <span className="trade-dealing-tag">직거래 · 기준가 제외</span>}
                          </td>
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
