import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function getStoredCoordinates(property) {
  if (Number.isFinite(property.coordinates?.lat) && Number.isFinite(property.coordinates?.lng)) {
    return { lat: property.coordinates.lat, lng: property.coordinates.lng };
  }
  return null;
}

// 주소만 있고 좌표가 없을 때 브라우저에서 직접 지오코딩 (referrer 제한 키도 브라우저 호출은 허용)
function geocodeAddress(googleMaps, address) {
  return new Promise((resolve) => {
    const geocoder = new googleMaps.Geocoder();
    geocoder.geocode({ address, region: 'KR' }, (results, geoStatus) => {
      if (geoStatus === 'OK' && results?.[0]) {
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng() });
      } else {
        resolve(null);
      }
    });
  });
}

function FallbackSketch() {
  return (
    <div className="detail-map-visual" aria-hidden="true">
      <span className="map-line horizontal" />
      <span className="map-line vertical" />
      <span className="map-line diagonal" />
      <span className="detail-map-pin">
        <MapPin size={20} />
      </span>
    </div>
  );
}

function PropertyLocationMap({ property }) {
  const mapElementRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const storedCoords = getStoredCoordinates(property);
  // 키가 있고, 좌표든 주소든 하나라도 있으면 진짜 지도를 시도
  const canRenderMap = Boolean(GOOGLE_MAPS_API_KEY) && Boolean(storedCoords || property.address);

  useEffect(() => {
    if (!canRenderMap || !mapElementRef.current) return undefined;

    let cancelled = false;
    setStatus('loading');

    loadGoogleMapSdk(GOOGLE_MAPS_API_KEY)
      .then(async (googleMaps) => {
        if (cancelled || !mapElementRef.current) return;

        const position = storedCoords ?? (await geocodeAddress(googleMaps, property.address));
        if (cancelled || !mapElementRef.current) return;

        if (!position) {
          setStatus('error');
          return;
        }

        const map = new googleMaps.Map(mapElementRef.current, {
          center: position,
          zoom: 15,
          minZoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          gestureHandling: 'cooperative',
        });
        new googleMaps.Marker({
          position,
          map,
          title: property.title,
        });
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[detail-map] Google Maps 로드 실패:', error);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id, property.address, property.coordinates?.lat, property.coordinates?.lng]);

  if (!canRenderMap) {
    return <FallbackSketch />;
  }

  return (
    <div className="detail-map-wrapper">
      <div
        ref={mapElementRef}
        className="detail-map-canvas"
        aria-label={`${property.title} 위치 지도`}
      />
      {status === 'loading' && <div className="detail-map-overlay">지도를 불러오는 중...</div>}
      {status === 'error' && (
        <div className="detail-map-overlay">주소로 위치를 찾지 못했습니다.</div>
      )}
    </div>
  );
}

export default PropertyLocationMap;
