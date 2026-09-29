import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus, FileText, Building2, ShieldCheck, Sparkles } from 'lucide-react';
import PricingIntentCard from '../components/PricingIntentCard.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { fetchPropertyStats } from '../services/pilotMetrics.js';
import { conversionRate, totalsOf } from '../utils/pilotMetrics.js';

// 첫 등록 전 안내 — 등록 폼의 실제 순서와 동일해야 함 (AgentRegisterProperty 참조)
const firstRunSteps = [
  {
    Icon: Building2,
    title: '단지 · 가격 · 매도 사유 입력',
    detail: '단지명은 자동완성으로 찾고, 나머지는 기본 정보만 채우면 됩니다. 약 5분이면 충분합니다.',
  },
  {
    Icon: ShieldCheck,
    title: '실거래가 자동 검증',
    detail: '같은 단지 · 같은 전용면적의 국토부 실거래 중앙값과 자동 비교해 할인율을 산출합니다.',
  },
  {
    Icon: Sparkles,
    title: '실거래가 검증 · 승인 후 노출',
    detail: '할인율 산출 근거(표본 수 · 기간 · 실거래 내역)가 자동으로 붙고, 운영팀 검증을 거쳐 메인 사이트에 노출됩니다.',
  },
];

function AgentDashboard() {
  const { profile } = useAuth();
  const { properties, isLoading } = useProperties();

  const myEmail = profile?.email;
  const mine = useMemo(() => {
    const list = properties.filter((p) => myEmail && p.agent?.email === myEmail);
    return [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [properties, myEmail]);

  const verifiedCount = mine.filter((p) => p.verified).length;
  const pendingCount = mine.length - verifiedCount;
  const isFirstRun = !isLoading && mine.length === 0;

  // 최근 30일 매수자 반응 — 내 매물의 조회·문의 (운영진·본인 조회는 빠져 있다)
  const [interest, setInterest] = useState(null);
  useEffect(() => {
    let active = true;
    if (!myEmail) return undefined;
    fetchPropertyStats(30).then((stats) => active && setInterest(totalsOf(stats.listings)));
    return () => { active = false; };
  }, [myEmail]);
  const interestRate = interest ? conversionRate(interest.inquiries, interest.views) : null;

  return (
    <div className="page-shell agent-dashboard">
      <section className="container">
        <div className="agent-dashboard-header">
          <div>
            <p className="section-eyebrow">대시보드</p>
            <h1>안녕하세요, {profile?.full_name || '중개사'}님</h1>
            <p className="agent-dashboard-subtitle">
              {isFirstRun
                ? '첫 매물을 등록하면 실거래가 기준 할인율이 자동 계산되고, 운영팀 검증 후 노출됩니다.'
                : `등록 매물 ${mine.length}건을 관리하고 있습니다.`}
            </p>
          </div>
          <Link to="/agent/properties/new" className="primary-link-button agent-dashboard-cta">
            <Plus size={17} />
            새 매물 등록
          </Link>
        </div>

        {isFirstRun ? (
          <section className="agent-first-run" aria-labelledby="agent-first-run-title">
            <h2 id="agent-first-run-title">첫 매물을 등록해보세요</h2>
            <p className="agent-first-run-lead">
              등록과 동시에 실거래가 기준 할인율과 산출 근거가 붙고, 운영팀 검증을 거쳐 매수자에게 &ldquo;검증된 급매&rdquo;로 전달됩니다.
            </p>
            <ol className="agent-first-run-steps">
              {firstRunSteps.map(({ Icon, title, detail }) => (
                <li key={title} className="agent-first-run-step">
                  <div className="agent-first-run-icon" aria-hidden="true">
                    <Icon size={20} />
                  </div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </li>
              ))}
            </ol>
            <Link to="/agent/properties/new" className="primary-link-button agent-first-run-cta">
              첫 매물 등록 시작 <ArrowRight size={17} />
            </Link>
          </section>
        ) : (
          <div className="agent-stat-grid">
            <article className="agent-stat-card">
              <p className="agent-stat-label">내 등록 매물</p>
              <strong>{isLoading ? '...' : `${mine.length}건`}</strong>
              <span>{myEmail} 계정 기준</span>
            </article>
            <article className="agent-stat-card">
              <p className="agent-stat-label">검증 완료</p>
              <strong>{isLoading ? '...' : `${verifiedCount}건`}</strong>
              <span>{pendingCount > 0 ? `검증 대기 ${pendingCount}건` : '전체 매물 검증 완료'}</span>
            </article>
            <article className="agent-stat-card">
              <p className="agent-stat-label">최근 등록 매물</p>
              <strong>{isLoading ? '...' : (mine[0]?.title ?? '아직 없음')}</strong>
              <span>내 매물 중 최신</span>
            </article>
          </div>
        )}

        {!isFirstRun && (
          <section className="agent-interest" aria-labelledby="agent-interest-title">
            <h2 id="agent-interest-title">최근 30일 매수자 반응</h2>
            <div className="agent-stat-grid">
              <article className="agent-stat-card">
                <p className="agent-stat-label">매물 조회</p>
                <strong>{interest ? `${interest.views.toLocaleString('ko-KR')}회` : '...'}</strong>
                <span>내 매물 상세를 연 횟수</span>
              </article>
              <article className="agent-stat-card">
                <p className="agent-stat-label">문의</p>
                <strong>{interest ? `${interest.inquiries.toLocaleString('ko-KR')}건` : '...'}</strong>
                <span>{interest ? `전화 ${interest.inquiryTel} · 이메일 ${interest.inquiryEmail}` : '전화·이메일 버튼을 누른 횟수'}</span>
              </article>
              <article className="agent-stat-card">
                <p className="agent-stat-label">문의 전환율</p>
                <strong>{interest ? (interestRate == null ? '–' : `${interestRate}%`) : '...'}</strong>
                <span>문의 ÷ 조회</span>
              </article>
            </div>
            <p className="agent-interest-note">
              방문자를 식별하지 않고 센 합계입니다. 같은 사람이 같은 날 다시 본 것, 본인과 운영팀이 본 것은 빠져 있습니다.
            </p>
          </section>
        )}

        {!isFirstRun && !isLoading && <PricingIntentCard listingCount={mine.length} />}

        <section className="agent-dashboard-actions">
          <Link to="/agent/properties/new" className="agent-action-tile primary">
            <div className="agent-action-icon"><Plus size={22} /></div>
            <h3>새 매물 등록</h3>
            <p>단지·면적·가격을 입력하면 실거래가 기준 할인율이 자동 산출됩니다.</p>
            <span className="agent-action-link">시작하기 <ArrowRight size={15} /></span>
          </Link>
          <Link to="/agent/properties" className="agent-action-tile">
            <div className="agent-action-icon"><FileText size={22} /></div>
            <h3>내 등록 매물</h3>
            <p>지금까지 등록한 매물을 확인하고 수정할 수 있습니다.</p>
            <span className="agent-action-link">목록 보기 <ArrowRight size={15} /></span>
          </Link>
        </section>
      </section>
    </div>
  );
}

export default AgentDashboard;
