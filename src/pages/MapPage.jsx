import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import MapView from '../components/MapView.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { formatPrice } from '../utils/priceUtils.js';
import { getPrimaryPropertyPhoto } from '../utils/propertyMedia.js';

const MAP_ITEMS_PER_PAGE = 10;

function getPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, 'ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'ellipsis-left', currentPage - 1, currentPage, currentPage + 1, 'ellipsis-right', totalPages];
}

function formatDiscount(discountRate) {
  return Number.isInteger(discountRate) ? `${discountRate}%` : `${discountRate.toFixed(1)}%`;
}

function MapListCard({ property, selected, onSelect, registerRef }) {
  const photo = getPrimaryPropertyPhoto(property);

  return (
    <button
      type="button"
      ref={registerRef}
      className={`map-list-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(property.id)}
      aria-pressed={selected}
    >
      <div className="map-list-card-photo">
        {photo ? (
          <img src={photo.src} alt={photo.alt} loading="lazy" />
        ) : (
          <div className="map-list-card-photo-placeholder" aria-hidden="true">
            <MapPin size={20} />
          </div>
        )}
      </div>
      <div className="map-list-card-body">
        <span className="map-list-card-discount">{formatDiscount(property.discountRate)} 저렴</span>
        <h3>{property.title}</h3>
        <span className="map-list-card-region">{property.region}</span>
        <strong className="map-list-card-price">{formatPrice(property.price)}</strong>
        <span className="map-list-card-spec">
          {property.rooms}룸 · {property.bathrooms}욕실 · {property.area}㎡
        </span>
        <Link
          to={`/properties/${property.id}`}
          className="map-list-card-link"
          onClick={(event) => event.stopPropagation()}
        >
          상세 보기 →
        </Link>
      </div>
    </button>
  );
}

function MapPage() {
  const { properties: urgentProperties } = useProperties({ urgentOnly: true });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const cardRefsMap = useRef(new Map());

  const totalPages = Math.max(1, Math.ceil(urgentProperties.length / MAP_ITEMS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const visibleStart = urgentProperties.length === 0 ? 0 : (activePage - 1) * MAP_ITEMS_PER_PAGE + 1;
  const visibleEnd = Math.min(activePage * MAP_ITEMS_PER_PAGE, urgentProperties.length);
  const pageItems = useMemo(() => getPaginationItems(activePage, totalPages), [activePage, totalPages]);

  const mapProperties = useMemo(() => {
    const startIndex = (activePage - 1) * MAP_ITEMS_PER_PAGE;
    return urgentProperties.slice(startIndex, startIndex + MAP_ITEMS_PER_PAGE);
  }, [activePage, urgentProperties]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  // 페이지 변경 시 첫 번째 매물 자동 선택
  useEffect(() => {
    if (!mapProperties.length) return;
    if (!mapProperties.find((property) => property.id === selectedId)) {
      setSelectedId(mapProperties[0].id);
    }
  }, [mapProperties, selectedId]);

  // 선택된 카드를 패널 안에서 자동 스크롤
  useEffect(() => {
    if (!selectedId) return;
    const node = cardRefsMap.current.get(selectedId);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

  const registerCardRef = (id) => (node) => {
    if (node) {
      cardRefsMap.current.set(id, node);
    } else {
      cardRefsMap.current.delete(id);
    }
  };

  return (
    <div className="map-page">
      <section className="map-layout">
        <aside className="map-list-panel">
          <div className="map-list-header">
            <div>
              <p className="map-list-eyebrow">지도 검색</p>
              <h2>지도 내 급매</h2>
            </div>
            <span className="map-list-count">
              {visibleStart}-{visibleEnd} / {urgentProperties.length}건
            </span>
          </div>

          <div className="map-card-list">
            {mapProperties.map((property) => (
              <MapListCard
                key={property.id}
                property={property}
                selected={property.id === selectedId}
                onSelect={setSelectedId}
                registerRef={registerCardRef(property.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="map-pagination" aria-label="지도 검색 매물 페이지">
              <button
                type="button"
                className="map-page-arrow"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={activePage === 1}
                aria-label="이전 페이지"
              >
                <ChevronLeft size={17} />
              </button>

              {pageItems.map((item) =>
                typeof item === 'number' ? (
                  <button
                    type="button"
                    key={item}
                    className={item === activePage ? 'map-page-number active' : 'map-page-number'}
                    onClick={() => setCurrentPage(item)}
                    aria-current={item === activePage ? 'page' : undefined}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={item} className="map-page-ellipsis">
                    ...
                  </span>
                ),
              )}

              <button
                type="button"
                className="map-page-arrow"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={activePage === totalPages}
                aria-label="다음 페이지"
              >
                <ChevronRight size={17} />
              </button>
            </nav>
          )}
        </aside>

        <MapView
          properties={mapProperties}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </section>
    </div>
  );
}

export default MapPage;
