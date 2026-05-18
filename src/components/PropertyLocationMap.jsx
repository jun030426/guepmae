import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function hasCoordinates(property) {
  return Number.isFinite(property.coordinates?.lat) && Number.isFinite(property.coordinates?.lng);
}

function FallbackSketch() {
  return (
    <div className="detail-map-fallback" aria-hidden="true">
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
  const coordinatesReady = hasCoordinates(property);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !coordinatesReady || !mapElementRef.current) return undefined;

    let cancelled = false;
    setStatus('loading');

    loadGoogleMapSdk(GOOGLE_MAPS_API_KEY)
      .then((googleMaps) => {
        if (cancelled || !mapElementRef.current) return;
        const position = { lat: property.coordinates.lat, lng: property.coordinates.lng };
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
  }, [property, coordinatesReady]);

  if (!GOOGLE_MAPS_API_KEY || !coordinatesReady) {
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
        <div className="detail-map-overlay">지도를 불러오지 못했습니다. API 키를 확인하세요.</div>
      )}
    </div>
  );
}

export default PropertyLocationMap;
