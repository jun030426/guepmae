import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Sparkles, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const initialLoginForm = { email: '', password: '' };

function friendlyAuthError(error) {
  const msg = error?.message ?? '';
  if (msg.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (msg.includes('Email not confirmed')) return '이메일 인증 후 로그인할 수 있습니다.';
  return msg || '로그인을 처리하지 못했습니다.';
}

function AgentLanding() {
  const { isAuthenticated, profile, signIn, isConfigured } = useAuth();
  const navigate = useNavigate();
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 이미 agent 로 로그인되어 있으면 대시보드로 자동 이동
  useEffect(() => {
    if (isAuthenticated && profile?.role && ['agent', 'admin'].includes(profile.role)) {
      navigate('/agent/dashboard', { replace: true });
    }
  }, [isAuthenticated, profile, navigate]);

  const updateForm = (event) => {
    const { name, value } = event.target;
    setLoginForm((current) => ({ ...current, [name]: value }));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await signIn(loginForm);
      // 로그인 후 role 검증 — agent/admin 아니면 안내
      if (!['agent', 'admin'].includes(result.profile?.role)) {
        setError('중개사 권한이 없는 계정입니다. 우측 "가입 신청" 으로 신청해주세요.');
        return;
      }
      navigate('/agent/dashboard', { replace: true });
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  // 일반 사용자(role=user)로 로그인된 상태 — 권한 안내
  const isNonAgentLoggedIn =
    isAuthenticated && profile?.role && !['agent', 'admin'].includes(profile.role);

  return (
    <div className="page-shell agent-landing">
      <section className="container agent-landing-hero">
        <p className="section-eyebrow">중개사 portal</p>
        <h1>매물 등록부터 AI 리포트까지<br />한 번에 처리하세요</h1>
        <p className="agent-landing-subtitle">
          국토부 실거래가 기반 검증 + AI 매물 리포트 자동 생성. 매물의 가치를 명확하게 전달합니다.
        </p>
      </section>

      {/* 인라인 로그인 — agent portal 안에서 인증 완료 */}
      <section className="container agent-login-section">
        {isNonAgentLoggedIn ? (
          <div className="agent-login-card non-agent">
            <AlertTriangle size={28} />
            <h2>중개사 권한이 없습니다</h2>
            <p>
              <strong>{profile?.email}</strong> 계정은 아직 중개사로 승인되지 않았습니다.
              아래에서 가입 신청을 진행해주세요.
            </p>
            <Link to="/agent/signup" className="primary-link-button">
              중개사 가입 신청 <ArrowRight size={17} />
            </Link>
          </div>
        ) : (
          <div className="agent-login-card">
            <h2>중개사 로그인</h2>
            <p className="agent-login-subtitle">승인된 중개사 계정으로 로그인해주세요</p>

            {!isConfigured && (
              <p className="form-status error">Supabase 환경변수가 없어 인증 기능을 사용할 수 없습니다.</p>
            )}

            <form className="agent-login-form" onSubmit={handleLogin}>
              <label>
                이메일
                <input
                  type="email"
                  name="email"
                  value={loginForm.email}
                  onChange={updateForm}
                  autoComplete="email"
                  placeholder="중개사 가입 이메일"
                  required
                />
              </label>
              <label>
                비밀번호
                <input
                  type="password"
                  name="password"
                  value={loginForm.password}
                  onChange={updateForm}
                  autoComplete="current-password"
                  placeholder="비밀번호"
                  required
                />
              </label>
              {error && <p className="form-status error">{error}</p>}
              <button
                type="submit"
                className="primary-link-button agent-login-submit"
                disabled={submitting || !isConfigured}
              >
                {submitting ? '확인 중...' : '로그인'}
                {!submitting && <ArrowRight size={17} />}
              </button>
            </form>

            <div className="agent-login-divider"><span>또는</span></div>

            <Link to="/agent/signup" className="agent-signup-cta">
              처음이세요? <strong>중개사 가입 신청</strong>
            </Link>
          </div>
        )}
      </section>

      <section className="container agent-landing-features">
        <div className="agent-feature">
          <div className="agent-feature-icon"><Building2 size={22} /></div>
          <h3>간편한 매물 등록</h3>
          <p>기본 정보 입력 후 제출하면 즉시 메인 사이트에 노출됩니다.</p>
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
    </div>
  );
}

export default AgentLanding;
