import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Clock, Sparkles, ShieldCheck, AlertTriangle, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchMyApplication } from '../services/agentApplications.js';

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
  const [myApplication, setMyApplication] = useState(null);
  const [appCheckDone, setAppCheckDone] = useState(false);

  // 이미 agent 로 로그인되어 있으면 대시보드로 자동 이동
  useEffect(() => {
    if (isAuthenticated && profile?.role && ['agent', 'admin', 'owner'].includes(profile.role)) {
      navigate('/agent/dashboard', { replace: true });
    }
  }, [isAuthenticated, profile, navigate]);

  // 로그인된 user 가 신청서 제출했는지 확인
  useEffect(() => {
    if (!isAuthenticated || profile?.role !== 'user' || !profile?.email) {
      setAppCheckDone(true);
      return;
    }
    fetchMyApplication(profile.email)
      .then((app) => setMyApplication(app))
      .finally(() => setAppCheckDone(true));
  }, [isAuthenticated, profile]);

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
        <p className="section-eyebrow">급매 PRO</p>
        <h1>매물 등록부터 AI 리포트까지<br />한 번에 처리하세요</h1>
        <p className="agent-landing-subtitle">
          국토부 실거래가 기반 검증 + AI 매물 리포트 자동 생성. 매물의 가치를 명확하게 전달합니다.
        </p>
      </section>

      {/* 인라인 로그인 — agent portal 안에서 인증 완료 */}
      <section className="container agent-login-section">
        {isNonAgentLoggedIn && myApplication && (myApplication.status === 'pending' || myApplication.status === 'reviewing') ? (
          <div className="agent-login-card application-pending">
            <Clock size={28} />
            <h2>승인 대기 중</h2>
            <p>
              <strong>{myApplication.office_name}</strong> 중개사 신청이 접수되었습니다.
            </p>
            <p className="application-pending-detail">
              영업일 기준 <strong>1~2일 내</strong> 검토 후 결과를 이메일로 안내드립니다.
              승인되면 즉시 급매 PRO 이용이 가능해집니다.
            </p>
            <div className="application-status-row">
              <span className="application-status-badge pending">{myApplication.status === 'reviewing' ? '검토 중' : '대기 중'}</span>
              <span className="application-status-date">신청일: {new Date(myApplication.created_at).toLocaleDateString('ko-KR')}</span>
            </div>
          </div>
        ) : isNonAgentLoggedIn && myApplication?.status === 'rejected' ? (
          <div className="agent-login-card application-rejected">
            <XCircle size={28} />
            <h2>신청이 거부되었습니다</h2>
            <p>
              <strong>{myApplication.office_name}</strong> 신청이 거부되었습니다.
            </p>
            {myApplication.reviewer_note && (
              <p className="application-pending-detail">
                <strong>사유:</strong> {myApplication.reviewer_note}
              </p>
            )}
            <Link to="/agent/signup" className="primary-link-button">
              다시 신청하기 <ArrowRight size={17} />
            </Link>
          </div>
        ) : isNonAgentLoggedIn ? (
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
