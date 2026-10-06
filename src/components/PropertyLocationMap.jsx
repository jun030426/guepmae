import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';
import L, { createOsmTileLayer, createSpotIcon, SPOT_PIN_URL } from '../utils/leafletLoader.js';
import { geocodeAddress as geocodeWithKakao, loadKakaoMaps } from '../utils/kakaoLoader.js';
import { MAP_PROVIDER, GOOGLE_MAPS_API_KEY } from '../utils/mapProvider.js';

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

/* OSM(Leaflet) — 기본. 좌표가 있으면 즉시 렌더, 키·결제 불필요. */
function LeafletLocationMap({ property, coordinates }) {
  const mapElementRef = useRef(null);

  useEffect(() => {
    if (!mapElementRef.current) return undefined;
    const map = L.map(mapElementRef.current, {
      center: [coordinates.lat, coordinates.lng],
      zoom: 15,
      minZoom: 10,
      zoomControl: true,
      scrollWheelZoom: false, // 페이지 스크롤과 충돌 방지 (기존 cooperative 동작 유지)
    });
    createOsmTileLayer().addTo(map);
    L.marker([coordinates.lat, coordinates.lng], {
      icon: createSpotIcon(),
      title: property.title,
    }).addTo(map);
    return () => {
      map.remove();
    };
  }, [property.id, property.title, coordinates.lat, coordinates.lng]);

  return (
    <div className="detail-map-wrapper">
      <div
        ref={mapElementRef}
        className="detail-map-canvas leaflet-map-canvas"
        aria-label={`${property.title} 위치 지도`}
      />
    </div>
  );
}

/* 카카오맵 — 카카오 키가 있을 때 기본. 좌표가 없으면 주소로 위치를 찾는다(새로 등록한 매물 대응).
 * SDK 로드가 실패하면 onFail 로 OSM 에 자리를 넘긴다. */
function KakaoLocationMap({ property, storedCoords, onFail }) {
  const mapElementRef = useRef(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'not-found'
  const lat = storedCoords?.lat;
  const lng = storedCoords?.lng;

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element) return undefined;
    let cancelled = false;
    setStatus('loading');

    loadKakaoMaps()
      .then(async (maps) => {
        const position = Number.isFinite(lat) ? { lat, lng } : await geocodeWithKakao(property.address);
        if (cancelled || !mapElementRef.current) return;
        if (!position) {
          setStatus('not-found');
          return;
        }
        const center = new maps.LatLng(position.lat, position.lng);
        const map = new maps.Map(element, { center, level: 4, scrollwheel: false }); // 페이지 스크롤과 충돌 방지
        map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
        new maps.Marker({
          map,
          position: center,
          title: property.title,
          image: new maps.MarkerImage(SPOT_PIN_URL, new maps.Size(34, 44), { offset: new maps.Point(17, 42) }),
        });
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[detail-map] 카카오 지도 로드 실패 — OpenStreetMap 으로 전환합니다:', error);
        onFail();
      });

    return () => {
      cancelled = true;
      element.innerHTML = '';
    };
  }, [property.id, property.address, property.title, lat, lng, onFail]);

  return (
    <div className="detail-map-wrapper">
      <div ref={mapElementRef} className="detail-map-canvas" aria-label={`${property.title} 위치 지도`} />
      {status === 'loading' && <div className="detail-map-overlay">지도를 불러오는 중...</div>}
      {status === 'not-found' && <div className="detail-map-overlay">주소로 위치를 찾지 못했습니다.</div>}
    </div>
  );
}

function GoogleLocationMap({ property, storedCoords }) {
  const mapElementRef = useRef(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!mapElementRef.current) return undefined;

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
  }, [property.id, property.address, storedCoords?.lat, storedCoords?.lng]);

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

function PropertyLocationMap({ property }) {
  const storedCoords = getStoredCoordinates(property);
  const [kakaoFailed, setKakaoFailed] = useState(false);
  const handleKakaoFail = useCallback(() => setKakaoFailed(true), []);

  if (MAP_PROVIDER === 'kakao' && !kakaoFailed && (storedCoords || property.address)) {
    return <KakaoLocationMap property={property} storedCoords={storedCoords} onFail={handleKakaoFail} />;
  }

  if (MAP_PROVIDER === 'google' && (storedCoords || property.address)) {
    return <GoogleLocationMap property={property} storedCoords={storedCoords} />;
  }

  // OSM 은 좌표 기반 — 좌표가 없으면 스케치 폴백
  if (storedCoords) {
    return <LeafletLocationMap property={property} coordinates={storedCoords} />;
  }

  return <FallbackSketch />;
}

export default PropertyLocationMap;
