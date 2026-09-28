import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';
import { loadNaverMapSdk } from '../utils/naverMapLoader.js';
import L, { createOsmTileLayer } from '../utils/leafletLoader.js';
import { MAP_PROVIDER, GOOGLE_MAPS_API_KEY, NAVER_MAP_CLIENT_ID } from '../utils/mapProvider.js';
import { formatPrice } from '../utils/priceUtils.js';
import { MARKER_HOT, MARKER_WARM, MARKER_MILD } from '../styles/tokens.js';

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

/*
 * 알약 마커 SVG data URL 생성.
 * - 비활성: 72×30 알약 + 얇은 반투명 흰테 (그림자 없음, 캔버스도 72×30)
 * - 활성:   86×36 알약(1.2배) + 굵은 흰테 4px + drop-shadow.
 *   그림자가 잘리지 않도록 SVG 캔버스를 96×46(여백 5px)으로 키우고
 *   알약을 그 중앙에 배치. 등급색(fillColor)은 그대로 유지 — 선택은 색이 아니라 형태로 표현.
 *   marker setIcon의 scaledSize/anchor도 96×46 / (48,23)으로 분기 필요.
 */
function buildPillIconDataUrl(text, fillColor, active = false) {
  const pillW = active ? 86 : 72;
  const pillH = active ? 36 : 30;
  const padding = active ? 5 : 0;
  const svgW = pillW + padding * 2;
  const svgH = pillH + padding * 2;
  const stroke = active ? '#ffffff' : 'rgba(255,255,255,0.85)';
  const strokeWidth = active ? 4 : 2;
  const fontSize = active ? 16 : 13;
  const filterDef = active
    ? '<defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.35"/></filter></defs>'
    : '';
  const filterAttr = active ? ' filter="url(#s)"' : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">` +
    filterDef +
    `<rect x="${padding + strokeWidth / 2}" y="${padding + strokeWidth / 2}" width="${
      pillW - strokeWidth
    }" height="${pillH - strokeWidth}" rx="${(pillH - strokeWidth) / 2}" fill="${fillColor}" stroke="${stroke}" stroke-width="${strokeWidth}"${filterAttr}/>` +
    `<text x="${svgW / 2}" y="${svgH / 2 + (active ? 5 : 4)}" font-family="Pretendard, -apple-system, system-ui, sans-serif" font-size="${fontSize}" font-weight="600" fill="#ffffff" text-anchor="middle">${escapeHtml(
      text,
    )}</text>` +
    `</svg>`;
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
 * LeafletMap — OpenStreetMap 기반 무료 지도 (기본 제공자)
 * 키·계정·결제 없이 동작. 마커/클러스터/선택 동작은 Google 구현과 동일한 언어.
 * ============================================================ */
function buildLeafletPillIcon(property, active) {
  const tone = getMarkerTone(property.discountRate);
  return L.icon({
    iconUrl: buildPillIconDataUrl(
      formatDiscount(property.discountRate),
      MARKER_COLORS[tone],
      active,
    ),
    iconSize: active ? [96, 46] : [72, 30],
    iconAnchor: active ? [48, 23] : [36, 15],
    popupAnchor: [0, active ? -20 : -14],
  });
}

function buildClusterIcon(cluster) {
  const rates = cluster
    .getAllChildMarkers()
    .map((marker) => marker.options.discountRate)
    .filter((rate) => typeof rate === 'number');
  const mean = rates.length > 0 ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : 0;
  const fill = MARKER_COLORS[getMarkerTone(mean)];
  const count = cluster.getChildCount();
  return L.divIcon({
    className: 'map-cluster-icon',
    iconSize: [44, 44],
    html:
      `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">` +
      `<circle cx="22" cy="22" r="20" fill="${fill}" stroke="#ffffff" stroke-width="2"/>` +
      `<text x="22" y="26" font-family="Pretendard, -apple-system, system-ui, sans-serif" font-size="12" font-weight="600" fill="#ffffff" text-anchor="middle">${count}</text>` +
      `</svg>`,
  });
}

function LeafletMap({ properties, selectedId, onSelect }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const clusterRef = useRef(null);
  const markerRefs = useRef(new Map());
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
    if (!mapElementRef.current || !mappedProperties.length) return undefined;

    const initialId = selectedIdRef.current;
    const centerProperty = propertyById.get(initialId) ?? mappedProperties[0];
    const center = centerProperty
      ? [centerProperty.coordinates.lat, centerProperty.coordinates.lng]
      : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];

    const map = L.map(mapElementRef.current, {
      center,
      zoom: 11,
      minZoom: 6,
      zoomControl: true,
    });
    createOsmTileLayer().addTo(map);

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 60,
      showCoverageOnHover: false,
      iconCreateFunction: buildClusterIcon,
    });

    const bounds = L.latLngBounds([]);
    mappedProperties.forEach((property) => {
      const position = [property.coordinates.lat, property.coordinates.lng];
      const active = property.id === initialId;
      const marker = L.marker(position, {
        icon: buildLeafletPillIcon(property, active),
        title: property.title,
        zIndexOffset: active ? 1500 : 0,
        discountRate: property.discountRate, // 클러스터 평균색 계산용
      });
      marker.bindPopup(getInfoWindowHtml(property), { closeButton: true });
      marker.on('click', () => onSelect(property.id));
      markerRefs.current.set(property.id, marker);
      cluster.addLayer(marker);
      bounds.extend(position);
    });

    map.addLayer(cluster);
    if (mappedProperties.length > 1) {
      map.fitBounds(bounds, { padding: [60, 60] });
      if (map.getZoom() > 12) map.setZoom(12);
    }

    mapRef.current = map;
    clusterRef.current = cluster;
    setStatus('ready');

    return () => {
      markerRefs.current.clear();
      clusterRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [mappedProperties, propertyById, onSelect]);

  // 선택 변경: 마커 아이콘 토글 + 지도 이동 + 팝업
  useEffect(() => {
    if (status !== 'ready' || !selectedId) return;
    const map = mapRef.current;
    const property = propertyById.get(selectedId);
    const selectedMarker = markerRefs.current.get(selectedId);
    if (!map || !property || !selectedMarker) return;

    markerRefs.current.forEach((marker, propertyId) => {
      const target = propertyById.get(propertyId);
      if (!target) return;
      const isActive = propertyId === selectedId;
      marker.setIcon(buildLeafletPillIcon(target, isActive));
      marker.setZIndexOffset(isActive ? 1500 : 0);
    });

    const position = [property.coordinates.lat, property.coordinates.lng];
    const targetZoom = Math.max(map.getZoom(), 15);
    map.setView(position, targetZoom, { animate: true });
    // 클러스터에 묶여 있으면 풀어서 마커를 드러낸 뒤 팝업
    const cluster = clusterRef.current;
    if (cluster) {
      cluster.zoomToShowLayer(selectedMarker, () => selectedMarker.openPopup());
    } else {
      selectedMarker.openPopup();
    }
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
      <div
        ref={mapElementRef}
        className="map-canvas leaflet-map-canvas"
        aria-label="OpenStreetMap 기반 급매 탐색"
      />
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
          // 활성 마커는 86×36 알약 + 그림자 여백 5px → SVG 96×46, anchor 중앙(48,23)
          const marker = new googleMaps.Marker({
            position,
            title: property.title,
            zIndex: active ? 1500 : undefined, // 활성 마커가 항상 다른 마커 위로
            icon: {
              url: iconUrl,
              scaledSize: new googleMaps.Size(active ? 96 : 72, active ? 46 : 30),
              anchor: new googleMaps.Point(active ? 48 : 36, active ? 23 : 15),
            },
          });
          // clusterer가 평균 할인율로 묶음 색을 정할 때 자식 마커에서 꺼내 씀
          marker.set('discountRate', property.discountRate);

          bounds.extend(position);
          marker.addListener('click', () => onSelect(property.id));
          markerRefs.current.set(property.id, marker);
          markersArr.push(marker);
        });

        // 마커가 많을 때 줌 아웃 시 군집 표시
        // 묶음 색 = 자식 매물들의 할인율 단순 평균 → 등급(hot/warm/mild) 매핑
        clustererRef.current = new MarkerClusterer({
          map,
          markers: markersArr,
          renderer: {
            render: ({ count, position, markers }) => {
              const rates = markers
                .map((m) => m.get('discountRate'))
                .filter((r) => typeof r === 'number');
              const mean =
                rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
              const tone = getMarkerTone(mean);
              const fill = MARKER_COLORS[tone];
              return new googleMaps.Marker({
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
                      `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="${fill}" stroke="#ffffff" stroke-width="2"/></svg>`,
                    ),
                  scaledSize: new googleMaps.Size(44, 44),
                  anchor: new googleMaps.Point(22, 22),
                },
                zIndex: 1000 + count,
              });
            },
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

    // 모든 마커 아이콘 재생성 (활성화 표시 갱신) + zIndex 토글
    markerRefs.current.forEach((marker, propertyId) => {
      const target = propertyById.get(propertyId);
      if (!target) return;
      const tone = getMarkerTone(target.discountRate);
      const isActive = propertyId === selectedId;
      marker.setIcon({
        url: buildPillIconDataUrl(
          formatDiscount(target.discountRate),
          MARKER_COLORS[tone],
          isActive,
        ),
        scaledSize: new googleMaps.Size(isActive ? 96 : 72, isActive ? 46 : 30),
        anchor: new googleMaps.Point(isActive ? 48 : 36, isActive ? 23 : 15),
      });
      marker.setZIndex(isActive ? 1500 : null);
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
      {/* 배지 체계와 동일한 축: 5%+ = 급매, 10%+ = 초급매. 마커는 할인이 깊을수록 진한 초록. */}
      <span><i className="legend-dot red" />초급매 10%+</span>
      <span><i className="legend-dot orange" />급매 7~10%</span>
      <span><i className="legend-dot yellow" />급매 5~7%</span>
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
  if (MAP_PROVIDER === 'google') {
    return (
      <div className="map-view">
        <GoogleJsMap properties={properties} selectedId={selectedId} onSelect={onSelect} />
        <MapLegend note="Google Maps JavaScript API 연동" />
      </div>
    );
  }

  if (MAP_PROVIDER === 'naver') {
    return (
      <div className="map-view">
        <NaverMap properties={properties} selectedId={selectedId} onSelect={onSelect} />
        <MapLegend note="Naver Maps Dynamic Map 연동" />
      </div>
    );
  }

  return (
    <div className="map-view">
      <LeafletMap properties={properties} selectedId={selectedId} onSelect={onSelect} />
      <MapLegend note="OpenStreetMap 연동" />
    </div>
  );
}

export default MapView;
