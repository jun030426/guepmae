import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchProperties,
  fetchPropertyById,
} from '../services/propertiesRepository.js';
const initialSource = 'loading';

export function useProperties({ urgentOnly = false } = {}) {
  const [properties, setProperties] = useState([]);
  const [source, setSource] = useState(initialSource);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchProperties();
      setProperties(next);
      setSource('local');
      setError(null);
    } catch (fetchError) {
      console.warn('매물 새로고침 실패.', fetchError);
      setError(fetchError);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchProperties()
      .then((nextProperties) => {
        if (!active) return;
        setProperties(nextProperties);
        setSource('local');
      })
      .catch((fetchError) => {
        if (!active) return;
        console.warn('매물 로드 실패.', fetchError);
        setError(fetchError);
        setSource('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleProperties = useMemo(() => {
    if (!urgentOnly) return properties;
    return properties.filter((property) => property.discountRate >= 5);
  }, [properties, urgentOnly]);

  return {
    properties: visibleProperties,
    source,
    error,
    isLoading: source === 'loading',
    refresh,
  };
}

export function useProperty(id) {
  const [property, setProperty] = useState(null);
  const [source, setSource] = useState(initialSource);
  const [error, setError] = useState(null);

  useEffect(() => {
    setProperty(null);

    let active = true;
    setSource('loading');

    fetchPropertyById(id)
      .then((nextProperty) => {
        if (!active) return;
        setProperty(nextProperty);
        setSource(nextProperty ? 'local' : 'empty');
      })
      .catch((fetchError) => {
        if (!active) return;
        console.warn('매물 상세 로드 실패.', fetchError);
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
