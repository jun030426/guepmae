import { useEffect, useMemo, useState } from 'react';
import {
  fallbackProperties,
  fetchProperties,
  fetchPropertyById,
} from '../services/propertiesRepository.js';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';

const fallbackSource = isSupabaseConfigured ? 'loading' : 'fallback';

function getFallbackProperty(id) {
  return fallbackProperties.find((property) => property.id === id) ?? null;
}

export function useProperties({ urgentOnly = false } = {}) {
  const [properties, setProperties] = useState(fallbackProperties);
  const [source, setSource] = useState(fallbackSource);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    let active = true;

    fetchProperties()
      .then((nextProperties) => {
        if (!active) return;
        setProperties(nextProperties);
        setSource('supabase');
      })
      .catch((fetchError) => {
        if (!active) return;
        console.warn('Supabase properties fetch failed. Falling back to local data.', fetchError);
        setError(fetchError);
        setSource('fallback');
      });

    return () => {
      active = false;
    };
  }, []);

  const visibleProperties = useMemo(() => {
    if (!urgentOnly) {
      return properties;
    }

    return properties.filter((property) => property.discountRate >= 5);
  }, [properties, urgentOnly]);

  return {
    properties: visibleProperties,
    source,
    error,
    isLoading: source === 'loading',
  };
}

export function useProperty(id) {
  const [property, setProperty] = useState(() => getFallbackProperty(id));
  const [source, setSource] = useState(fallbackSource);
  const [error, setError] = useState(null);

  useEffect(() => {
    setProperty(getFallbackProperty(id));

    if (!isSupabaseConfigured) {
      setSource('fallback');
      return undefined;
    }

    let active = true;
    setSource('loading');

    fetchPropertyById(id)
      .then((nextProperty) => {
        if (!active) return;
        setProperty(nextProperty ?? getFallbackProperty(id));
        setSource(nextProperty ? 'supabase' : 'fallback');
      })
      .catch((fetchError) => {
        if (!active) return;
        console.warn('Supabase property fetch failed. Falling back to local data.', fetchError);
        setError(fetchError);
        setProperty(getFallbackProperty(id));
        setSource('fallback');
      });

    return () => {
      active = false;
    };
  }, [id]);

  return {
    property,
    source,
    error,
    isLoading: source === 'loading',
  };
}
