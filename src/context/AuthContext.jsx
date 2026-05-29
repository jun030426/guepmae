import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

const AuthContext = createContext(null);

function getRedirectPath(profile) {
  // owner/admin/agent 는 로그인 후 중개사 portal 의 대시보드로
  if (profile?.role === 'owner' || profile?.role === 'admin' || profile?.role === 'agent') {
    return '/agent/dashboard';
  }
  return '/properties';
}

async function fetchProfile(userId) {
  if (!isSupabaseConfigured || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(isSupabaseConfigured));

  const loadProfile = async (userId) => {
    const nextProfile = await fetchProfile(userId);
    // 정지된 계정은 강제 로그아웃
    if (nextProfile?.suspended) {
      alert('계정이 정지되었습니다. 운영팀에 문의해주세요.');
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      return null;
    }
    setProfile(nextProfile);
    return nextProfile;
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return undefined;
    }

    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;

      setSession(data.session);

      if (data.session?.user) {
        try {
          await loadProfile(data.session.user.id);
        } catch (error) {
          console.warn('Failed to load auth profile.', error);
          setProfile(null);
        }
      }

      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (!nextSession?.user) {
        setProfile(null);
        setIsLoading(false);
        return;
      }

      setTimeout(() => {
        loadProfile(nextSession.user.id).catch((error) => {
          console.warn('Failed to refresh auth profile.', error);
          setProfile(null);
        });
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async ({ email, password }) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      throw error;
    }

    setSession(data.session);
    const nextProfile = await loadProfile(data.user.id);
    return { user: data.user, profile: nextProfile, redirectPath: getRedirectPath(nextProfile) };
  };

  const signUp = async ({
    email,
    password,
    fullName,
    phone,
    favoriteRegion,
  }) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    // Supabase 이메일 템플릿이 {{ .Token }} 으로 설정되면 사용자에겐 6자리 코드만 가고
    // emailRedirectTo 는 무시됨. 그래도 호환성을 위해 지정만 해둠.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          full_name: fullName,
          phone,
          requested_role: 'user',
          favorite_region: favoriteRegion,
        },
      },
    });

    if (error) {
      throw error;
    }

    if (data.session?.user) {
      setSession(data.session);
      const nextProfile = await loadProfile(data.session.user.id);
      return { user: data.user, profile: nextProfile, needsEmailConfirmation: false };
    }

    return { user: data.user, profile: null, needsEmailConfirmation: true };
  };

  // 회원가입 OTP 검증 — 사용자가 메일에서 받은 6자리 인증번호를 입력하면 호출.
  // 성공 시 자동 로그인 + 프로필 로드까지 완료.
  const verifySignupOtp = async ({ email, token }) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error) throw error;

    setSession(data.session);
    const nextProfile = data.user ? await loadProfile(data.user.id) : null;
    return {
      user: data.user,
      profile: nextProfile,
      redirectPath: getRedirectPath(nextProfile),
    };
  };

  const resendVerification = async (email) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      throw error;
    }
  };

  // 비밀번호 재설정 1단계 — 입력한 이메일로 6자리 인증번호 발송.
  // Supabase "Reset Password" 템플릿이 {{ .Token }} 이어야 코드가 옴 (링크 아님).
  const requestPasswordReset = async (email) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      throw error;
    }
  };

  // 비밀번호 재설정 2단계 — 메일로 받은 6자리 코드 검증. 성공하면 임시 복구 세션 생성.
  const verifyRecoveryOtp = async ({ email, token }) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'recovery',
    });

    if (error) throw error;

    setSession(data.session);
    return { user: data.user };
  };

  // 비밀번호 재설정 3단계 — 복구 세션 상태에서 새 비밀번호 저장.
  const updatePassword = async (newPassword) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    const { data, error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) throw error;

    const nextProfile = data.user ? await loadProfile(data.user.id) : null;
    return {
      user: data.user,
      profile: nextProfile,
      redirectPath: getRedirectPath(nextProfile),
    };
  };

  // OAuth 로그인 — Google, Kakao 등 Supabase에서 활성화된 provider 사용
  // 가입과 로그인이 동일한 함수 호출 (Supabase가 자동 분기). 첫 가입은 handle_new_user 트리거가 profile 생성
  const signInWithProvider = async (provider) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
    }

    const options = {
      // OAuth 콜백 후 사용자가 돌아올 URL — /login 도착 후 useEffect가 redirectPath로 자동 이동
      redirectTo: `${window.location.origin}/login`,
    };

    // Kakao는 account_email scope가 "비즈 앱" 등록 후에만 가능.
    // 비즈 앱이 아닌 일반 앱이면 nickname + profile_image 만 요청 (이메일 제외).
    if (provider === 'kakao') {
      options.scopes = 'profile_nickname profile_image';
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options,
    });

    if (error) {
      throw error;
    }
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) {
      setSession(null);
      setProfile(null);
      return;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    setSession(null);
    setProfile(null);
  };

  const value = useMemo(
    () => ({
      isConfigured: isSupabaseConfigured,
      isLoading,
      session,
      user: session?.user ?? null,
      profile,
      isAuthenticated: Boolean(session?.user),
      isOwner: profile?.role === 'owner',
      isAdmin: profile?.role === 'admin' || profile?.role === 'owner',
      isAgent: profile?.role === 'agent' || profile?.role === 'admin' || profile?.role === 'owner',
      signIn,
      signUp,
      verifySignupOtp,
      signOut,
      resendVerification,
      requestPasswordReset,
      verifyRecoveryOtp,
      updatePassword,
      signInWithProvider,
      refreshProfile: () => (session?.user ? loadProfile(session.user.id) : null),
      getRedirectPath,
    }),
    [isLoading, session, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return value;
}
