import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';
import { loadNaverMapSdk } from '../utils/naverMapLoader.js';
import { formatPrice } from '../utils/priceUtils.js';
import { MARKER_HOT, MARKER_WARM, MARKER_MILD, TEXT_STRONG } from '../styles/tokens.js';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const NAVER_MAP_CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;

const markerPositions = [
  { top: 18, left: 58 },
  { top: 34, left: 42 },
  { top: 48, left: 62 },
  { top: 58, left: 32 },
  { top: 72, left: 68 },
  { top: 64, left: 48 },
  { top: 28, left: 71 },
  { top: 42, left: 23 },
  { top: 52, left: 77 },
  { top: 23, left: 36 },
  { top: 74, left: 24 },
  { top: 39, left: 55 },
];

const MARKER_COLORS = {
  red: MARKER_HOT,
  orange: MARKER_WARM,
  yellow: MARKER_MILD,
};

const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // Seoul

function formatDiscount(discountRate) {
  return Number.isInteger(discountRate) ? `${discountRate}%` : `${discountRate.toFixed(1)}%`;
}

function getMarkerTone(discountRate) {
  if (discountRate >= 10) return 'red';
  if (discountRate >= 7) return 'orange';
  return 'yellow';
}

function hasCoordinates(property) {
  return Number.isFinite(property.coordinates?.lat) && Number.isFinite(property.coordinates?.lng);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function buildPillIconDataUrl(text, fillColor, active = false) {
  const width = 72;
  const height = 30;
  const stroke = active ? '#ffffff' : 'rgba(255,255,255,0.85)';
  const strokeWidth = active ? 3 : 2;
  const fill = active ? TEXT_STRONG : fillColor;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="${width - strokeWidth}" height="${
    height - strokeWidth
  }" rx="${(height - strokeWidth) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
    <text x="${width / 2}" y="${height / 2 + 4}" font-family="Pretendard, -apple-system, system-ui, sans-serif" font-size="13" font-weight="600" fill="#ffffff" text-anchor="middle">${escapeHtml(
      text,
    )}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getNaverMarkerContent(property, active = false) {
  return `
    <button type="button" class="naver-map-marker ${getMarkerTone(property.discountRate)} ${
    active ? 'active' : ''
  }" aria-label="${escapeHtml(property.title)} 지도 마커">
      ${formatDiscount(property.discountRate)}
    </button>
  `;
}

function getInfoWindowHtml(property) {
  return `
    <div class="map-info-window">
      <strong>${escapeHtml(property.title)}</strong>
      <span>${escapeHtml(property.region)}</span>
      <b>${escapeHtml(formatPrice(property.price))}</b>
      <em>${formatDiscount(property.discountRate)} 저렴</em>
      <a href="/properties/${escapeHtml(property.id)}">상세 보기</a>
    </div>
  `;
}

/* ============================================================
 * MockMap — 두 SDK 모두 없을 때 보이는 정적 placeholder
 * ============================================================ */
function MockMap({ properties, selectedId, onSelect, note }) {
  const markers = useMemo(
    () =>
      properties.map((property, index) => ({
        ...property,
        position: markerPositions[index % markerPositions.length],
      })),
    [properties],
  );
  const selectedProperty = markers.find((property) => property.id === selectedId);

  return (
    <div className="map-canvas" role="img" aria-label="지도 기반 급매 탐색 대체 화면">
      <div className="map-grid-line horizontal top" />
      <div className="map-grid-line horizontal middle" />
      <div className="map-grid-line vertical left" />
      <div className="map-grid-line vertical right" />
      <div className="map-river" />
      <div className="map-district district-a">서울</div>
      <div className="map-district district-b">경기</div>
      <div className="map-district district-c">인천</div>

      {markers.map((property) => (
        <button
          key={property.id}
          type="button"
          className={`map-marker ${getMarkerTone(property.discountRate)} ${
            selectedId === property.id ? 'active' : ''
          }`}
          style={{ top: `${property.position.top}%`, left: `${property.position.left}%` }}
          onClick={() => onSelect(property.id)}
          aria-label={`${property.title} 지도 마커`}
        >
          {formatDiscount(property.discountRate)}
        </button>
      ))}

      {selectedProperty && (
        <div
          className="map-popup"
          style={{
            top: `${Math.max(10, selectedProperty.position.top - 14)}%`,
            left: `${Math.min(62, selectedProperty.position.left + 4)}%`,
          }}
        >
          <strong>{selectedProperty.title}</strong>
          <span>{selectedProperty.region}</span>
          <b>{formatPrice(selectedProperty.price)}</b>
          <em>{formatDiscount(selectedProperty.discountRate)} 저렴</em>
        </div>
      )}

      <div className="map-api-note">
        <MapPin size={15} />
        {note}
      </div>
    </div>
  );
}

/* ============================================================
 * GoogleJsMap — Google Maps JavaScript API 정식 연동
 * 마커가 지도 좌표계에 묶여 있어 패닝/줌 시 자연스럽게 함께 움직임
 * 거리뷰 토글 지원 (한국은 단지 내부 커버리지 제한적)
 * ============================================================ */
function GoogleJsMap({ properties, selectedId, onSelect }) {
  const mapElementRef = useRef(null);
  const streetElementRef = useRef(null);
  const mapRef = useRef(null);
  const streetViewRef = useRef(null);
  const streetViewServiceRef = useRef(null);
  const markerRefs = useRef(new Map());
  const clustererRef = useRef(null);
  const infoWindowRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const [status, setStatus] = useState('idle');
  const [mode, setMode] = useState('map'); // 'map' | 'street'
  const [streetCoverage, setStreetCoverage] = useState('unknown'); // 'unknown' | 'ok' | 'none'

  const mappedProperties = useMemo(() => properties.filter(hasCoordinates), [properties]);
  const propertyById = useMemo(
    () => new Map(mappedProperties.map((property) => [property.id, property])),
    [mappedProperties],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // 지도 초기 로드 + 마커 일괄 생성
  useEffect(() => {
    if (!mapElementRef.current || !mappedProperties.length) return;

    let cancelled = false;
    setStatus('loading');

    // 기존 마커/클러스터/인포 정리
    clustererRef.current?.clearMarkers();
    clustererRef.current = null;
    markerRefs.current.forEach((marker) => marker.setMap(null));
    markerRefs.current.clear();
    infoWindowRef.current?.close();

    loadGoogleMapSdk(GOOGLE_MAPS_API_KEY)
      .then((googleMaps) => {
        if (cancelled) return;

        const initialId = selectedIdRef.current;
        const centerProperty = propertyById.get(initialId) ?? mappedProperties[0];
        const center = centerProperty
          ? { lat: centerProperty.coordinates.lat, lng: centerProperty.coordinates.lng }
          : DEFAULT_CENTER;

        const map = new googleMaps.Map(mapElementRef.current, {
          center,
          zoom: 11,
          minZoom: 6,
          mapTypeControl: false,
          streetViewControl: true,
          fullscreenControl: false,
          gestureHandling: 'greedy',
        });

        const infoWindow = new googleMaps.InfoWindow({ disableAutoPan: false });
        const bounds = new googleMaps.LatLngBounds();

        const markersArr = [];
        mappedProperties.forEach((property) => {
          const position = { lat: property.coordinates.lat, lng: property.coordinates.lng };
          const tone = getMarkerTone(property.discountRate);
          const active = property.id === initialId;
          const iconUrl = buildPillIconDataUrl(
            formatDiscount(property.discountRate),
            MARKER_COLORS[tone],
            active,
          );

          // clusterer가 마커의 map을 직접 관리하므로 여기선 map을 지정하지 않음
          const marker = new googleMaps.Marker({
            position,
            title: property.title,
            icon: {
              url: iconUrl,
              scaledSize: new googleMaps.Size(72, 30),
              anchor: new googleMaps.Point(36, 15),
            },
          });

          bounds.extend(position);
          marker.addListener('click', () => onSelect(property.id));
          markerRefs.current.set(property.id, marker);
          markersArr.push(marker);
        });

        // 마커가 많을 때 줌 아웃 시 군집 표시 (검정 원 + 카운트)
        clustererRef.current = new MarkerClusterer({
          map,
          markers: markersArr,
          renderer: {
            render: ({ count, position }) =>
              new googleMaps.Marker({
                position,
                label: {
                  text: String(count),
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: '600',
                },
                icon: {
                  url:
                    'data:image/svg+xml;charset=UTF-8,' +
                    encodeURIComponent(
                      `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="${TEXT_STRONG}" stroke="#ffffff" stroke-width="2"/></svg>`,
                    ),
                  scaledSize: new googleMaps.Size(44, 44),
                  anchor: new googleMaps.Point(22, 22),
                },
                zIndex: 1000 + count,
              }),
          },
        });

        // 초기 뷰 — 마커가 많으면 너무 멀리 줌아웃되지 않게 max zoom 캡
        if (mappedProperties.length > 1) {
          map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
          // fitBounds 끝난 다음 한번만 줌 캡 적용
          const listener = googleMaps.event.addListenerOnce(map, 'idle', () => {
            if (map.getZoom() > 12) map.setZoom(12);
          });
          void listener;
        }

        mapRef.current = map;
        infoWindowRef.current = infoWindow;
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[map] Google Maps SDK 로드 실패:', error);
        const code = error?.message ?? '';
        if (code === 'GOOGLE_MAP_API_KEY_REQUIRED') {
          setStatus('missing-key');
        } else {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markerRefs.current.forEach((marker) => marker.setMap(null));
      markerRefs.current.clear();
      infoWindowRef.current?.close();
      mapRef.current = null;
    };
  }, [mappedProperties, propertyById, onSelect]);

  // 선택 변경 시: 마커 활성화 토글 + 지도 이동 + 인포윈도우
  useEffect(() => {
    if (status !== 'ready' || !selectedId || !window.google?.maps) return;

    const googleMaps = window.google.maps;
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;
    const property = propertyById.get(selectedId);
    const selectedMarker = markerRefs.current.get(selectedId);
    if (!map || !infoWindow || !property || !selectedMarker) return;

    // 모든 마커 아이콘 재생성 (활성화 표시 갱신)
    markerRefs.current.forEach((marker, propertyId) => {
      const target = propertyById.get(propertyId);
      if (!target) return;
      const tone = getMarkerTone(target.discountRate);
      marker.setIcon({
        url: buildPillIconDataUrl(
          formatDiscount(target.discountRate),
          MARKER_COLORS[tone],
          propertyId === selectedId,
        ),
        scaledSize: new googleMaps.Size(72, 30),
        anchor: new googleMaps.Point(36, 15),
      });
    });

    map.panTo({ lat: property.coordinates.lat, lng: property.coordinates.lng });
    // 마커 클릭 시 줌인 — 이미 가까이 들어와 있으면 그대로 둠
    const currentZoom = map.getZoom() ?? 11;
    if (currentZoom < 15) {
      map.setZoom(15);
    }
    infoWindow.setContent(getInfoWindowHtml(property));
    infoWindow.open({ map, anchor: selectedMarker });
  }, [status, selectedId, propertyById]);

  // 지도 모드로 돌아가면 거리뷰 인스턴스를 숨김 (메모리는 유지 → 다음 진입 시 빠름)
  useEffect(() => {
    if (mode === 'map' && streetViewRef.current) {
      streetViewRef.current.setVisible(false);
    }
  }, [mode]);

  // 거리뷰 모드 진입/위치 동기화
  useEffect(() => {
    if (status !== 'ready' || mode !== 'street' || !selectedId || !window.google?.maps) return;
    if (!streetElementRef.current) return;

    const googleMaps = window.google.maps;
    const property = propertyById.get(selectedId);
    if (!property) return;

    const position = { lat: property.coordinates.lat, lng: property.coordinates.lng };

    // 커버리지 사전 체크 — 200m 반경 내 파노라마 존재 여부
    if (!streetViewServiceRef.current) {
      streetViewServiceRef.current = new googleMaps.StreetViewService();
    }
    setStreetCoverage('unknown');
    streetViewServiceRef.current.getPanorama(
      { location: position, radius: 200, source: googleMaps.StreetViewSource?.OUTDOOR ?? 'default' },
      (data, statusCode) => {
        if (statusCode === googleMaps.StreetViewStatus.OK) {
          setStreetCoverage('ok');
          if (!streetViewRef.current) {
            streetViewRef.current = new googleMaps.StreetViewPanorama(streetElementRef.current, {
              position: data.location.latLng,
              pov: { heading: 0, pitch: 0 },
              zoom: 1,
              addressControl: false,
              fullscreenControl: false,
              motionTracking: false,
              motionTrackingControl: false,
            });
          } else {
            streetViewRef.current.setPosition(data.location.latLng);
            streetViewRef.current.setVisible(true);
          }
        } else {
          setStreetCoverage('none');
          streetViewRef.current?.setVisible(false);
        }
      },
    );
  }, [status, mode, selectedId, propertyById]);

  if (!mappedProperties.length) {
    return (
      <div className="map-canvas map-empty">
        <div className="map-status-overlay">좌표가 등록된 매물이 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="map-canvas-wrapper">
      <div
        ref={mapElementRef}
        className={`map-canvas google-js-map-canvas ${mode === 'street' ? 'is-hidden' : ''}`}
        aria-label="Google 지도 기반 급매 탐색"
      />
      <div
        ref={streetElementRef}
        className={`map-canvas google-street-view-canvas ${mode === 'map' ? 'is-hidden' : ''}`}
        aria-label="Google 거리뷰"
      />

      <div className="map-view-toggle" role="tablist" aria-label="지도 보기 모드">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'map'}
          className={mode === 'map' ? 'active' : ''}
          onClick={() => setMode('map')}
        >
          지도
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'street'}
          className={mode === 'street' ? 'active' : ''}
          onClick={() => setMode('street')}
        >
          거리뷰
        </button>
      </div>

      {mode === 'street' && streetCoverage === 'none' && (
        <div className="street-view-no-coverage">
          <strong>이 위치는 Google 거리뷰가 지원되지 않습니다.</strong>
          <span>아파트 단지 내부·소도시·골목 등은 커버되지 않을 수 있어요.</span>
        </div>
      )}

      {status === 'loading' && (
        <div className="map-status-overlay">Google 지도를 불러오는 중입니다.</div>
      )}
      {status === 'missing-key' && (
        <div className="map-status-overlay">
          Google Maps API 키가 설정되지 않았습니다. .env.local에 VITE_GOOGLE_MAPS_API_KEY를 추가하세요.
        </div>
      )}
      {status === 'error' && (
        <div className="map-status-overlay">
          Google 지도를 불러오지 못했습니다. API 키와 Maps JavaScript API 활성화 상태를 확인하세요.
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * NaverMap — VITE_NAVER_MAP_CLIENT_ID가 있을 때 사용
 * (기존 구현 유지)
 * ============================================================ */
function NaverMap({ properties, selectedId, onSelect }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef(new Map());
  const infoWindowRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const [status, setStatus] = useState('idle');

  const mappedProperties = useMemo(() => properties.filter(hasCoordinates), [properties]);
  const propertyById = useMemo(
    () => new Map(mappedProperties.map((property) => [property.id, property])),
    [mappedProperties],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!mapElementRef.current || !mappedProperties.length) return;

    let cancelled = false;
    setStatus('loading');
    markerRefs.current.forEach((marker) => marker.setMap(null));
    markerRefs.current.clear();
    infoWindowRef.current?.close();

    loadNaverMapSdk(NAVER_MAP_CLIENT_ID)
      .then((naverMaps) => {
        if (cancelled) return;

        const initialId = selectedIdRef.current;
        const centerProperty = propertyById.get(initialId) ?? mappedProperties[0];
        const center = new naverMaps.LatLng(
          centerProperty.coordinates.lat,
          centerProperty.coordinates.lng,
        );

        const map = new naverMaps.Map(mapElementRef.current, {
          center,
          zoom: 11,
          minZoom: 6,
          zoomControl: true,
          zoomControlOptions: { position: naverMaps.Position.TOP_RIGHT },
          scaleControl: true,
        });

        const bounds = new naverMaps.LatLngBounds();
        const infoWindow = new naverMaps.InfoWindow({
          borderWidth: 0,
          backgroundColor: 'transparent',
          disableAnchor: true,
          pixelOffset: new naverMaps.Point(0, -12),
        });

        mappedProperties.forEach((property) => {
          const position = new naverMaps.LatLng(
            property.coordinates.lat,
            property.coordinates.lng,
          );
          const marker = new naverMaps.Marker({
            position,
            map,
            title: property.title,
            icon: {
              content: getNaverMarkerContent(property, property.id === initialId),
              anchor: new naverMaps.Point(27, 27),
            },
          });
          bounds.extend(position);
          naverMaps.Event.addListener(marker, 'click', () => onSelect(property.id));
          markerRefs.current.set(property.id, marker);
        });

        if (mappedProperties.length > 1) {
          map.fitBounds(bounds);
        }

        mapRef.current = map;
        infoWindowRef.current = infoWindow;
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[map] 네이버 지도 로드 실패:', error);
        setStatus(error.message === 'NAVER_MAP_AUTH_FAILURE' ? 'auth-error' : 'error');
      });

    return () => {
      cancelled = true;
      markerRefs.current.forEach((marker) => marker.setMap(null));
      markerRefs.current.clear();
      infoWindowRef.current?.close();
      mapRef.current = null;
    };
  }, [mappedProperties, propertyById, onSelect]);

  useEffect(() => {
    if (status !== 'ready' || !selectedId || !window.naver?.maps) return;

    const naverMaps = window.naver.maps;
    const property = propertyById.get(selectedId);
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;
    const selectedMarker = markerRefs.current.get(selectedId);
    if (!property || !map || !infoWindow || !selectedMarker) return;

    markerRefs.current.forEach((marker, propertyId) => {
      const target = propertyById.get(propertyId);
      if (!target) return;
      marker.setIcon({
        content: getNaverMarkerContent(target, propertyId === selectedId),
        anchor: new naverMaps.Point(27, 27),
      });
    });

    const position = new naverMaps.LatLng(property.coordinates.lat, property.coordinates.lng);
    map.panTo(position);
    infoWindow.setContent(getInfoWindowHtml(property));
    infoWindow.open(map, selectedMarker);
  }, [status, selectedId, propertyById]);

  if (!mappedProperties.length) {
    return (
      <div className="map-canvas map-empty">
        <div className="map-status-overlay">좌표가 등록된 매물이 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="map-canvas-wrapper">
      <div ref={mapElementRef} className="map-canvas naver-map-canvas" aria-label="네이버 지도 기반 급매 탐색" />
      {status === 'loading' && (
        <div className="map-status-overlay">네이버 지도를 불러오는 중입니다.</div>
      )}
      {status === 'auth-error' && (
        <div className="map-status-overlay">
          네이버 지도 인증에 실패했습니다. Client ID와 서비스 URL을 확인하세요.
        </div>
      )}
      {status === 'error' && (
        <div className="map-status-overlay">네이버 지도를 불러오지 못했습니다.</div>
      )}
    </div>
  );
}

/* ============================================================
 * MapLegend — 하단 범례
 * ============================================================ */
function MapLegend({ note }) {
  return (
    <div className="map-legend">
      <span><i className="legend-dot red" />10% 이상</span>
      <span><i className="legend-dot orange" />7~10%</span>
      <span><i className="legend-dot yellow" />5~7%</span>
      <span className="legend-note">
        <MapPin size={14} />
        {note}
      </span>
    </div>
  );
}

/* ============================================================
 * MapView — controlled component
 *   selectedId와 onSelect를 부모(MapPage)가 관리
 *   우선순위: Google → Naver → Mock
 * ============================================================ */
function MapView({ properties, selectedId, onSelect }) {
  if (GOOGLE_MAPS_API_KEY) {
    return (
      <div className="map-view">
        <GoogleJsMap properties={properties} selectedId={selectedId} onSelect={onSelect} />
        <MapLegend note="Google Maps JavaScript API 연동" />
      </div>
    );
  }

  if (NAVER_MAP_CLIENT_ID) {
    return (
      <div className="map-view">
        <NaverMap properties={properties} selectedId={selectedId} onSelect={onSelect} />
        <MapLegend note="Naver Maps Dynamic Map 연동" />
      </div>
    );
  }

  return (
    <div className="map-view">
      <MockMap
        properties={properties}
        selectedId={selectedId}
        onSelect={onSelect}
        note="지도 API 키 미설정 — .env.local에 VITE_GOOGLE_MAPS_API_KEY 또는 VITE_NAVER_MAP_CLIENT_ID를 추가하세요."
      />
      <MapLegend note="정식 지도 키가 설정되면 자동으로 전환됩니다." />
    </div>
  );
}

export default MapView;
