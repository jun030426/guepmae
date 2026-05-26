import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

function AgentDashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({ total: 0, recentTitle: null, loading: true });

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setStats({ total: 0, recentTitle: null, loading: false });
      return;
    }
    // 내가 등록한 매물은 properties 테이블에 agent.email 또는 별도 owner_id 필드로 구분해야 함.
    // 지금은 단순히 전체 properties 카운트만 표시 (MVP)
    supabase
      .from('properties')
      .select('id, title, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, count }) => {
        setStats({
          total: count ?? 0,
          recentTitle: data?.[0]?.title ?? null,
          loading: false,
        });
      })
      .catch(() => setStats({ total: 0, recentTitle: null, loading: false }));
  }, []);

  return (
    <div className="page-shell agent-dashboard">
      <section className="container">
        <div className="agent-dashboard-header">
          <div>
            <p className="section-eyebrow">대시보드</p>
            <h1>안녕하세요, {profile?.full_name || '중개사'}님</h1>
            <p className="agent-dashboard-subtitle">매물 등록을 시작해보세요. AI 리포트가 자동으로 생성됩니다.</p>
          </div>
          <Link to="/agent/properties/new" className="primary-link-button agent-dashboard-cta">
            <Plus size={17} />
            새 매물 등록
          </Link>
        </div>

        <div className="agent-stat-grid">
          <article className="agent-stat-card">
            <p className="agent-stat-label">전체 등록 매물</p>
            <strong>{stats.loading ? '...' : `${stats.total}건`}</strong>
            <span>플랫폼 전체 기준</span>
          </article>
          <article className="agent-stat-card">
            <p className="agent-stat-label">최근 등록 매물</p>
            <strong>{stats.loading ? '...' : (stats.recentTitle ?? '아직 없음')}</strong>
            <span>전체 매물 중 최신</span>
          </article>
          <article className="agent-stat-card">
            <p className="agent-stat-label">AI 리포트 생성</p>
            <strong>자동</strong>
            <span>등록과 동시에 생성됩니다</span>
          </article>
        </div>

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
