import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bath,
  BedDouble,
  CalendarCheck,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Heart,
  LayoutGrid,
  Mail,
  Map,
  MapPin,
  Phone,
  Ruler,
  Share2,
  ShieldCheck,
  TrendingDown,
  X,
} from 'lucide-react';
import PropertyMediaViewer from '../components/PropertyMediaViewer.jsx';
import PropertyLocationMap from '../components/PropertyLocationMap.jsx';
import PriceReport from '../components/PriceReport.jsx';
import InspectionChecklist from '../components/InspectionChecklist.jsx';
import UrgentBadge from '../components/UrgentBadge.jsx';
import { useProperty } from '../hooks/useProperties.js';
import { formatArea, formatPrice } from '../utils/priceUtils.js';
import { getPropertyPhotos } from '../utils/propertyMedia.js';
import { isSaved, toggleSaved } from '../utils/savedProperties.js';
import { hasPriceConflict } from '../utils/priceEvidence.js';

// 탭 순서는 페이지 DOM의 섹션 순서와 동일해야 함 (스크롤 흐름과 일치)
const detailTabs = [
  ['개요', '#overview'],
  ['가격 리포트', '#price-report'],
  ['매물 정보', '#property-info'],
  ['점검', '#inspection'],
  ['위치', '#location'],
  ['생활권', '#lifestyle'],
  ['문의', '#agent'],
];

function formatKoreanDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getDaysSince(dateString) {
  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return 1;
  }

  const difference = Date.now() - date.getTime();
  return Math.max(1, Math.ceil(difference / (1000 * 60 * 60 * 24)));
}

