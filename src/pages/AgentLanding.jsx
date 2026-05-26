import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

function AgentLanding() {
  const { isAuthenticated, profile } = useAuth();
  const navigate = useNavigate();

  // 이미 중개사로 로그인되어 있으면 대시보드로 자동 이동
  useEffect(() => {
    if (isAuthenticated && profile?.role && ['agent', 'admin'].includes(profile.role)) {
      navigate('/agent/dashboard', { replace: true });
    }
  }, [isAuthenticated, profile, navigate]);

  return (
    <div className="page-shell agent-landing">
      <section className="container agent-landing-hero">
        <p className="section-eyebrow">중개사 portal</p>
        <h1>매물 등록부터 AI 리포트까지<br />한 번에 처리하세요</h1>
        <p className="agent-landing-subtitle">
          국토부 실거래가 기반의 검증 시스템과 AI 매물 리포트로 매물의 가치를 명확하게 전달합니다.
        </p>

        <div className="agent-landing-actions">
          <Link to="/login" className="primary-link-button">
            중개사 로그인
            <ArrowRight size={17} />
          </Link>
          <Link to="/agent/signup" className="outline-dark-button">
            중개사 가입 신청
          </Link>
        </div>
      </section>

      <section className="container agent-landing-features">
        <div className="agent-feature">
          <div className="agent-feature-icon"><Building2 size={22} /></div>
          <h3>간편한 매물 등록</h3>
          <p>기본 정보 입력 후 제출하면 즉시 메인 사이트에 노출됩니다. 사진/영상은 추후 업로드 가능합니다.</p>
        </div>
        <div className="agent-feature">
          <div className="agent-feature-icon"><Sparkles size={22} /></div>
          <h3>AI 매물 리포트 자동 생성</h3>
          <p>등록한 매물의 가격 분석, 입지, 종합 의견을 AI가 작성해 매수자에게 신뢰감을 전달합니다.</p>
        </div>
        <div className="agent-feature">
          <div className="agent-feature-icon"><ShieldCheck size={22} /></div>
          <h3>실거래가 검증</h3>
          <p>국토부 실거래 데이터와 자동 비교해 매물의 가격 합리성을 객관적으로 보여드립니다.</p>
        </div>
      </section>

      <section className="container agent-landing-cta">
        <h2>중개사 가입 절차</h2>
        <ol>
          <li><strong>가입 신청서 제출</strong> — 사업자등록증, 공인중개사 자격증 첨부</li>
          <li><strong>운영팀 검토</strong> — 영업일 기준 1~2일 내 검토 완료</li>
          <li><strong>승인 안내</strong> — 이메일로 결과 발송, 승인되면 즉시 매물 등록 가능</li>
        </ol>
        <Link to="/agent/signup" className="primary-link-button">
          지금 가입 신청
          <ArrowRight size={17} />
        </Link>
      </section>
    </div>
  );
}

export default AgentLanding;
