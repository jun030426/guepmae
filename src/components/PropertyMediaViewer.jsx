import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Minus, Plus, X } from 'lucide-react';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';
import { loadNaverMapSdk } from '../utils/naverMapLoader.js';
import L, { createOsmTileLayer, createSpotIcon } from '../utils/leafletLoader.js';
import { MAP_PROVIDER } from '../utils/mapProvider.js';
import { loadPannellum } from '../utils/pannellumLoader.js';
import { hasKakaoKey, loadKakaoMaps } from '../utils/kakaoLoader.js';
import { resolveMediaUrls } from '../utils/mediaUrl.js';
import { bearing, directionOf } from '../utils/panoramaTour.js';
import { formatPrice } from '../utils/priceUtils.js';
import PropertyReportPanel from './PropertyReportPanel.jsx';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const NAVER_MAP_CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;

const viewerModes = [
  { id: 'photos', label: '사진' },
  { id: 'map', label: '지도' },
  { id: 'tour', label: '360 투어' },
  { id: 'report', label: '매물 리포트' },
];

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

/* PropertyMapPanel — 우선순위: Google → Naver → 정적 fallback */
function PropertyMapPanel({ property }) {
  const coordinatesReady = hasCoordinates(property);

  if (!coordinatesReady) {
    return <MapFallback property={property} note="좌표가 등록되면 이 위치에 지도가 표시됩니다." />;
  }

  if (MAP_PROVIDER === 'google') {
    return <GoogleMapPanel property={property} />;
  }

  if (MAP_PROVIDER === 'naver') {
    return <NaverMapPanel property={property} />;
  }

  return <LeafletViewerMapPanel property={property} />;
}

/* OSM(Leaflet) — 뷰어 지도 탭 기본. 키·결제 불필요. */
function LeafletViewerMapPanel({ property }) {
  const mapElementRef = useRef(null);

  useEffect(() => {
    if (!mapElementRef.current) return undefined;
    const position = [property.coordinates.lat, property.coordinates.lng];
    const map = L.map(mapElementRef.current, {
      center: position,
      zoom: 16,
      minZoom: 10,
      zoomControl: true,
    });
    createOsmTileLayer().addTo(map);
    const marker = L.marker(position, { icon: createSpotIcon(), title: property.title }).addTo(map);
    marker
      .bindPopup(
        `<div class="viewer-map-popup"><strong>${escapeHtml(property.title)}</strong><span>${escapeHtml(
          property.address,
        )}</span></div>`,
        { closeButton: false },
      )
      .openPopup();
    return () => {
      map.remove();
    };
  }, [property]);

  return (
    <div className="viewer-map-shell">
      <div
        ref={mapElementRef}
        className="viewer-map-canvas leaflet-map-canvas"
        aria-label={`${property.title} 위치 지도`}
      />
    </div>
  );
}

