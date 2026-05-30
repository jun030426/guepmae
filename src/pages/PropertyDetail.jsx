import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  Search,
  Share2,
  ShieldCheck,
  TrendingDown,
} from 'lucide-react';
import PropertyMediaViewer from '../components/PropertyMediaViewer.jsx';
import PropertyLocationMap from '../components/PropertyLocationMap.jsx';
import PriceReport from '../components/PriceReport.jsx';
import UrgentBadge from '../components/UrgentBadge.jsx';
import { useProperty } from '../hooks/useProperties.js';
import { formatArea, formatPrice } from '../utils/priceUtils.js';
import { getPropertyPhotos } from '../utils/propertyMedia.js';

// 탭 순서는 페이지 DOM의 섹션 순서와 동일해야 함 (스크롤 흐름과 일치)
const detailTabs = [
  ['개요', '#overview'],
  ['방문 일정', '#open-house'],
  ['가격 리포트', '#price-report'],
  ['매물 정보', '#property-info'],
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
  const photos = useMemo(() => (property ? getPropertyPhotos(property, 12) : []), [property]);
  const [activePhoto, setActivePhoto] = useState(0);
  const [viewerMode, setViewerMode] = useState(null);
  const thumbnailTrackRef = useRef(null);

  useEffect(() => {
    setActivePhoto(0);
  }, [id]);

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

  // 방문 일정은 매물별로 다르고 매도자/중개사 일정에 따라 변동.
  // 통일된 시스템 만들기 전까지는 "협의" 메시지로 단순화.
  const openHouseItems = [];

  const showPreviousPhoto = () => {
    setActivePhoto((current) => (current === 0 ? photos.length - 1 : current - 1));
  };

  const showNextPhoto = () => {
    setActivePhoto((current) => (current + 1) % photos.length);
  };

  return (
    <div className="detail-page compass-detail">
      <section className="property-masthead" id="overview">
        <div className="container detail-search-strip">
          <div className="detail-search-box">
            <input type="search" placeholder="지역, 단지명, 주소, 매물번호 검색" aria-label="매물 검색" />
            <button type="button" aria-label="검색">
              <Search size={19} />
            </button>
          </div>
        </div>

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
              <button type="button" className="pill-action-button primary">
                <Heart size={17} />
                저장
              </button>
              <button type="button" className="pill-action-button">
                <Share2 size={17} />
                공유
              </button>
            </div>
          </div>
        </div>
      </section>

      <nav className="detail-anchor-tabs" aria-label="매물 상세 메뉴">
        <div className="container detail-anchor-list">
          {detailTabs.map(([label, href], index) => (
            <a key={href} href={href} className={index === 0 ? 'is-active' : undefined}>
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
            </div>

            <div className="thumbnail-dock">
              <div className="thumbnail-scroll-zone">
                <button type="button" className="dock-arrow" aria-label="이전 사진" onClick={showPreviousPhoto}>
                  <ChevronLeft size={21} />
                </button>
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
                <button type="button" className="dock-arrow" aria-label="다음 사진" onClick={showNextPhoto}>
                  <ChevronRight size={21} />
                </button>
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

            <section className="detail-section open-house-panel" id="open-house">
              <p className="section-eyebrow">방문 일정</p>
              <h2>예약 가능한 방문 시간</h2>
              {openHouseItems.length > 0 ? (
                <div className="open-house-list">
                  {openHouseItems.map(([day, time, note]) => (
                    <div key={day} className="open-house-item">
                      <CalendarCheck size={20} />
                      <div>
                        <strong>{day}</strong>
                        <span>{time}</span>
                      </div>
                      <em>{note}</em>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="open-house-empty">
                  <CalendarCheck size={20} />
                  <p>방문 일정은 담당 중개사와 협의해주세요.</p>
                </div>
              )}
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
              {/* 길찾기·소요시간 — 한국 길찾기 API(ODsay/카카오) 연동 후 재활성화. 그때까지 노출 안 함. */}
              {/*
              <div className="commute-coming-soon">
                <strong>길찾기 · 소요시간</strong>
                <span>대중교통·자동차 소요시간 길찾기는 곧 제공될 예정입니다.</span>
              </div>
              */}
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
            <a className="agent-phone" href={`tel:${phoneHref}`}>
              <Phone size={17} />
              {property.agent.phone}
            </a>
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
            <button type="button" className="tour-button">
              방문 예약 요청
              <span>중개사와 일정 협의</span>
            </button>
            <button type="button" className="outline-button full">
              중개사에게 문의
            </button>
          </section>

          <section className="sidebar-proof-card">
            <TrendingDown size={21} />
            <strong>{property.discountRate}% 저렴</strong>
            <span>동일 단지와 유사 면적 최근 실거래가 기준</span>
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
