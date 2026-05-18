import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

const AuthContext = createContext(null);

function getRedirectPath(profile) {
  if (profile?.role === 'admin' || profile?.role === 'agent') return '/admin';
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

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
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
      isAdmin: profile?.role === 'admin',
      isAgent: profile?.role === 'agent',
      signIn,
      signUp,
      signOut,
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
