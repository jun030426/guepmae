import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink } from 'lucide-react';
import { fetchAlertRows } from '../services/complexAlerts.js';
import { fetchPricingIntents, fetchPropertyStats } from '../services/pilotMetrics.js';
import { PERIODS, buildPilotSummary, kstDay, priceBandLabel, toCsv, willingLabel } from '../utils/pilotMetrics.js';

/*
 * PilotMetricsPanel — 관리자 화면의 파일럿 지표.
 * 사업계획서 4단계의 확인 지표 네 가지(등록 매물 · 알림 신청 · 문의 전환 · 유료 의향)를 한 자리에서 본다.
 */

const LISTING_LIMIT = 50; // 표에는 상위만, CSV 에는 전부

const count = (n, unit) => `${Number(n ?? 0).toLocaleString('ko-KR')}${unit}`;
const percent = (value) => (value == null ? '–' : `${value}%`);
const intentText = (intent) => (intent
  ? `${willingLabel(intent.willing)}${intent.price_band ? ` · ${priceBandLabel(intent.price_band)}` : ''}`
  : '');

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const AGENT_COLUMNS = [
  { label: '중개사', value: (a) => a.office || a.name },
  { label: '계정', value: (a) => a.email },
  { label: '등록 매물', value: (a) => a.listings },
  { label: '기간 내 신규', value: (a) => a.added },
  { label: '조회', value: (a) => a.views },
  { label: '전화 문의', value: (a) => a.inquiryTel },
  { label: '이메일 문의', value: (a) => a.inquiryEmail },
  { label: '문의 전환율(%)', value: (a) => a.conversion },
  { label: '유료 의향', value: (a) => willingLabel(a.intent?.willing) },
  { label: '월 요금', value: (a) => priceBandLabel(a.intent?.price_band) },
  { label: '의견', value: (a) => a.intent?.comment ?? '' },
];

const LISTING_COLUMNS = [
  { label: '매물', value: (l) => l.title },
  { label: '매물 id', value: (l) => l.id },
  { label: '지역', value: (l) => l.region },
  { label: '중개사', value: (l) => l.agentName },
  { label: '계정', value: (l) => l.agentEmail },
  { label: '등록일', value: (l) => (l.createdAt ? kstDay(l.createdAt) : '') },
  { label: '조회', value: (l) => l.views },
  { label: '전화 문의', value: (l) => l.inquiryTel },
  { label: '이메일 문의', value: (l) => l.inquiryEmail },
  { label: '문의 전환율(%)', value: (l) => l.conversion },
];

