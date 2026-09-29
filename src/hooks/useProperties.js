import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchProperties,
  fetchPropertyById,
} from '../services/propertiesRepository.js';
const initialSource = 'loading';

// verifiedOnly: 공개 화면(목록·지도)용 — 운영팀 검증 전 매물은 매수자에게 보이지 않는다.
//   (PRODUCT 원칙: "검증된 급매만 노출". 중개사는 내 등록 매물, 운영은 /admin 에서 대기 매물을 본다)
export function useProperties({ urgentOnly = false, verifiedOnly = false } = {}) {
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
    return properties.filter(
      (property) => (!urgentOnly || property.discountRate >= 5) && (!verifiedOnly || property.verified),
    );
  }, [properties, urgentOnly, verifiedOnly]);

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
