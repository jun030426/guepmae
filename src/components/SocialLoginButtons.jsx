import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

// Google 공식 G 로고 (인라인 SVG — 색상 변경 없이 사용해야 브랜드 가이드라인 준수)
function GoogleLogo({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// 카카오 말풍선 심볼 (인라인 SVG)
function KakaoLogo({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 3C6.477 3 2 6.477 2 10.8c0 2.836 1.886 5.314 4.7 6.69-.207.766-.747 2.748-.855 3.175-.135.532.195.524.41.382.169-.112 2.687-1.825 3.78-2.566.642.094 1.298.144 1.965.144 5.523 0 10-3.477 10-7.8S17.523 3 12 3z"
        fill="#3C1E1E"
      />
    </svg>
  );
}

function SocialLoginButtons({ disabled = false, label = '로그인', comingSoon = false }) {
  const { signInWithProvider, isConfigured } = useAuth();
  const [pendingProvider, setPendingProvider] = useState(null);
  const [error, setError] = useState('');

  const handleClick = async (provider) => {
    if (comingSoon) return; // 준비 중 상태에선 OAuth 호출 자체를 차단
    setError('');
    setPendingProvider(provider);
    try {
      await signInWithProvider(provider);
      // 성공 시 브라우저가 provider 페이지로 리디렉트되므로 이후 코드는 거의 실행 안 됨
    } catch (oauthError) {
      setError(oauthError?.message ?? `${provider} 로그인을 시작하지 못했습니다.`);
      setPendingProvider(null);
    }
  };

  const isDisabled = disabled || !isConfigured || comingSoon;
  const suffix = comingSoon ? ' (준비 중)' : '';

  return (
    <div className="social-login-stack">
      <button
        type="button"
        className={`social-login-button google ${comingSoon ? 'is-coming-soon' : ''}`}
        onClick={() => handleClick('google')}
        disabled={isDisabled || pendingProvider !== null}
        aria-label={comingSoon ? 'Google 로그인 준비 중' : `Google로 ${label}`}
      >
        <GoogleLogo size={18} />
        <span>{pendingProvider === 'google' ? '이동 중...' : `Google로 ${label}${suffix}`}</span>
      </button>
      <button
        type="button"
        className={`social-login-button kakao ${comingSoon ? 'is-coming-soon' : ''}`}
        onClick={() => handleClick('kakao')}
        disabled={isDisabled || pendingProvider !== null}
        aria-label={comingSoon ? '카카오 로그인 준비 중' : `카카오로 ${label}`}
      >
        <KakaoLogo size={18} />
        <span>{pendingProvider === 'kakao' ? '이동 중...' : `카카오로 ${label}${suffix}`}</span>
      </button>
      {error && <p className="form-status error">{error}</p>}
    </div>
  );
}

export default SocialLoginButtons;
