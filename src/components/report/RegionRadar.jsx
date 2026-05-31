/*
 * RegionRadar — /report '급매 레이더' 4탭 차트.
 *
 * 17개 시도를 4가지 관점으로 보기:
 *   - 거래량        (단순 큰 순)
 *   - 급매비율      (또래 시세보다 싸게 거래된 비율 — 매수 신호)
 *   - 평균할인      (대형 outlier 영향 있음, 부호 색 분기)
 *   - 중앙값할인    (일반 매물 기준, 부호 색 분기)
 *
 * 색 매핑은 지역 시세 차트·분류 카드와 일관:
 *   음수(프리미엄) = 테라코타, 양수(할인) = 차콜.
 * 거래량·급매비율은 부호 분기 없이 단색(차콜·테라코타).
 *
 * 막대 클릭 → /properties?region= navigate (지역 차트와 동일 패턴).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Info } from 'lucide-react';
import { BORDER, PRIMARY, TEXT_MUTED, TEXT_STRONG_SOFT } from '../../styles/tokens.js';
import { formatRegionName } from '../../utils/regionName.js';

const formatVolumeTick = (v) => {
  if (v == null) return '';
  if (v >= 10000) return `${Math.round(v / 10000)}만`;
  return v.toLocaleString();
};
const formatPctTick = (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;

function makeTabConfig() {
  return {
    volume: {
      label: '거래량',
      dataKey: 'transactionVolume',
      sortBy: 'transactionVolume',
      subtitle: '1년 누적 · 거래 활발도',
      unit: '건',
      formatTick: formatVolumeTick,
      formatValue: (v) => `${v?.toLocaleString() ?? '?'}건`,
      colorFor: () => TEXT_STRONG_SOFT,
      topNote: (top) =>
        `${formatRegionName(top.region)}이 거래 최다 — ${top.transactionVolume?.toLocaleString()}건`,
    },
    urgent: {
      label: '급매비율',
      dataKey: 'urgentPct',
      sortBy: 'urgentRatio',
      subtitle: '또래 시세보다 싸게 거래된 비율 — 높을수록 매수자 발굴 여지',
      unit: '%',
      formatTick: (v) => `${Math.round(v)}%`,
      formatValue: (v) => `${v?.toFixed(1) ?? '?'}%`,
      colorFor: () => PRIMARY,
      topNote: (top) =>
        `${formatRegionName(top.region)}이 급매비율 최고 — ${Math.round(
          (top.urgentRatio ?? 0) * 100,
        )}% (5건 중 ${Math.round(5 * (top.urgentRatio ?? 0))}건이 급매)`,
    },
    avgDiscount: {
      label: '평균할인',
      dataKey: 'averageDiscount',
      sortBy: 'averageDiscount',
      subtitle: '1년 평균 · 음수=프리미엄 · 평균은 대형 outlier 영향 큼',
      unit: '%',
      formatTick: formatPctTick,
      formatValue: (v) => `${v >= 0 ? '+' : ''}${v}%`,
      colorFor: (r) => (r.averageDiscount < 0 ? PRIMARY : TEXT_STRONG_SOFT),
      topNote: (top) =>
        top.averageDiscount > 0
          ? `${formatRegionName(top.region)}이 할인 우세 1위 — +${top.averageDiscount}% (급매 발굴 여지)`
          : `${formatRegionName(top.region)} 평균 ${top.averageDiscount}% — 가장 약한 프리미엄`,
    },
    medianDiscount: {
      label: '중앙값할인',
      dataKey: 'medianDiscount',
      sortBy: 'medianDiscount',
      subtitle: '1년 중앙값 · 일반 매물 기준 (outlier 제외)',
      unit: '%',
      formatTick: formatPctTick,
      formatValue: (v) => `${v >= 0 ? '+' : ''}${v}%`,
      colorFor: (r) => ((r.medianDiscount ?? 0) < 0 ? PRIMARY : TEXT_STRONG_SOFT),
      topNote: (top) =>
        (top.medianDiscount ?? 0) > 0
          ? `${formatRegionName(top.region)} 중앙값 +${top.medianDiscount}% — 일반 매물도 할인 우세`
          : `${formatRegionName(top.region)} 중앙값 ${top.medianDiscount ?? 0}% — 일반 매물은 거의 시세대로 (평균 ${top.averageDiscount}%는 outlier)`,
    },
  };
}

function RegionRadar({ rows }) {
  const [tab, setTab] = useState('volume');
  const navigate = useNavigate();

  const TABS = useMemo(() => makeTabConfig(), []);
  const active = TABS[tab];

  // 데이터 정렬·파생값(urgentPct) 한 번에
  const sorted = useMemo(() => {
    if (!rows?.length) return [];
    return [...rows]
      .map((r) => ({ ...r, urgentPct: (r.urgentRatio ?? 0) * 100 }))
      .sort((a, b) => (b[active.sortBy] ?? 0) - (a[active.sortBy] ?? 0));
  }, [rows, active.sortBy]);

  if (!sorted.length) return null;

  const top = sorted[0];

  const goToRegion = (region) => {
    if (!region) return;
    navigate(`/properties?region=${encodeURIComponent(region)}`);
  };

  return (
    <div className="chart-card chart-card-clickable">
      <div className="chart-title-row">
        <div className="chart-title-stack">
          <h3>급매 레이더</h3>
          <p className="chart-subtitle">{active.subtitle}</p>
        </div>
        <span>단위 {active.unit}</span>
      </div>

      <div className="radar-tabs">
        {Object.entries(TABS).map(([key, cfg]) => (
          <button
            key={key}
            type="button"
            className={`radar-tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {cfg.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={420}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 12, right: 16, left: 12, bottom: 0 }}
        >
          <CartesianGrid stroke={BORDER} horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            stroke={TEXT_MUTED}
            tickFormatter={active.formatTick}
          />
          <YAxis
            type="category"
            dataKey="region"
            tickLine={false}
            axisLine={false}
            stroke={TEXT_MUTED}
            width={108}
            tickFormatter={formatRegionName}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,15,15,0.04)' }}
            formatter={(value) => [active.formatValue(value), active.label]}
            labelFormatter={(label) => formatRegionName(label)}
          />
          <Bar dataKey={active.dataKey} radius={[0, 2, 2, 0]}>
            {sorted.map((entry) => (
              <Cell
                key={entry.region}
                fill={active.colorFor(entry)}
                onClick={() => goToRegion(entry.region)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="chart-note">
        <p className="chart-note-help">
          <Info size={13} aria-hidden="true" />
          막대 클릭 → 해당 지역 매물 목록
        </p>
        <ul className="chart-note-list">
          <li>{active.topNote(top)}</li>
        </ul>
      </div>
    </div>
  );
}

export default RegionRadar;
