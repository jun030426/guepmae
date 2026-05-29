import { useEffect, useRef, useState } from 'react';
import { Bus, Car, Search } from 'lucide-react';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// 이 매물에서 매수자가 입력한 목적지까지 대중교통/자동차 소요시간 + 경로 지도
function CommuteSearch({ property }) {
  const inputRef = useRef(null);
  const mapElRef = useRef(null);
  const googleRef = useRef(null);
  const mapRef = useRef(null);
  const rendererRef = useRef(null);
  const directionsRef = useRef(null);
  const originRef = useRef(null);
  const routeResRef = useRef({ transit: null, driving: null }); // 원본 경로 결과 (지도 렌더용)

  const [ready, setReady] = useState(false);
  const [dest, setDest] = useState(null);
  const [result, setResult] = useState(null); // { transit: 분|null, driving: 분|null }
  const [mode, setMode] = useState('transit');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      setError('지도 API 키가 설정되지 않았습니다.');
      return undefined;
    }
    let cancelled = false;

    loadGoogleMapSdk(GOOGLE_MAPS_API_KEY)
      .then(async (google) => {
        if (cancelled) return;
        googleRef.current = google;

        // 출발지(이 매물) 좌표 — 없으면 주소로 지오코딩
        let origin =
          Number.isFinite(property.coordinates?.lat) && Number.isFinite(property.coordinates?.lng)
            ? { lat: property.coordinates.lat, lng: property.coordinates.lng }
            : null;
        if (!origin && property.address) {
          origin = await new Promise((resolve) => {
            new google.Geocoder().geocode({ address: property.address, region: 'KR' }, (r, s) => {
              if (s === 'OK' && r?.[0]) {
                const loc = r[0].geometry.location;
                resolve({ lat: loc.lat(), lng: loc.lng() });
              } else resolve(null);
            });
          });
        }
        if (cancelled || !origin || !mapElRef.current) return;
        originRef.current = origin;

        mapRef.current = new google.Map(mapElRef.current, {
          center: origin,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: 'cooperative',
        });
        new google.Marker({ position: origin, map: mapRef.current, title: property.title });
        rendererRef.current = new google.DirectionsRenderer({ map: mapRef.current });
        directionsRef.current = new google.DirectionsService();

        const autocomplete = new google.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'kr' },
          fields: ['name', 'geometry', 'formatted_address'],
        });
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place?.geometry?.location) return;
          const loc = place.geometry.location;
          const destination = {
            name: place.name || place.formatted_address,
            location: { lat: loc.lat(), lng: loc.lng() },
          };
          setDest(destination);
          computeRoutes(destination);
        });

        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('지도를 불러오지 못했습니다.');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id]);

  const minutesOf = (res) => {
    const sec = res?.routes?.[0]?.legs?.[0]?.duration?.value;
    return sec ? Math.round(sec / 60) : null;
  };

  const computeRoutes = (destination) => {
    const google = googleRef.current;
    const origin = originRef.current;
    if (!google || !origin) return;
    setLoading(true);
    setError('');
    setResult(null);

    const ds = directionsRef.current;
    const transitReq = new Promise((resolve) =>
      ds.route(
        {
          origin,
          destination: destination.location,
          travelMode: google.TravelMode.TRANSIT,
          transitOptions: { departureTime: new Date() },
        },
        (r, s) => resolve(s === 'OK' ? r : null),
      ),
    );
    const drivingReq = new Promise((resolve) =>
      ds.route(
        { origin, destination: destination.location, travelMode: google.TravelMode.DRIVING },
        (r, s) => resolve(s === 'OK' ? r : null),
      ),
    );

    Promise.all([transitReq, drivingReq]).then(([transit, driving]) => {
      routeResRef.current = { transit, driving };
      setResult({ transit: minutesOf(transit), driving: minutesOf(driving) });
      // 현재 선택 모드 경로를 지도에 그림 (없으면 가능한 다른 모드)
      const drawn = (mode === 'transit' ? transit : driving) || transit || driving;
      if (drawn && rendererRef.current) rendererRef.current.setDirections(drawn);
      setLoading(false);
    });
  };

  const selectMode = (next) => {
    setMode(next);
    const res = routeResRef.current[next];
    if (res && rendererRef.current) rendererRef.current.setDirections(res);
  };

  if (!GOOGLE_MAPS_API_KEY) return null;

  return (
    <div className="commute-search">
      <div className="commute-search-head">
        <h3>길찾기 · 소요시간</h3>
        <p>이 매물에서 원하는 목적지까지 대중교통·자동차로 얼마나 걸리는지 확인하세요.</p>
      </div>

      <div className="commute-search-input">
        <Search size={16} />
        <input
          ref={inputRef}
          type="text"
          placeholder="도착지를 입력하세요 (예: 강남역, 회사·학교 주소)"
          disabled={!ready}
          aria-label="도착지 검색"
        />
      </div>

      {error && <p className="commute-error">{error}</p>}

      {dest && (
        <div className="commute-result">
          <p className="commute-dest">
            <strong>{property.title}</strong> → <strong>{dest.name}</strong>
          </p>
          {loading ? (
            <p className="commute-loading">경로를 계산하는 중...</p>
          ) : (
            <div className="commute-modes">
              <button
                type="button"
                className={mode === 'transit' ? 'commute-mode active' : 'commute-mode'}
                onClick={() => selectMode('transit')}
                disabled={result?.transit == null}
              >
                <Bus size={16} />
                <span>대중교통</span>
                <strong>{result?.transit != null ? `${result.transit}분` : '경로 없음'}</strong>
              </button>
              <button
                type="button"
                className={mode === 'driving' ? 'commute-mode active' : 'commute-mode'}
                onClick={() => selectMode('driving')}
                disabled={result?.driving == null}
              >
                <Car size={16} />
                <span>자동차</span>
                <strong>{result?.driving != null ? `${result.driving}분` : '경로 없음'}</strong>
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={mapElRef} className="commute-map" aria-label="경로 지도" />
    </div>
  );
}

export default CommuteSearch;
