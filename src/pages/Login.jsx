import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Mail, MailCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import SocialLoginButtons from '../components/SocialLoginButtons.jsx';

const initialLoginForm = {
  email: '',
  password: '',
};

const initialSignupForm = {
  email: '',
  password: '',
  passwordConfirm: '',
  fullName: '',
  phone: '',
  favoriteRegion: '',
};

function getFriendlyAuthError(error) {
  const message = error?.message ?? '';

  if (message.includes('Invalid login credentials')) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  }

  if (message.includes('Email not confirmed')) {
    return '이메일 인증 후 로그인할 수 있습니다.';
  }

  if (message.includes('User already registered')) {
    return '이미 가입된 이메일입니다. 로그인으로 진행해주세요.';
  }

  if (message.includes('Password should be')) {
    return '비밀번호는 최소 6자 이상으로 입력해주세요.';
  }

  return message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
}

function Login() {
  const [searchParams, setSearchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const verifiedParam = searchParams.get('verified');
  const [mode, setMode] = useState(modeParam === 'signup' ? 'signup' : 'start');
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [signupForm, setSignupForm] = useState(initialSignupForm);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(null);
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isConfigured, signIn, signUp, resendVerification, getRedirectPath, profile } = useAuth();

  const fromPath = location.state?.from?.pathname;
  const canSubmitSignup = useMemo(
    () =>
      signupForm.email &&
      signupForm.password.length >= 6 &&
      signupForm.password === signupForm.passwordConfirm &&
      signupForm.fullName &&
      signupForm.phone,
    [signupForm],
  );

  useEffect(() => {
    setMode(modeParam === 'signup' ? 'signup' : 'start');
    setShowEmailLogin(false);
    setError('');
    setStatus('');
  }, [modeParam]);

  // 이메일 인증 링크 클릭 후 돌아왔을 때: 성공 메시지 노출 + 로그인 폼 자동 펼치기
  useEffect(() => {
    if (verifiedParam === 'true') {
      setStatus('이메일 인증이 완료되었습니다. 로그인해주세요.');
      setShowEmailLogin(true);
      setPendingVerificationEmail(null);
      // 쿼리 파라미터 제거 — 새로고침해도 메시지 안 다시 뜨도록
      const next = new URLSearchParams(searchParams);
      next.delete('verified');
      setSearchParams(next, { replace: true });
    }
  }, [verifiedParam, searchParams, setSearchParams]);

  useEffect(() => {
    if (isAuthenticated && profile) {
      navigate(fromPath || getRedirectPath(profile), { replace: true });
    }
  }, [fromPath, getRedirectPath, isAuthenticated, navigate, profile]);

  const switchToSignup = () => {
    setSearchParams({ mode: 'signup' });
  };

  const switchToStart = () => {
    setSearchParams({});
  };

  const updateLoginForm = (event) => {
    const { name, value } = event.target;
    setLoginForm((current) => ({ ...current, [name]: value }));
  };

  const updateSignupForm = (event) => {
    const { name, value } = event.target;
    setSignupForm((current) => ({ ...current, [name]: value }));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');
    setIsSubmitting(true);

    try {
      const result = await signIn(loginForm);
      navigate(fromPath || result.redirectPath, { replace: true });
    } catch (authError) {
      setError(getFriendlyAuthError(authError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');

    if (signupForm.password !== signupForm.passwordConfirm) {
      setError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUp(signupForm);

      if (result.needsEmailConfirmation) {
        // 로그인 화면으로 돌리지 않고 인증 대기 화면으로 전환
        setPendingVerificationEmail(signupForm.email);
        setSignupForm(initialSignupForm);
        return;
      }

      navigate(getRedirectPath(result.profile), { replace: true });
    } catch (authError) {
      setError(getFriendlyAuthError(authError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!pendingVerificationEmail) return;
    setResendStatus('');
    setError('');
    setIsResending(true);

    try {
      await resendVerification(pendingVerificationEmail);
      setResendStatus('인증 메일을 다시 보냈습니다. 메일함을 확인해주세요.');
    } catch (resendError) {
      setError(getFriendlyAuthError(resendError));
    } finally {
      setIsResending(false);
    }
  };

  const handleBackToLogin = () => {
    setPendingVerificationEmail(null);
    setResendStatus('');
    setError('');
    setStatus('');
    switchToStart();
  };

  return (
    <div className="auth-page page-shell">
      <section className={mode === 'signup' ? 'auth-card signup-card' : 'auth-card'}>
        <Link to="/" className="auth-logo" aria-label="급매 홈">
          <span className="auth-logo-mark">급</span>
          <span>급매</span>
        </Link>

        {!isConfigured && (
          <p className="form-status error">Supabase 환경변수가 없어 인증 기능을 사용할 수 없습니다.</p>
        )}

        {pendingVerificationEmail ? (
          <div className="verification-pending">
            <div className="verification-pending-icon" aria-hidden="true">
              <MailCheck size={36} />
            </div>
            <h1>이메일을 확인해주세요</h1>
            <p className="verification-pending-target">
              <strong>{pendingVerificationEmail}</strong> 로 인증 메일을 보냈습니다.
            </p>
            <p className="verification-pending-body">
              메일에 있는 <strong>인증 링크를 클릭</strong>하시면 가입이 완료됩니다.
              그 후 이 화면으로 다시 돌아와 로그인하실 수 있습니다.
            </p>
            <ul className="verification-pending-hint">
              <li>메일이 안 보이면 스팸함 또는 프로모션함을 확인해주세요.</li>
              <li>인증 링크는 24시간 동안만 유효합니다.</li>
            </ul>

            <div className="verification-pending-actions">
              <button
                type="button"
                className="auth-submit-button"
                onClick={handleResend}
                disabled={isResending || !isConfigured}
              >
                {isResending ? '메일 재전송 중...' : '인증 메일 다시 보내기'}
              </button>
              <button type="button" className="auth-text-button" onClick={handleBackToLogin}>
                로그인 화면으로 돌아가기
              </button>
            </div>

            {resendStatus && <p className="form-status">{resendStatus}</p>}
          </div>
        ) : mode === 'start' ? (
          <>
            <div className="auth-intro">
              <h1>로그인하고</h1>
              <p>급매 찾기 여정을 시작하세요.</p>
            </div>

            {!showEmailLogin && (
              <div className="auth-start-actions">
                <button type="button" className="email-login-button" onClick={() => setShowEmailLogin(true)}>
                  <Mail size={22} />
                  이메일로 로그인하기
                </button>
              </div>
            )}

            {showEmailLogin && (
              <form className="inline-login-form" onSubmit={handleLogin}>
                <label>
                  이메일
                  <input
                    type="email"
                    name="email"
                    value={loginForm.email}
                    onChange={updateLoginForm}
                    placeholder="이메일 주소 입력"
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    type="password"
                    name="password"
                    value={loginForm.password}
                    onChange={updateLoginForm}
                    placeholder="비밀번호 입력"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <button type="submit" className="auth-submit-button" disabled={isSubmitting || !isConfigured}>
                  {isSubmitting ? '확인 중...' : '로그인'}
                </button>
              </form>
            )}

            <div className="auth-divider">
              <span />
              <em>또는</em>
              <span />
            </div>

            <SocialLoginButtons label="로그인" disabled={isSubmitting} comingSoon />

            <div className="auth-footer-link">
              아직 회원이 아니신가요?
              <button type="button" onClick={switchToSignup}>
                가입하기
              </button>
            </div>

            <Link to="/agent-signup" className="agent-entry-link">
              중개사 가입/광고문의
              <ArrowRight size={15} />
            </Link>
          </>
        ) : (
          <form className="signup-form" onSubmit={handleSignup}>
            <div className="signup-heading">
              <h1>회원정보 입력</h1>
              <p>급매 서비스 이용을 위해 아래 정보를 입력해주세요.</p>
            </div>

            <SocialLoginButtons label="간편 가입" disabled={isSubmitting} comingSoon />

            <div className="auth-divider">
              <span />
              <em>또는 이메일로 가입</em>
              <span />
            </div>

            <label>
              아이디
              <input
                type="email"
                name="email"
                value={signupForm.email}
                onChange={updateSignupForm}
                placeholder="이메일 주소 입력"
                autoComplete="email"
                required
              />
            </label>

            <label>
              비밀번호
              <input
                type="password"
                name="password"
                value={signupForm.password}
                onChange={updateSignupForm}
                placeholder="6자리 이상 영문, 숫자 포함"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>

            <label className="compact-label">
              <input
                type="password"
                name="passwordConfirm"
                value={signupForm.passwordConfirm}
                onChange={updateSignupForm}
                placeholder="비밀번호 확인"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>

            <label>
              이름
              <input
                name="fullName"
                value={signupForm.fullName}
                onChange={updateSignupForm}
                placeholder="실명 입력"
                autoComplete="name"
                required
              />
            </label>

            <label>
              연락처
              <input
                name="phone"
                value={signupForm.phone}
                onChange={updateSignupForm}
                placeholder="010-0000-0000"
                autoComplete="tel"
                required
              />
            </label>

            <label>
              관심 지역
              <input
                name="favoriteRegion"
                value={signupForm.favoriteRegion}
                onChange={updateSignupForm}
                placeholder="예: 서울 강남구"
              />
            </label>

            <button
              type="submit"
              className="auth-submit-button"
              disabled={!canSubmitSignup || isSubmitting || !isConfigured}
            >
              {isSubmitting ? '가입 처리 중...' : '회원가입 완료'}
            </button>

            <button type="button" className="auth-text-button" onClick={switchToStart}>
              로그인으로 돌아가기
            </button>
          </form>
        )}

        {status && <p className="form-status">{status}</p>}
        {error && <p className="form-status error">{error}</p>}
      </section>
    </div>
  );
}

export default Login;