function PropertyDetail() {
  const { id } = useParams();
  const { property } = useProperty(id);
  // 매물 등록 직후 진입(?just_registered=1) — 중개사의 첫 성공 순간을 확인해주는 배너.
  // URL 파라미터 기반이라 재방문·새로고침(닫기 후)에는 다시 뜨지 않음.
  const [searchParams, setSearchParams] = useSearchParams();
  const justRegistered = searchParams.get('just_registered') === '1';

  const dismissRegisteredBanner = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('just_registered');
    setSearchParams(next, { replace: true });
  };
  const photos = useMemo(() => (property ? getPropertyPhotos(property, 12) : []), [property]);
  const [activePhoto, setActivePhoto] = useState(0);
  const [viewerMode, setViewerMode] = useState(null);
  const thumbnailTrackRef = useRef(null);
  // 저장(찜) — localStorage 영속, 로그인 불필요
  const [saved, setSaved] = useState(false);
  // 공유 피드백 — '복사됨' 2초 표시
  const [shareCopied, setShareCopied] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    setActivePhoto(0);
    setSaved(isSaved(id));
  }, [id]);

  // 앵커 탭 — React Router가 네이티브 해시 스크롤을 삼키므로 직접 스크롤한다.
  // (스크롤 오프셋은 CSS scroll-margin-top이 담당)
  const handleAnchorClick = (event, href) => {
    const target = document.getElementById(href.slice(1));
    if (!target) return; // 섹션이 없으면 기본 동작에 맡긴다
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', href);
  };

  // 목록 카드의 '문의하기'처럼 해시를 달고 진입한 경우 — 데이터 렌더 후 해당 섹션으로 이동
  useEffect(() => {
    if (!property) return undefined;
    const hash = window.location.hash;
    if (!hash) return undefined;
    const timer = setTimeout(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => clearTimeout(timer);
  }, [property]);

  // 현재 보고 있는 섹션을 탭에 반영 — 긴 페이지에서 현재 위치를 알려주는 유일한 단서
  useEffect(() => {
    if (!property) return undefined;
    const sections = detailTabs
      .map(([, href]) => document.getElementById(href.slice(1)))
      .filter(Boolean);
    if (sections.length === 0) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-150px 0px -70% 0px', threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [property]);

  const handleToggleSave = () => {
    setSaved(toggleSaved(id));
  };

  const handleShare = async () => {
    const url = window.location.href;
    const title = property ? `${property.title} — 급매` : '급매';
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (shareError) {
      // 사용자가 공유 시트를 닫은 경우(AbortError)는 정상 — 그 외에만 로그
      if (shareError?.name !== 'AbortError') console.warn('공유 실패.', shareError);
    }
  };

  // 화살표로 사진을 넘기면 활성 썸네일이 화면 밖일 수 있어 가로 스크롤로 끌어옴
  useEffect(() => {
    const track = thumbnailTrackRef.current;
    if (!track) return;
    const active = track.querySelector('.thumb-button.active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activePhoto]);

  if (!property) {
    return (
      <div className="page-shell">
        <section className="container empty-state detail-empty">
          <h1>매물을 찾을 수 없습니다.</h1>
          <p>목록에서 다시 선택해 주세요.</p>
          <Link to="/properties" className="primary-link-button">
            급매 목록으로 이동
          </Link>
        </section>
      </div>
    );
  }

  const activePhotoDetails = photos[activePhoto] ?? photos[0];
  // property.id 가 'gm-001' 같은 짧은 형식이거나 'gm-mh3z9k28' 같은 nanoid 형식이거나 그대로 노출
  const listingNumber = property.id?.toUpperCase() ?? '';
  const daysOnMarket = getDaysSince(property.lastVerifiedAt);
  const agentEmail = property.agent?.email || '';
  const phoneHref = property.agent.phone.replace(/[^\d+]/g, '');
  const pricePerSquareMeter = Math.round(property.price / property.area);
  const pricePerPyeong = Math.round(property.price / (property.area * 0.3025));

  const summaryStats = [
    { label: '가격', value: formatPrice(property.price), note: `${property.discountRate}% 저렴`, className: 'price' },
    { label: '방', value: `${property.rooms}개`, Icon: BedDouble },
    { label: '욕실', value: `${property.bathrooms}개`, Icon: Bath },
    { label: '전용면적', value: formatArea(property.area), note: `공급 ${formatArea(property.supplyArea)}`, Icon: Ruler },
  ];

  const factRows = [
    ['상태', property.verified ? '검증 완료' : '검증 대기'],
    ['매물번호', listingNumber],
    ['등록 후', `${daysOnMarket}일`],
    ['최근 확인일', formatKoreanDate(property.lastVerifiedAt)],
    ['기준 실거래일', formatKoreanDate(property.recentTransactionDate)],
    ['관리비', formatPrice(property.maintenanceFee)],
    ['매물 유형', property.propertyType],
    ['준공연도', `${property.builtYear}년`],
    ['층수', property.floor],
    ['주차', property.parking],
    ...(property.direction ? [['향', property.direction]] : []),
    ...(property.occupancyStatus ? [['거주 상태', property.occupancyStatus]] : []),
    ['지역', property.region],
  ];

  const infoItems = [
    ['전용면적', formatArea(property.area)],
    ['공급면적', formatArea(property.supplyArea)],
    ['평당가', formatPrice(pricePerPyeong)],
    ['㎡당가', formatPrice(pricePerSquareMeter)],
    ['층', property.floor],
    ['준공연도', `${property.builtYear}년`],
    ['방/욕실 수', `${property.rooms}개 / ${property.bathrooms}개`],
    ['입주 가능일', property.moveInDate],
  ];

  // 새 스키마: convenience(편의점), gym(체육시설). 옛 데이터 호환을 위해 park/commute 도 fallback.
  const lifestyleItems = [
    ['지하철', property.lifestyle.subway],
    ['학교', property.lifestyle.school],
    ['마트', property.lifestyle.mart],
    ['병원', property.lifestyle.hospital],
    ['편의점', property.lifestyle.convenience || property.lifestyle.park || ''],
    ['체육시설', property.lifestyle.gym || ''],
  ];

  const highlightItems = [
    ['기준 실거래가', formatPrice(property.actualTransactionPrice)],
    ['가격 차이', formatPrice(property.actualTransactionPrice - property.price)],
  ];

  // ④ 기준가 산출 근거 — priceBasis 있으면 동적, 없으면 기존 문구로 안전 폴백
  const basis = property.priceBasis;
  const priceBasisLabel = basis?.method
    ? `${basis.method} · 국토부 기준${basis.confidence === 'low' ? ' (표본 적음)' : ''}`
    : '동일 단지와 유사 면적 최근 실거래가 기준';

  const showPreviousPhoto = () => {
    setActivePhoto((current) => (current === 0 ? photos.length - 1 : current - 1));
  };

  const showNextPhoto = () => {
    setActivePhoto((current) => (current + 1) % photos.length);
  };

  return (
    <div className="detail-page compass-detail">
      {justRegistered && (
        <div className="just-registered-banner" role="status">
          <div className="container just-registered-inner">
            <CheckCircle2 size={20} aria-hidden="true" />
            <div className="just-registered-copy">
              <strong>매물이 등록되었습니다 — 지금 매수자에게 보이는 화면입니다.</strong>
              <span>실거래가 검증과 AI 매물 리포트는 자동으로 생성됩니다. 잠시 후 이 페이지에서 확인하세요.</span>
            </div>
            <Link to="/agent/properties" className="just-registered-link">
              내 매물 관리
            </Link>
            <button
              type="button"
              className="just-registered-dismiss"
              onClick={dismissRegisteredBanner}
              aria-label="등록 완료 안내 닫기"
            >
              <X size={17} />
            </button>
          </div>
        </div>
      )}

      <section className="property-masthead" id="overview">
        <div className="container property-masthead-inner">
          <div className="masthead-copy">
            <h1>{property.title}</h1>
            <p>
              <MapPin size={16} />
              {property.address}
            </p>
          </div>

          <div className="masthead-aside">
            <div className="masthead-stats" aria-label="매물 요약">
              {summaryStats.map(({ label, value, note, Icon, className }) => (
                <div key={label} className={className ? `masthead-stat ${className}` : 'masthead-stat'}>
                  {Icon && <Icon size={18} />}
                  <strong>{value}</strong>
                  <span>{label}</span>
                  {note && <em>{note}</em>}
                </div>
              ))}
            </div>

            <div className="masthead-actions">
              <button
                type="button"
                className={saved ? 'pill-action-button primary is-saved' : 'pill-action-button primary'}
                onClick={handleToggleSave}
                aria-pressed={saved}
              >
                <Heart size={17} fill={saved ? 'currentColor' : 'none'} />
                {saved ? '저장됨' : '저장'}
              </button>
              <button type="button" className="pill-action-button" onClick={handleShare}>
                <Share2 size={17} />
                {shareCopied ? '링크 복사됨' : '공유'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <nav className="detail-anchor-tabs" aria-label="매물 상세 메뉴">
        <div className="container detail-anchor-list">
          {detailTabs.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className={activeSection === href.slice(1) ? 'is-active' : undefined}
              aria-current={activeSection === href.slice(1) ? 'true' : undefined}
              onClick={(event) => handleAnchorClick(event, href)}
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <section className="container compass-detail-layout">
        <div className="detail-media-column">
          <div className="compass-gallery" aria-label="매물 사진">
            <div className="gallery-stage">
              {activePhotoDetails && <img src={activePhotoDetails.src} alt={activePhotoDetails.alt} />}

              <div className="gallery-badges">
                <UrgentBadge discountRate={property.discountRate} verified={property.verified} />
                <span className="listed-badge">
                  {property.verified ? '검증된 급매' : '검증 확인 중'}
                </span>
              </div>

              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    className="gallery-nav previous"
                    aria-label="이전 사진"
                    onClick={showPreviousPhoto}
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button type="button" className="gallery-nav next" aria-label="다음 사진" onClick={showNextPhoto}>
                    <ChevronRight size={24} />
                  </button>
                </>
              )}
            </div>

            <div className="thumbnail-dock">
              <div className="thumbnail-scroll-zone">
                {photos.length > 1 && (
                  <button type="button" className="dock-arrow" aria-label="이전 사진" onClick={showPreviousPhoto}>
                    <ChevronLeft size={21} />
                  </button>
                )}
                <div className="thumbnail-track" aria-label="사진 썸네일 목록" ref={thumbnailTrackRef}>
                  {photos.map((photo, index) => (
                    <button
                      type="button"
                      key={`${photo.src}-${index}`}
                      className={index === activePhoto ? 'thumb-button active' : 'thumb-button'}
                      aria-label={`${index + 1}번 사진 보기`}
                      onClick={() => setActivePhoto(index)}
                    >
                      <img src={photo.src} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
                {photos.length > 1 && (
                  <button type="button" className="dock-arrow" aria-label="다음 사진" onClick={showNextPhoto}>
                    <ChevronRight size={21} />
                  </button>
                )}
              </div>
              <div className="gallery-action-group" aria-label="전체 미디어 보기">
                <button type="button" className="gallery-action-tile" onClick={() => setViewerMode('photos')}>
                  <LayoutGrid size={19} />
                  전체 사진
                </button>
                <button type="button" className="gallery-action-tile" onClick={() => setViewerMode('map')}>
                  <Map size={19} />
                  지도
                </button>
                <button type="button" className="gallery-action-tile" onClick={() => setViewerMode('tour')}>
                  <Camera size={19} />
                  3D 투어
                </button>
                <button
                  type="button"
                  className="gallery-action-tile"
                  onClick={() => setViewerMode('report')}
                  aria-label="매물 리포트"
                >
                  <FileText size={19} />
                  매물 리포트
                </button>
              </div>
            </div>
          </div>

          <div className="detail-content-stack">
            <section className="detail-section description-panel">
              <p className="section-eyebrow">매물 설명</p>
              <h2>{property.title} 핵심 포인트</h2>
              {hasPriceConflict(property) && (
                <p className="price-conflict-note">
                  <AlertTriangle size={16} aria-hidden="true" />
                  아래 설명문에는 전세 보증금을 낀 총액이나 초기 투자금이 적혀 있어, 위에 표시된 매도가와 다를 수 있습니다.
                  할인율은 <strong>매도가</strong>와 국토부 실거래 중앙값을 비교해 산출한 값입니다.
                </p>
              )}
              <p>{property.description}</p>
              <div className="detail-highlight-grid">
                {highlightItems.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section" id="price-report">
              <PriceReport property={property} />
            </section>

            <section className="detail-section" id="property-info">
              <p className="section-eyebrow">매물 정보</p>
              <h2>상세 정보</h2>
              <div className="info-grid">
                {infoItems.map(([label, value]) => (
                  <div key={label} className="info-item">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section" id="inspection">
              <p className="section-eyebrow">설비 점검</p>
              <h2>AI 점검 체크리스트</h2>
              <InspectionChecklist property={property} />
            </section>

            <section className="detail-section" id="location">
              <p className="section-eyebrow">위치</p>
              <h2>{property.region} 생활권</h2>
              <div className="detail-location-grid">
                <PropertyLocationMap property={property} />
                <div className="location-copy">
                  <strong>{property.address}</strong>
                  {(() => {
                    // lifestyle 중 도보/차량 분(分) 가장 짧은 1개를 "가장 가까운 시설" 로 표시
                    const entries = Object.entries(property.lifestyle ?? {})
                      .map(([k, v]) => {
                        if (!v) return null;
                        const m = String(v).match(/(\d+)분/);
                        return m ? { key: k, label: v, minutes: parseInt(m[1], 10) } : null;
                      })
                      .filter(Boolean)
                      .sort((a, b) => a.minutes - b.minutes);
                    if (entries.length === 0) {
                      return <p style={{ color: 'var(--color-text-muted)' }}>주변 시설 정보 수집 중</p>;
                    }
                    return (
                      <>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 2 }}>가장 가까운 시설</p>
                        <p>{entries[0].label}</p>
                      </>
                    );
                  })()}
                </div>
              </div>
            </section>

            <section className="detail-section" id="lifestyle">
              <p className="section-eyebrow">생활권 정보</p>
              <h2>주변 편의시설</h2>
              <div className="lifestyle-grid">
                {lifestyleItems.map(([label, value]) => (
                  <div key={label} className="lifestyle-item">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <aside className="compass-detail-sidebar">
          <section className="property-fact-panel">
            <p className="fact-updated">매물 업데이트: {formatKoreanDate(property.lastVerifiedAt)}</p>
            <dl className="fact-table">
              {factRows.map(([label, value]) => (
                <div key={label} className="fact-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="contact-panel" id="agent">
            <h2>담당 중개사</h2>
            <div className="agent-profile">
              <div className="agent-avatar">{property.agent.name.slice(0, 1)}</div>
              <div>
                <strong>{property.agent.name}</strong>
                <span>{property.agent.office}</span>
              </div>
            </div>
            <p className="agent-verified">
              {property.agent.verified ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
              {property.agent.verified ? '인증 중개사' : '인증 확인 중'}
            </p>
            {phoneHref && (
              <a className="agent-phone" href={`tel:${phoneHref}`}>
                <Phone size={17} />
                {property.agent.phone}
              </a>
            )}
            {agentEmail && (
              <a className="agent-phone" href={`mailto:${agentEmail}`}>
                <Mail size={17} />
                {agentEmail}
              </a>
            )}
            <p className="agent-date">
              <CalendarCheck size={17} />
              최근 매물 확인일 {formatKoreanDate(property.lastVerifiedAt)}
            </p>
            {phoneHref ? (
              <a className="tour-button" href={`tel:${phoneHref}`}>
                전화로 방문 예약·문의
                <span>방문 일정은 중개사와 협의</span>
              </a>
            ) : agentEmail ? (
              <a className="tour-button" href={`mailto:${agentEmail}`}>
                이메일로 방문 예약·문의
                <span>방문 일정은 중개사와 협의</span>
              </a>
            ) : (
              <p className="contact-empty-note">
                이 매물은 중개사무소 연락처가 아직 등록되지 않았습니다.
                가격 검증 근거는 위 가격 리포트에서 직접 확인하실 수 있습니다.
              </p>
            )}
          </section>

          <section className="sidebar-proof-card">
            <TrendingDown size={21} />
            <strong>{property.discountRate}% 저렴</strong>
            <span>{priceBasisLabel}</span>
          </section>

          <section className="sidebar-proof-card verification-card">
            <ShieldCheck size={21} />
            <strong>{property.verified ? '검증 완료' : '검증 대기'}</strong>
            <span>가격, 등기, 중개사 정보를 기준으로 확인했습니다.</span>
          </section>
        </aside>
      </section>

      {viewerMode && (
        <PropertyMediaViewer
          property={property}
          photos={photos}
          initialMode={viewerMode}
          onClose={() => setViewerMode(null)}
        />
      )}
    </div>
  );
}

export default PropertyDetail;