function GoogleMapPanel({ property }) {
  const mapElementRef = useRef(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!mapElementRef.current) return undefined;
    let cancelled = false;
    setStatus('loading');

    loadGoogleMapSdk(GOOGLE_MAPS_API_KEY)
      .then((googleMaps) => {
        if (cancelled || !mapElementRef.current) return;
        const position = { lat: property.coordinates.lat, lng: property.coordinates.lng };
        const map = new googleMaps.Map(mapElementRef.current, {
          center: position,
          zoom: 16,
          minZoom: 10,
          mapTypeControl: false,
          streetViewControl: true,
          fullscreenControl: false,
          gestureHandling: 'greedy',
        });
        const marker = new googleMaps.Marker({
          position,
          map,
          title: property.title,
        });
        const infoWindow = new googleMaps.InfoWindow({
          content: `<div class="viewer-map-popup"><strong>${escapeHtml(property.title)}</strong><span>${escapeHtml(
            property.address,
          )}</span></div>`,
        });
        infoWindow.open({ map, anchor: marker });
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[property-map] Google Maps 로드 실패:', error);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [property]);

  if (status === 'error') {
    return <MapFallback property={property} note="Google 지도를 불러오지 못했습니다. API 키와 사용 설정을 확인하세요." />;
  }

  return (
    <div className="viewer-map-shell">
      <div ref={mapElementRef} className="viewer-map-canvas" aria-label={`${property.title} 위치 지도`} />
      {status === 'loading' && <div className="viewer-status-overlay">지도를 불러오는 중입니다.</div>}
    </div>
  );
}

function NaverMapPanel({ property }) {
  const mapElementRef = useRef(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!mapElementRef.current) return undefined;
    let cancelled = false;
    setStatus('loading');

    loadNaverMapSdk(NAVER_MAP_CLIENT_ID)
      .then((naverMaps) => {
        if (cancelled || !mapElementRef.current) return;
        const position = new naverMaps.LatLng(property.coordinates.lat, property.coordinates.lng);
        const map = new naverMaps.Map(mapElementRef.current, {
          center: position,
          zoom: 17,
          minZoom: 10,
          zoomControl: true,
          zoomControlOptions: { position: naverMaps.Position.TOP_RIGHT },
          scaleControl: true,
        });
        const marker = new naverMaps.Marker({ position, map, title: property.title });
        const infoWindow = new naverMaps.InfoWindow({
          content: `<div class="viewer-map-popup"><strong>${escapeHtml(property.title)}</strong><span>${escapeHtml(
            property.address,
          )}</span></div>`,
        });
        infoWindow.open(map, marker);
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[property-map] 네이버 지도 로드 실패:', error);
        setStatus(error.message === 'NAVER_MAP_AUTH_FAILURE' ? 'auth-error' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [property]);

  if (status === 'error' || status === 'auth-error') {
    const note =
      status === 'auth-error'
        ? '네이버 지도 인증 정보를 확인해 주세요.'
        : '네이버 지도를 불러오지 못했습니다.';
    return <MapFallback property={property} note={note} />;
  }

  return (
    <div className="viewer-map-shell">
      <div ref={mapElementRef} className="viewer-map-canvas" aria-label={`${property.title} 위치 지도`} />
      {status === 'loading' && <div className="viewer-status-overlay">지도를 불러오는 중입니다.</div>}
    </div>
  );
}

function MapFallback({ property, note }) {
  return (
    <div className="viewer-map-fallback" role="img" aria-label={`${property.title} 위치 지도 미리보기`}>
      <span className="viewer-map-road horizontal" />
      <span className="viewer-map-road vertical" />
      <span className="viewer-map-road diagonal" />
      <div className="viewer-map-marker">
        <MapPin size={24} />
      </div>
      <div className="viewer-map-label">
        <strong>{property.title}</strong>
        <span>{property.address}</span>
        <em>{note}</em>
      </div>
      <div className="viewer-map-zoom" aria-hidden="true">
        <Plus size={18} />
        <Minus size={18} />
      </div>
    </div>
  );
}

/* Model3DPanel — 중개사가 올린 .glb/.gltf 를 <model-viewer> 로 렌더.
 * 뷰어 모듈은 탭을 열 때만 동적 로드 (기본 번들 불변). */
function Model3DPanel({ property, modelUrl, modelLabel }) {
  const [loaderStatus, setLoaderStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    import('@google/model-viewer')
      .then(() => { if (!cancelled) setLoaderStatus('ready'); })
      .catch(() => { if (!cancelled) setLoaderStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  if (loaderStatus === 'error') {
    return (
      <TourFallbackPreview
        property={property}
        photos={[]}
        note="3D 뷰어를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요."
      />
    );
  }

  return (
    <div className="viewer-model-shell">
      {loaderStatus === 'ready' ? (
        <model-viewer
          src={modelUrl}
          alt={`${property.title} 3D 모델`}
          camera-controls
          auto-rotate
          auto-rotate-delay="1200"
          interaction-prompt="auto"
          shadow-intensity="1"
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <div className="viewer-status-overlay">3D 모델을 불러오는 중입니다.</div>
      )}
      <div className="viewer-model-caption">
        <strong>{modelLabel || '3D 모델'}</strong>
        <span>드래그로 회전 · 휠로 확대</span>
      </div>
    </div>
  );
}

/* PropertyTourPanel — 우선순위: 360 파노라마 투어 → .glb 3D 모델 → 외부 임베드 → 집 앞 로드뷰/사진 폴백 */
function PropertyTourPanel({ property, photos }) {
  const tour = property.tour ?? property.virtualTour ?? {};
  const embedUrl = tour.embedUrl;
  const panoramas = tour.panoramas ?? [];

  if (panoramas.length > 0) {
    return <IndoorTourPreview property={property} panoramas={panoramas} />;
  }

  if (tour.modelUrl) {
    return <Model3DPanel property={property} modelUrl={tour.modelUrl} modelLabel={tour.modelLabel} />;
  }

  if (embedUrl) {
    return (
      <div className="viewer-tour-embed-shell">
        <iframe
          src={embedUrl}
          title={`${property.title} 360 투어`}
          allow="fullscreen; xr-spatial-tracking"
          allowFullScreen
        />
      </div>
    );
  }

  return <StreetViewFallbackPanel property={property} photos={photos} />;
}

/* IndoorTourPreview — 360 파노라마 지점 이동 투어 (Pannellum 멀티 씬).
 * panoramas: buildTourPanoramas() 결과 — [{ id, src, label, order, yawOffset, links: [{ to, yaw, pitch, targetYaw, label }] }]
 * 링크는 로드뷰풍 화살표 핫스팟(cssClass tour-arrow-*)으로 그려지고, 클릭하면 해당 지점으로 이동한다.
 * src 가 idb: 참조(로컬 데모)면 object URL 로 바꿔서 넘긴다.
 * src는 equirectangular 360 이미지 URL이어야 함 */
const PANNELLUM_STRINGS = {
  loadButtonLabel: '불러오기',
  loadingLabel: '불러오는 중…',
  bylineLabel: '',
  noPanoramaError: '파노라마 이미지가 없습니다.',
  fileAccessError: '파노라마 파일을 불러올 수 없습니다: %s',
  malformedURLError: '파노라마 URL 이 올바르지 않습니다.',
  iOS8WebGLError: '이 브라우저는 360 뷰어를 지원하지 않습니다.',
  genericWebGLError: '이 브라우저는 WebGL 을 지원하지 않아 360 뷰어를 표시할 수 없습니다.',
  textureSizeError: '파노라마가 너무 큽니다 (%spx). 이 기기의 한도는 %spx 입니다.',
  unknownError: '알 수 없는 오류가 발생했습니다.',
};

function IndoorTourPreview({ property, panoramas }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [activeSceneId, setActiveSceneId] = useState(panoramas[0]?.id);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  useEffect(() => {
    if (!containerRef.current || panoramas.length === 0) return undefined;
    let cancelled = false;
    setStatus('loading');
    const container = containerRef.current;

    Promise.all([loadPannellum(), resolveMediaUrls(panoramas.map((pano) => pano.src))])
      .then(([pannellum, urls]) => {
        if (cancelled || !containerRef.current) return;

        const ids = new Set(panoramas.map((pano) => pano.id));
        const scenes = {};
        panoramas.forEach((pano, index) => {
          if (!urls[index]) return; // 로컬 저장소에서 사라진 사진은 건너뛴다
          scenes[pano.id] = {
            type: 'equirectangular',
            panorama: urls[index],
            title: pano.label,
            yaw: pano.yawOffset ?? 0,
            pitch: 0,
            hotSpots: (pano.links ?? [])
              .filter((link) => ids.has(link.to) && link.to !== pano.id)
              .map((link) => ({
                type: 'scene',
                sceneId: link.to,
                yaw: link.yaw,
                pitch: link.pitch,
                targetYaw: link.targetYaw ?? 0,
                targetPitch: 0,
                text: link.label || undefined,
                cssClass: `tour-arrow tour-arrow-${directionOf(link.yaw)}`,
              })),
          };
        });
        const firstScene = panoramas.find((pano) => scenes[pano.id])?.id;
        if (!firstScene) {
          setStatus('error');
          return;
        }

        viewerRef.current = pannellum.viewer(container, {
          default: {
            firstScene,
            // 크로스페이드는 현재 화면 스냅샷을 쓰므로 컨테이너 폭이 0(숨김 상태)이면 빈 이미지에 걸려 전환이 멈춘다.
            // 그 경우 페이드 없이 즉시 전환한다.
            sceneFadeDuration: container.clientWidth > 0 ? 600 : 0,

            autoLoad: true,
            hfov: 100,
            showControls: true,
            showZoomCtrl: true,
            showFullscreenCtrl: false,
            compass: false,
          },
          strings: PANNELLUM_STRINGS,
          scenes,
        });
        viewerRef.current.on('scenechange', (sceneId) => setActiveSceneId(sceneId));
        viewerRef.current.on('load', () => setStatus('ready'));
        viewerRef.current.on('error', () => setStatus('error'));
        setActiveSceneId(firstScene);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[indoor-tour] 360 뷰어 로드 실패:', error);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          // ignore — pannellum이 이미 컨테이너를 비웠을 수도 있음
        }
        viewerRef.current = null;
      }
    };
  }, [panoramas]);

  const activeScene = panoramas.find((pano) => pano.id === activeSceneId) ?? panoramas[0];
  const goTo = (sceneId) => {
    if (!viewerRef.current || sceneId === activeSceneId) return;
    try {
      viewerRef.current.loadScene(sceneId);
    } catch {
      // ignore — 아직 로드 전이면 무시
    }
  };

  if (!activeScene) {
    return null;
  }

  return (
    <div className="viewer-indoor-tour">
      <div
        ref={containerRef}
        className="indoor-tour-canvas"
        aria-label={`${property.title} ${activeScene.label ?? '실내'} 360 투어`}
      />
      {status === 'loading' && <div className="viewer-status-overlay">360 투어를 불러오는 중입니다.</div>}
      {status === 'error' && (
        <div className="viewer-status-overlay">360 뷰어를 표시할 수 없습니다. 네트워크와 브라우저(WebGL) 지원을 확인하세요.</div>
      )}
      <div className="indoor-tour-copy">
        <strong>{activeScene.label ?? '실내 360 투어'}</strong>
        <span>
          {panoramas.length > 1
            ? '화살표를 누르면 다음 지점으로 이동 · 드래그로 둘러보기 · 휠로 줌'
            : '마우스 드래그로 둘러보기 · 휠로 줌'}
          {activeScene.stitched === 'browser' && ' · 카메라 원본을 자동 변환한 사진이라 이음새가 보일 수 있습니다'}
        </span>
      </div>
      {panoramas.length > 1 && (
        <div className="indoor-tour-scenes" aria-label="실내 투어 지점 선택">
          {panoramas.map((pano) => (
            <button
              type="button"
              key={pano.id}
              className={pano.id === activeScene.id ? 'active' : ''}
              onClick={() => goTo(pano.id)}
            >
              {pano.label ?? '지점'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* StreetViewFallbackPanel — 우선순위: 카카오 로드뷰(키 있음) → Google → Naver → 사진 fallback
 * 360 투어 데이터가 없을 때 보이는 화면. 집 앞 거리뷰로 위치감을 전달. */
function StreetViewFallbackPanel({ property, photos }) {
  const coordinatesReady = hasCoordinates(property);

  if (!coordinatesReady) {
    return (
      <TourFallbackPreview
        property={property}
        photos={photos}
        note="실내 360 투어가 아직 없고 좌표도 없어 등록 사진으로 위치감을 먼저 보여드립니다."
      />
    );
  }

  if (hasKakaoKey) {
    return <KakaoRoadviewPanel property={property} photos={photos} />;
  }

  if (MAP_PROVIDER === 'google') {
    return <GoogleStreetViewPanel property={property} photos={photos} />;
  }

  if (MAP_PROVIDER === 'naver') {
    return <NaverStreetViewPanel property={property} photos={photos} />;
  }

  return (
    <TourFallbackPreview
      property={property}
      photos={photos}
      note="실내 360 투어가 아직 없어 등록 사진으로 먼저 보여드립니다."
    />
  );
}

/* KakaoRoadviewPanel — 집 앞 카카오 로드뷰 (VITE_KAKAO_APP_KEY 있을 때).
 * 반경 50m → 150m 순으로 가장 가까운 로드뷰 지점을 찾고, 시선(pan)을 매물 좌표 쪽으로 맞춘다.
 * 로드뷰가 없는 위치(단지 안쪽 도로 등)는 사진 폴백으로 정직하게 넘어간다. */
function KakaoRoadviewPanel({ property, photos }) {
  const roadviewElementRef = useRef(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'no-coverage' | 'error'

  useEffect(() => {
    if (!roadviewElementRef.current) return undefined;
    let cancelled = false;
    setStatus('loading');
    const target = { lat: property.coordinates.lat, lng: property.coordinates.lng };

    loadKakaoMaps()
      .then((maps) => {
        if (cancelled || !roadviewElementRef.current) return undefined;
        const position = new maps.LatLng(target.lat, target.lng);
        const client = new maps.RoadviewClient();
        const nearest = (radius) =>
          new Promise((resolve) => {
            client.getNearestPanoId(position, radius, (panoId) => resolve(panoId || null));
          });
        return nearest(50)
          .then((panoId) => panoId ?? nearest(150))
          .then((panoId) => {
            if (cancelled || !roadviewElementRef.current) return;
            if (!panoId) {
              setStatus('no-coverage');
              return;
            }
            const roadview = new maps.Roadview(roadviewElementRef.current);
            maps.event.addListener(roadview, 'init', () => {
              if (cancelled) return;
              try {
                const at = roadview.getPosition();
                const pan = bearing({ lat: at.getLat(), lng: at.getLng() }, target);
                roadview.setViewpoint({ pan, tilt: 0, zoom: 0 });
              } catch {
                // 시선 보정 실패는 치명적이지 않다 — 기본 시선으로 둔다
              }
            });
            roadview.setPanoId(panoId, position);
            setStatus('ready');
          });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[property-tour] 카카오 로드뷰 로드 실패:', error);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [property]);

  if (status === 'no-coverage' || status === 'error') {
    const note =
      status === 'no-coverage'
        ? '이 위치는 로드뷰가 없어 등록 사진으로 위치감을 먼저 보여드립니다. 단지 안쪽 도로는 로드뷰가 없는 경우가 많습니다.'
        : '로드뷰를 불러오지 못해 등록 사진으로 위치감을 먼저 보여드립니다.';
    return <TourFallbackPreview property={property} photos={photos} note={note} />;
  }

  return (
    <div className="viewer-street-shell">
      <div
        ref={roadviewElementRef}
        className="viewer-street-canvas"
        aria-label={`${property.title} 집 앞 로드뷰`}
      />
      {status === 'loading' && <div className="viewer-status-overlay">집 앞 로드뷰를 불러오는 중입니다.</div>}
      <div className="street-location-card">
        <strong>{property.title}</strong>
        <span>{property.address}</span>
        <em>실내 360 투어가 아직 없어 집 앞 로드뷰를 보여드립니다 · 로드뷰 © Kakao</em>
      </div>
    </div>
  );
}

function GoogleStreetViewPanel({ property, photos }) {

  const panoramaElementRef = useRef(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'no-coverage' | 'error'

  useEffect(() => {
    if (!panoramaElementRef.current) return undefined;
    let cancelled = false;
    setStatus('loading');

    loadGoogleMapSdk(GOOGLE_MAPS_API_KEY)
      .then((googleMaps) => {
        if (cancelled || !panoramaElementRef.current) return;
        const position = { lat: property.coordinates.lat, lng: property.coordinates.lng };
        const service = new googleMaps.StreetViewService();
        service.getPanorama(
          { location: position, radius: 200, source: googleMaps.StreetViewSource?.OUTDOOR ?? 'default' },
          (data, statusCode) => {
            if (cancelled || !panoramaElementRef.current) return;
            if (statusCode === googleMaps.StreetViewStatus.OK) {
              new googleMaps.StreetViewPanorama(panoramaElementRef.current, {
                position: data.location.latLng,
                pov: { heading: 0, pitch: 0 },
                zoom: 1,
                addressControl: false,
                fullscreenControl: false,
                motionTracking: false,
                motionTrackingControl: false,
              });
              setStatus('ready');
            } else {
              setStatus('no-coverage');
            }
          },
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[property-tour] Google Street View 로드 실패:', error);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [property]);

  if (status === 'no-coverage' || status === 'error') {
    const note =
      status === 'no-coverage'
        ? '이 위치는 Google 거리뷰가 지원되지 않아 등록 사진으로 위치감을 먼저 보여드립니다.'
        : 'Google 거리뷰를 불러오지 못해 등록 사진으로 위치감을 먼저 보여드립니다.';
    return <TourFallbackPreview property={property} photos={photos} note={note} />;
  }

  return (
    <div className="viewer-street-shell">
      <div
        ref={panoramaElementRef}
        className="viewer-street-canvas"
        aria-label={`${property.title} 집 앞 거리뷰`}
      />
      {status === 'loading' && <div className="viewer-status-overlay">집 앞 거리뷰를 불러오는 중입니다.</div>}
    </div>
  );
}

function NaverStreetViewPanel({ property, photos }) {
  const panoramaElementRef = useRef(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!panoramaElementRef.current) return undefined;
    let cancelled = false;
    setStatus('loading');

    loadNaverMapSdk(NAVER_MAP_CLIENT_ID)
      .then((naverMaps) => {
        if (cancelled || !panoramaElementRef.current) return;
        if (!naverMaps.Panorama) {
          throw new Error('NAVER_PANORAMA_UNAVAILABLE');
        }
        const position = new naverMaps.LatLng(property.coordinates.lat, property.coordinates.lng);
        new naverMaps.Panorama(panoramaElementRef.current, {
          position,
          pov: { pan: 20, tilt: 0, fov: 95 },
          aroundControl: true,
          logoControl: true,
        });
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[property-tour] 네이버 거리뷰 로드 실패:', error);
        setStatus(error.message === 'NAVER_MAP_AUTH_FAILURE' ? 'auth-error' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [property]);

  if (status === 'error' || status === 'auth-error') {
    return (
      <TourFallbackPreview
        property={property}
        photos={photos}
        note="네이버 거리뷰를 불러오지 못해 등록 사진으로 위치감을 먼저 보여드립니다."
      />
    );
  }

  return (
    <div className="viewer-street-shell">
      <div
        ref={panoramaElementRef}
        className="viewer-street-canvas"
        aria-label={`${property.title} 집 앞 거리뷰`}
      />
      {status === 'loading' && <div className="viewer-status-overlay">집 앞 거리뷰를 불러오는 중입니다.</div>}
    </div>
  );
}

function TourFallbackPreview({ property, photos, note }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const activePhoto = photos[photoIndex] ?? photos[0];

  const movePhoto = (offset) => {
    setPhotoIndex((current) => (current + offset + photos.length) % photos.length);
  };

  return (
    <div className="viewer-street-fallback">
      {activePhoto && (
        <img src={activePhoto.src} alt={`${property.title} ${activePhoto.label ?? '등록 사진'}`} />
      )}
      <div className="street-location-card">
        <strong>{property.title}</strong>
        <span>{property.address}</span>
        <em>{note}</em>
      </div>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            className="street-arrow prev"
            aria-label="이전 사진"
            onClick={() => movePhoto(-1)}
          >
            <ChevronLeft size={28} />
          </button>
          <button
            type="button"
            className="street-arrow next"
            aria-label="다음 사진"
            onClick={() => movePhoto(1)}
          >
            <ChevronRight size={28} />
          </button>
          <span className="street-photo-count" aria-live="polite">
            {photoIndex + 1} / {photos.length}
          </span>
        </>
      )}
    </div>
  );
}

function PropertyPhotoGrid({ photos, property }) {
  return (
    <div className="viewer-photo-grid">
      {photos.map((photo, index) => (
        <figure key={`${photo.src}-${index}`} className="viewer-photo-card">
          <img src={photo.src} alt={photo.alt} loading={index < 6 ? 'eager' : 'lazy'} />
          <figcaption>
            {index + 1}. {photo.label}
          </figcaption>
        </figure>
      ))}
      <span className="viewer-photo-note">{property.title} 등록 사진</span>
    </div>
  );
}

function PropertyMediaViewer({ property, photos, initialMode, onClose }) {
  const [mode, setMode] = useState(initialMode);
  const summary = useMemo(
    () => [
      formatPrice(property.price),
      `방 ${property.rooms}개`,
      `욕실 ${property.bathrooms}개`,
      `${property.area}㎡`,
    ],
    [property],
  );

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <section className="property-media-viewer" role="dialog" aria-modal="true" aria-label={`${property.title} 미디어 보기`}>
      <header className="viewer-header">
        <div className="viewer-title-block">
          <h2>{property.title}</h2>
          <p>
            {summary.map((item, index) => (
              <span key={item}>
                {item}
                {index < summary.length - 1 && <i>|</i>}
              </span>
            ))}
          </p>
        </div>

        <div className="viewer-mode-tabs" role="tablist" aria-label="미디어 종류">
          {viewerModes.map((item) => (
            <button
              type="button"
              key={item.id}
              className={mode === item.id ? 'active' : ''}
              onClick={() => setMode(item.id)}
              role="tab"
              aria-selected={mode === item.id}
              aria-controls="viewer-media-panel"
            >
              {item.label}
            </button>
          ))}
        </div>

        <button type="button" className="viewer-close-button" aria-label="닫기" onClick={onClose}>
          <X size={30} />
        </button>
      </header>

      <main className="viewer-body" id="viewer-media-panel" role="tabpanel">
        {mode === 'photos' && <PropertyPhotoGrid photos={photos} property={property} />}
        {mode === 'map' && <PropertyMapPanel property={property} />}
        {mode === 'tour' && <PropertyTourPanel property={property} photos={photos} />}
        {mode === 'report' && <PropertyReportPanel property={property} />}
      </main>
    </section>
  );
}

export default PropertyMediaViewer;
