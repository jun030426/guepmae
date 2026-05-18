import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Expand, FileText, MapPin, Minus, Plus, Sparkles, X } from 'lucide-react';
import { loadGoogleMapSdk } from '../utils/googleMapLoader.js';
import { loadNaverMapSdk } from '../utils/naverMapLoader.js';
import { loadPannellum } from '../utils/pannellumLoader.js';
import { formatPrice } from '../utils/priceUtils.js';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const NAVER_MAP_CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;

const viewerModes = [
  { id: 'photos', label: '사진' },
  { id: 'map', label: '지도' },
  { id: 'tour', label: '3D 투어' },
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

  if (GOOGLE_MAPS_API_KEY) {
    return <GoogleMapPanel property={property} />;
  }

  if (NAVER_MAP_CLIENT_ID) {
    return <NaverMapPanel property={property} />;
  }

  return <MapFallback property={property} note="지도 API 키가 없어 좌표 기반 미리보기로 표시합니다." />;
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

function PropertyTourPanel({ property, photos }) {
  const tour = property.tour ?? property.virtualTour ?? {};
  const embedUrl = tour.embedUrl;
  const panoramas = tour.panoramas ?? [];

  if (embedUrl) {
    return (
      <div className="viewer-tour-embed-shell">
        <iframe
          src={embedUrl}
          title={`${property.title} 3D 투어`}
          allow="fullscreen; xr-spatial-tracking"
          allowFullScreen
        />
      </div>
    );
  }

  if (panoramas.length > 0) {
    return <IndoorTourPreview property={property} panoramas={panoramas} />;
  }

  return <StreetViewFallbackPanel property={property} photos={photos} />;
}

/* IndoorTourPreview — 실내 360 파노라마가 등록된 매물에서 활성화
 * panoramas: [{ id, src, label, initialYaw?, initialPitch? }]
 * src는 equirectangular 360 이미지 URL이어야 함 */
function IndoorTourPreview({ property, panoramas }) {
  const [activeSceneId, setActiveSceneId] = useState(panoramas[0]?.id);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [status, setStatus] = useState('idle');

  const activeScene = panoramas.find((panorama) => panorama.id === activeSceneId) ?? panoramas[0];

  useEffect(() => {
    if (!containerRef.current || !activeScene) return undefined;
    let cancelled = false;
    setStatus('loading');

    loadPannellum()
      .then((pannellum) => {
        if (cancelled || !containerRef.current) return;

        // 이전 뷰어 정리
        if (viewerRef.current) {
          try {
            viewerRef.current.destroy();
          } catch {
            // ignore — pannellum이 이미 컨테이너를 비웠을 수도 있음
          }
          viewerRef.current = null;
        }

        viewerRef.current = pannellum.viewer(containerRef.current, {
          type: 'equirectangular',
          panorama: activeScene.src,
          autoLoad: true,
          showControls: true,
          showZoomCtrl: true,
          showFullscreenCtrl: false,
          compass: false,
          hfov: 110,
          yaw: activeScene.initialYaw ?? 0,
          pitch: activeScene.initialPitch ?? 0,
        });

        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[indoor-tour] Pannellum 로드 실패:', error);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          // ignore
        }
        viewerRef.current = null;
      }
    };
  }, [activeScene]);

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
        <div className="viewer-status-overlay">360 뷰어 로드에 실패했습니다. 네트워크를 확인하세요.</div>
      )}
      <div className="indoor-tour-copy">
        <strong>{activeScene.label ?? '실내 360 투어'}</strong>
        <span>마우스 드래그로 둘러보기 · 휠로 줌</span>
      </div>
      {panoramas.length > 1 && (
        <div className="indoor-tour-scenes" aria-label="실내 투어 공간 선택">
          {panoramas.map((panorama) => (
            <button
              type="button"
              key={panorama.id}
              className={panorama.id === activeScene.id ? 'active' : ''}
              onClick={() => setActiveSceneId(panorama.id)}
            >
              {panorama.label ?? '공간'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* StreetViewFallbackPanel — 우선순위: Google → Naver → 사진 fallback
 * 3D 투어 데이터가 없을 때 보이는 화면. 집 앞 거리뷰로 위치감을 전달. */
function StreetViewFallbackPanel({ property, photos }) {
  const coordinatesReady = hasCoordinates(property);

  if (!coordinatesReady) {
    return (
      <TourFallbackPreview
        property={property}
        photos={photos}
        note="실내 3D 투어가 아직 없고 좌표도 없어 등록 사진으로 위치감을 먼저 보여드립니다."
      />
    );
  }

  if (GOOGLE_MAPS_API_KEY) {
    return <GoogleStreetViewPanel property={property} photos={photos} />;
  }

  if (NAVER_MAP_CLIENT_ID) {
    return <NaverStreetViewPanel property={property} photos={photos} />;
  }

  return (
    <TourFallbackPreview
      property={property}
      photos={photos}
      note="지도 API 키가 없어 집 앞 거리뷰 대신 등록 사진으로 먼저 보여드립니다."
    />
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
        ? '이 위치는 Google 거리뷰가 지원되지 않아 등록 사진으로 위치감을 먼저 보여드립니다. (네이버 거리뷰 연동 예정)'
        : 'Google 거리뷰를 불러오지 못해 등록 사진으로 위치감을 먼저 보여드립니다.';
    return <TourFallbackPreview property={property} photos={photos} note={note} />;
  }

  return (
    <div className="viewer-street-shell">
      <div className="tour-fallback-banner">
        <strong>3D 투어 준비 중</strong>
        <span>실내 3D 투어가 아직 등록되지 않아 Google 거리뷰로 집 앞 풍경을 보여드립니다.</span>
      </div>
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
      <div className="tour-fallback-banner">
        <strong>3D 투어 준비 중</strong>
        <span>실내 3D 투어가 아직 등록되지 않아 네이버 거리뷰로 집 앞 풍경을 보여드립니다.</span>
      </div>
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
  const streetPhoto = photos[0] ?? photos[1];

  return (
    <div className="viewer-street-fallback">
      {streetPhoto && <img src={streetPhoto.src} alt={`${property.title} 외부 사진`} />}
      <div className="street-location-card">
        <strong>3D 투어 준비 중</strong>
        <span>{property.address}</span>
        <em>{note}</em>
      </div>
      <button type="button" className="street-expand-button" aria-label="확대">
        <Expand size={20} />
      </button>
      <div className="street-arrows" aria-hidden="true">
        <span>&lt;</span>
        <span>&gt;</span>
      </div>
      <div className="street-compass" aria-hidden="true">
        <Compass size={24} />
      </div>
      <div className="street-zoom" aria-hidden="true">
        <Plus size={18} />
        <Minus size={18} />
      </div>
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

// AI 매물 리포트 — 향후 Vercel AI Gateway 연결 예정. 현재는 placeholder
function PropertyReportPanel({ property }) {
  return (
    <div className="viewer-report-placeholder">
      <div className="viewer-report-icon" aria-hidden="true">
        <Sparkles size={36} />
      </div>
      <h3>매물 리포트 — 곧 출시 예정</h3>
      <p>
        AI가 <strong>{property.title}</strong> 의 시세, 입지, 단지 특성, 인근 거래 패턴을 종합 분석해서
        이 매물의 강점과 주의할 점을 한눈에 정리해드릴 예정입니다.
      </p>
      <ul>
        <li>
          <FileText size={15} />
          한 줄 평가 — 추천 대상 / 강점 / 주의할 점
        </li>
        <li>
          <FileText size={15} />
          시세 분석 — 인근 같은 평형 비교 + 해석
        </li>
        <li>
          <FileText size={15} />
          생활권 점수 — 출퇴근/학군/생활편의/자산가치 잠재력
        </li>
      </ul>
      <p className="viewer-report-coming-soon">2026년 상반기 출시 예정</p>
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
              aria-selected={mode === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button type="button" className="viewer-close-button" aria-label="닫기" onClick={onClose}>
          <X size={30} />
        </button>
      </header>

      <main className="viewer-body">
        {mode === 'photos' && <PropertyPhotoGrid photos={photos} property={property} />}
        {mode === 'map' && <PropertyMapPanel property={property} />}
        {mode === 'tour' && <PropertyTourPanel property={property} photos={photos} />}
        {mode === 'report' && <PropertyReportPanel property={property} />}
      </main>
    </section>
  );
}

export default PropertyMediaViewer;
