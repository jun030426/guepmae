import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus, FileText, Building2, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useProperties } from '../hooks/useProperties.js';

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
    title: 'AI 리포트 생성 · 즉시 노출',
    detail: '가격 · 입지 분석 리포트가 자동으로 붙고, 매물은 바로 메인 사이트에 노출됩니다.',
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

  return (
    <div className="page-shell agent-dashboard">
      <section className="container">
        <div className="agent-dashboard-header">
          <div>
            <p className="section-eyebrow">대시보드</p>
            <h1>안녕하세요, {profile?.full_name || '중개사'}님</h1>
            <p className="agent-dashboard-subtitle">
              {isFirstRun
                ? '첫 매물을 등록하면 검증과 AI 리포트가 자동으로 시작됩니다.'
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
              등록과 동시에 실거래가 검증 배지와 AI 리포트가 붙어, 매수자에게 &ldquo;진짜 급매&rdquo;로 전달됩니다.
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

        <section className="agent-dashboard-actions">
          <Link to="/agent/properties/new" className="agent-action-tile primary">
            <div className="agent-action-icon"><Plus size={22} /></div>
            <h3>새 매물 등록</h3>
            <p>단지·가격·매도 사유를 입력하면 AI가 리포트를 자동 생성합니다.</p>
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
