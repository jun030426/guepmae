import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchProperties, fetchPropertyById } from '../services/propertiesRepository.js';

// A response from the previous login must not restore their pending listings.
function usePropertyQuery(id) {
  const { session, profile } = useAuth();
  const scope = `${session?.user?.id || 'public'}:${profile?.role || ''}:${profile?.suspended || false}:${id || ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const [result, setResult] = useState({ scope: null, data: null, source: 'loading', error: null });
  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const data = id ? await fetchPropertyById(id) : await fetchProperties();
      if (currentScope.current === scope && sequence === request.current) {
        setResult({ scope, data, source: data ? 'ready' : 'empty', error: null });
      }
    } catch (error) {
      if (currentScope.current === scope && sequence === request.current) {
        setResult({ scope, data: null, source: 'error', error });
      }
    }
  }, [scope, id]);
  useEffect(() => {
    refresh();
    return () => { request.current += 1; };
  }, [refresh]);
  return { ...(result.scope === scope ? result : { data: null, source: 'loading', error: null }), refresh };
}

export function useProperties({ urgentOnly = false, verifiedOnly = false } = {}) {
  const { data, source, error, refresh } = usePropertyQuery();
  const properties = useMemo(() => (data || []).filter(
    (p) => (!urgentOnly || p.discountRate >= 5) && (!verifiedOnly || p.verified),
  ), [data, urgentOnly, verifiedOnly]);
  return {
    properties,
    source, error, isLoading: source === 'loading', refresh,
  };
}

export function useProperty(id) {
  const { data, source, error, refresh } = usePropertyQuery(id);
  return { property: data, source, error, refresh, isLoading: source === 'loading' };
}