export default function PilotMetricsPanel({ properties }) {
  const [periodKey, setPeriodKey] = useState('30');
  const [stats, setStats] = useState(null);
  const [intents, setIntents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const period = PERIODS.find((item) => item.key === periodKey) ?? PERIODS[1];

  useEffect(() => {
    let active = true;
    setStats(null);
    fetchPropertyStats(period.days).then((result) => active && setStats(result));
    return () => { active = false; };
  }, [period.days]);

  useEffect(() => {
    let active = true;
    fetchPricingIntents().then((rows) => active && setIntents(rows));
    fetchAlertRows().then((rows) => active && setAlerts(rows));
    return () => { active = false; };
  }, []);

  const summary = useMemo(
    () => buildPilotSummary({ properties, stats: stats ?? {}, intents, alerts, from: stats?.from ?? null, to: stats?.to ?? null }),
    [properties, stats, intents, alerts],
  );

  const stamp = kstDay().replaceAll('-', '');
  const { listings, traffic } = summary;
  const loading = stats == null;
  const bounded = period.days != null; // "전체"에서는 기간 내 신규가 곧 전체라 따로 적지 않는다

  return (
    <section className="container admin-grid">
      <div className="admin-panel wide pilot-panel">
        <div className="admin-panel-header">
          <h2>파일럿 지표</h2>
          <span>등록 매물 · 알림 신청 · 문의 전환 · 유료 의향</span>
        </div>

        <div className="pilot-period" role="group" aria-label="기간">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === periodKey ? 'is-active' : ''}
              aria-pressed={item.key === periodKey}
              onClick={() => setPeriodKey(item.key)}
            >
              {item.label}
            </button>
          ))}
          {stats?.from && <span className="pilot-period-range">{stats.from} ~ {stats.to}</span>}
        </div>

        <div className="pilot-metric-grid">
          <article className="pilot-metric">
            <span>중개사 등록 매물</span>
            <strong>{count(listings.total, '건')}</strong>
            <p>
              {bounded && `기간 내 신규 ${count(listings.added, '건')} · `}
              중개사 {count(listings.agents, '곳')} · 검증 완료 {count(listings.verified, '건')}
            </p>
          </article>
          <article className="pilot-metric">
            <span>급매 알림 신청</span>
            <strong>{count(summary.alerts.active, '건')}</strong>
            <p>{bounded ? `기간 내 신규 ${count(summary.alerts.added, '건')}` : '활성 신청 수'}</p>
          </article>
          <article className="pilot-metric">
            <span>문의 전환율</span>
            <strong>{loading ? '…' : percent(traffic.conversion)}</strong>
            <p>
              문의 {count(traffic.inquiries, '건')} ÷ 조회 {count(traffic.agentViews, '회')} (중개사 등록 매물)
              {traffic.collectedViews > 0 && ` · 수집 매물 조회 ${count(traffic.collectedViews, '회')}`}
            </p>
          </article>
          <article className="pilot-metric">
            <span>유료 의향 설문</span>
            <strong>{summary.intents.total > 0 ? `응답 ${count(summary.intents.total, '명')}` : '응답 없음'}</strong>
            <p>
              {summary.intents.total > 0
                ? `계속 쓰겠다 ${summary.intents.yes}명 · 가격에 따라 ${summary.intents.depends}명 · 아니요 ${summary.intents.no}명`
                : '매물을 등록한 중개사의 대시보드에 설문이 보입니다'}
            </p>
          </article>
        </div>

        <p className="pilot-note">
          조회와 문의는 방문자를 식별하지 않고 센 일별 합계입니다. 같은 브라우저의 같은 날 중복, 운영진과 담당 중개사 본인의 조회는 빠져 있습니다.
          문의는 전화·이메일 버튼을 누른 횟수이며 실제로 통화했는지는 알 수 없습니다.
        </p>

        <div className="pilot-table-header">
          <h3>중개사별 ({summary.byAgent.length})</h3>
          <button
            type="button"
            className="pilot-download"
            disabled={summary.byAgent.length === 0}
            onClick={() => download(`geupmae-pilot-agents-${stamp}.csv`, toCsv(AGENT_COLUMNS, summary.byAgent))}
          >
            <Download size={14} /> CSV
          </button>
        </div>
        {summary.byAgent.length === 0 ? (
          <p className="admin-empty">아직 매물을 등록한 중개사가 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>중개사</th>
                  <th>등록 매물</th>
                  <th>조회</th>
                  <th>문의</th>
                  <th>전환율</th>
                  <th>유료 의향</th>
                </tr>
              </thead>
              <tbody>
                {summary.byAgent.map((agent) => (
                  <tr key={agent.email}>
                    <td>
                      <strong>{agent.office || agent.name || '-'}</strong>
                      <span className="pilot-sub">{agent.email}</span>
                    </td>
                    <td>
                      {count(agent.listings, '건')}
                      {bounded && agent.added > 0 && <span className="pilot-sub">신규 {agent.added}</span>}
                    </td>
                    <td>{count(agent.views, '회')}</td>
                    <td>
                      {count(agent.inquiries, '건')}
                      {agent.inquiries > 0 && <span className="pilot-sub">전화 {agent.inquiryTel} · 이메일 {agent.inquiryEmail}</span>}
                    </td>
                    <td>{percent(agent.conversion)}</td>
                    <td>
                      {agent.intent ? intentText(agent.intent) : <span className="pilot-sub">미응답</span>}
                      {agent.intent?.comment && <span className="pilot-sub">{agent.intent.comment}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pilot-table-header">
          <h3>매물별 ({summary.byListing.length})</h3>
          <button
            type="button"
            className="pilot-download"
            disabled={summary.byListing.length === 0}
            onClick={() => download(`geupmae-pilot-listings-${stamp}.csv`, toCsv(LISTING_COLUMNS, summary.byListing))}
          >
            <Download size={14} /> CSV
          </button>
        </div>
        {loading ? (
          <p className="admin-empty">불러오는 중...</p>
        ) : summary.byListing.length === 0 ? (
          <p className="admin-empty">이 기간에 집계된 조회가 없습니다.</p>
        ) : (
          <>
            <div className="table-wrap admin-scroll-table">
              <table>
                <thead>
                  <tr>
                    <th>매물</th>
                    <th>지역</th>
                    <th>중개사</th>
                    <th>조회</th>
                    <th>문의</th>
                    <th>전환율</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byListing.slice(0, LISTING_LIMIT).map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.exists ? (
                          <Link to={`/properties/${item.id}`} className="admin-link" target="_blank" rel="noreferrer">
                            {item.title}
                            <ExternalLink size={12} />
                          </Link>
                        ) : (
                          <span className="pilot-sub">{item.title}</span>
                        )}
                      </td>
                      <td>{item.region || '-'}</td>
                      <td>{item.agentEmail ? (item.agentName || item.agentEmail) : <span className="pilot-sub">수집 매물</span>}</td>
                      <td>{count(item.views, '회')}</td>
                      <td>
                        {item.agentEmail ? count(item.inquiries, '건') : <span className="pilot-sub">연락처 없음</span>}
                      </td>
                      <td>{percent(item.conversion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.byListing.length > LISTING_LIMIT && (
              <p className="pilot-note">문의·조회가 많은 순으로 {LISTING_LIMIT}건만 보입니다. 전체는 CSV 로 받을 수 있습니다.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
