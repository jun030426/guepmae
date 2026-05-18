import { useEffect, useMemo, useState } from 'react';
import {
  fetchProperties,
  fetchPropertyById,
} from '../services/propertiesRepository.js';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';

const initialSource = isSupabaseConfigured ? 'loading' : 'empty';

export function useProperties({ urgentOnly = false } = {}) {
  const [properties, setProperties] = useState([]);
  const [source, setSource] = useState(initialSource);
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
        console.warn('Supabase properties fetch failed.', fetchError);
        setError(fetchError);
        setSource('error');
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
  const [property, setProperty] = useState(null);
  const [source, setSource] = useState(initialSource);
  const [error, setError] = useState(null);

  useEffect(() => {
    setProperty(null);

    if (!isSupabaseConfigured) {
      setSource('empty');
      return undefined;
    }

    let active = true;
    setSource('loading');

    fetchPropertyById(id)
      .then((nextProperty) => {
        if (!active) return;
        setProperty(nextProperty);
        setSource(nextProperty ? 'supabase' : 'empty');
      })
      .catch((fetchError) => {
        if (!active) return;
        console.warn('Supabase property fetch failed.', fetchError);
        setError(fetchError);
        setProperty(null);
        setSource('error');
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
