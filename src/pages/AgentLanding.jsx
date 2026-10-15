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
  const { isAuthenticated, profile, signIn, refreshProfile, isConfigured } = useAuth();
  const navigate = useNavigate();
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [myApplication, setMyApplication] = useState(null);
  const [appCheckDone, setAppCheckDone] = useState(false);
  const [appError, setAppError] = useState('');

  // 이미 agent 로 로그인되어 있으면 대시보드로 자동 이동
  useEffect(() => {
    if (isAuthenticated && profile?.role && ['agent', 'admin', 'owner'].includes(profile.role)) {
      navigate('/agent/dashboard', { replace: true });
    }
  }, [isAuthenticated, profile, navigate]);

  // 로그인된 user 가 신청서 제출했는지 확인
  useEffect(() => {
    let active = true;
    if (!isAuthenticated || profile?.role !== 'user' || !profile?.email) {
      setAppCheckDone(true);
      return;
    }
    setAppCheckDone(false);
    setAppError('');
    fetchMyApplication(profile.email)
      .then((app) => { if (active) setMyApplication(app); })
      .catch(() => { if (active) setAppError('신청 상태를 불러오지 못했습니다. 다시 확인해주세요.'); })
      .finally(() => { if (active) setAppCheckDone(true); });
    return () => { active = false; };
  }, [isAuthenticated, profile?.id, profile?.role, profile?.email]);

  const refreshApplication = async () => {
    setAppCheckDone(false);
    setAppError('');
    try {
      const account = await refreshProfile();
      if (['agent','admin','owner'].includes(account?.role)) {
        navigate('/agent/dashboard', { replace: true });
      } else {
        setMyApplication(await fetchMyApplication(profile?.email));
      }
    } catch {
      setAppError('신청 상태를 불러오지 못했습니다. 다시 확인해주세요.');
    } finally { setAppCheckDone(true); }
  };

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
      if (!['agent', 'admin', 'owner'].includes(result.profile?.role)) {
        setError('');
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
    isAuthenticated && profile?.role && !['agent', 'admin', 'owner'].includes(profile.role);

  return (
    <div className="page-shell agent-landing">
      <section className="container agent-landing-hero">
        <p className="section-eyebrow">급매 PRO</p>
        <h1>매물 등록부터 실거래가 검증까지<br />한 번에 처리하세요</h1>
        <p className="agent-landing-subtitle">
          실거래가 기준 가격 검증과 사진·360 투어로 매물 정보를 전달하세요.
        </p>
      </section>

      {/* 인라인 로그인 — agent portal 안에서 인증 완료 */}
      <section className="container agent-login-section">
        {isNonAgentLoggedIn && (!appCheckDone || appError) ? (
          <div className="agent-login-card">
            {appError ? <><p role="alert">{appError}</p><button type="button" onClick={refreshApplication}>다시 확인</button></> : <p role="status">신청 상태를 확인하고 있습니다.</p>}
          </div>
        ) : isNonAgentLoggedIn && myApplication?.status === 'approved' ? (
          <div className="agent-login-card">
            <h2>중개사 신청이 승인되었습니다</h2>
            <button type="button" className="primary-link-button" onClick={refreshApplication}>승인 확인하고 등록 시작</button>
          </div>
        ) : isNonAgentLoggedIn && myApplication && (myApplication.status === 'pending' || myApplication.status === 'reviewing') ? (
          <div className="agent-login-card application-pending">
            <Clock size={28} />
            <h2>승인 대기 중</h2>
            <p>
              <strong>{myApplication.office_name}</strong> 중개사 신청이 접수되었습니다.
            </p>
            <p className="application-pending-detail">
              운영팀이 제출한 정보와 서류를 검토합니다. 신청 접수만으로 중개사 자격 확인이나 이용 승인이 완료되지는 않습니다.
              검토 상태는 이 화면에서 확인할 수 있으며, 중개사 권한이 부여되면 매물 등록을 시작할 수 있습니다.
            </p>
            <div className="application-status-row">
              <span className="application-status-badge pending">{myApplication.status === 'reviewing' ? '검토 중' : '대기 중'}</span>
              <span className="application-status-date">신청일: {new Date(myApplication.created_at).toLocaleDateString('ko-KR')}</span>
            </div>
            <button type="button" className="primary-link-button" onClick={refreshApplication}>승인 상태 새로고침</button>
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
          <p>기본 정보 입력 후 제출하면 할인율이 자동 계산되고, 운영팀 검증 후 메인 사이트에 노출됩니다.</p>
        </div>
        <div className="agent-feature">
          <div className="agent-feature-icon"><Sparkles size={22} /></div>
          <h3>산출 근거 투명 공개</h3>
          <p>할인율뿐 아니라 비교에 쓴 실거래 내역(계약일·층·가격·표본 수·기간)을 매수자에게 그대로 공개해 신뢰를 전달합니다.</p>
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
