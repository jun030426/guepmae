import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MapPin, SlidersHorizontal, X } from 'lucide-react';
import MapView from '../components/MapView.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { formatPrice } from '../utils/priceUtils.js';
import { getPrimaryPropertyPhoto } from '../utils/propertyMedia.js';

const MAP_ITEMS_PER_PAGE = 10;
const PROPERTY_TYPE_OPTIONS = ['아파트', '오피스텔', '빌라', '단독주택'];
const ROOM_OPTIONS = ['전체', '1', '2', '3', '4'];
const BATHROOM_OPTIONS = ['전체', '1', '2', '3'];
const DISCOUNT_OPTIONS = [
  { value: 5, label: '5% 이상' },
  { value: 7, label: '7% 이상' },
  { value: 10, label: '10% 이상' },
];

const initialFilters = {
  minPrice: '',  // 억 단위
  maxPrice: '',  // 억 단위
  propertyTypes: [],
  minRooms: '전체',
  minBathrooms: '전체',
  minDiscount: 5,
  verifiedOnly: false,
};

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

function MapFilterBar({ filters, onChange, expanded, setExpanded, resultCount }) {
  const updateField = (key) => (event) => {
    onChange({ ...filters, [key]: event.target.value });
  };

  const togglePropertyType = (type) => {
    const next = filters.propertyTypes.includes(type)
      ? filters.propertyTypes.filter((t) => t !== type)
      : [...filters.propertyTypes, type];
    onChange({ ...filters, propertyTypes: next });
  };

  const reset = () => onChange(initialFilters);

  return (
    <div className={`map-filter-bar ${expanded ? 'is-expanded' : ''}`}>
      <div className="map-filter-summary">
        <div className="map-filter-price-input">
          <input
            type="number"
            inputMode="numeric"
            placeholder="최소"
            value={filters.minPrice}
            onChange={updateField('minPrice')}
            min={0}
            aria-label="최소 가격 (억)"
          />
          <span>억</span>
        </div>
        <span className="map-filter-dash">-</span>
        <div className="map-filter-price-input">
          <input
            type="number"
            inputMode="numeric"
            placeholder="최대"
            value={filters.maxPrice}
            onChange={updateField('maxPrice')}
            min={0}
            aria-label="최대 가격 (억)"
          />
          <span>억</span>
        </div>
        <button
          type="button"
          className="map-filter-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <X size={15} />
              <span>필터 닫기</span>
            </>
          ) : (
            <>
              <SlidersHorizontal size={15} />
              <span>필터</span>
            </>
          )}
        </button>
      </div>

      {expanded && (
        <div className="map-filter-detail" role="region" aria-label="상세 필터">
          <fieldset>
            <legend>매물 유형</legend>
            <div className="map-filter-checks">
              {PROPERTY_TYPE_OPTIONS.map((type) => (
                <label key={type}>
                  <input
                    type="checkbox"
                    checked={filters.propertyTypes.includes(type)}
                    onChange={() => togglePropertyType(type)}
                  />
                  {type}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="map-filter-row-2col">
            <fieldset>
              <legend>최소 방</legend>
              <select value={filters.minRooms} onChange={updateField('minRooms')}>
                {ROOM_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === '전체' ? '전체' : `${value}+`}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset>
              <legend>최소 욕실</legend>
              <select value={filters.minBathrooms} onChange={updateField('minBathrooms')}>
                {BATHROOM_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === '전체' ? '전체' : `${value}+`}
                  </option>
                ))}
              </select>
            </fieldset>
          </div>

          <fieldset>
            <legend>최소 할인율</legend>
            <div className="map-filter-chips">
              {DISCOUNT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`map-filter-chip ${filters.minDiscount === option.value ? 'active' : ''}`}
                  onClick={() => onChange({ ...filters, minDiscount: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="map-filter-verified">
            <input
              type="checkbox"
              checked={filters.verifiedOnly}
              onChange={(event) => onChange({ ...filters, verifiedOnly: event.target.checked })}
            />
            검증된 매물만 보기
          </label>

          <div className="map-filter-actions">
            <button type="button" className="map-filter-reset" onClick={reset}>
              초기화
            </button>
            <button
              type="button"
              className="map-filter-apply"
              onClick={() => setExpanded(false)}
            >
              {resultCount}건 결과 보기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MapPage() {
  const { properties: urgentProperties } = useProperties({ urgentOnly: true });
  const [filters, setFilters] = useState(initialFilters);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const cardRefsMap = useRef(new Map());

  const filteredProperties = useMemo(() => {
    const minP = filters.minPrice === '' ? 0 : Number(filters.minPrice) * 100000000;
    const maxP = filters.maxPrice === '' ? Infinity : Number(filters.maxPrice) * 100000000;

    return urgentProperties.filter((p) => {
      if (p.price < minP || p.price > maxP) return false;
      if (filters.propertyTypes.length && !filters.propertyTypes.includes(p.propertyType)) return false;
      if (filters.minRooms !== '전체' && p.rooms < Number(filters.minRooms)) return false;
      if (filters.minBathrooms !== '전체' && p.bathrooms < Number(filters.minBathrooms)) return false;
      if (p.discountRate < filters.minDiscount) return false;
      if (filters.verifiedOnly && !p.verified) return false;
      return true;
    });
  }, [urgentProperties, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredProperties.length / MAP_ITEMS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const visibleStart = filteredProperties.length === 0 ? 0 : (activePage - 1) * MAP_ITEMS_PER_PAGE + 1;
  const visibleEnd = Math.min(activePage * MAP_ITEMS_PER_PAGE, filteredProperties.length);
  const pageItems = useMemo(() => getPaginationItems(activePage, totalPages), [activePage, totalPages]);

  const mapProperties = useMemo(() => {
    const startIndex = (activePage - 1) * MAP_ITEMS_PER_PAGE;
    return filteredProperties.slice(startIndex, startIndex + MAP_ITEMS_PER_PAGE);
  }, [activePage, filteredProperties]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!mapProperties.length) {
      setSelectedId(null);
      return;
    }
    if (!mapProperties.find((property) => property.id === selectedId)) {
      setSelectedId(mapProperties[0].id);
    }
  }, [mapProperties, selectedId]);

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
              {visibleStart}-{visibleEnd} / {filteredProperties.length}건
            </span>
          </div>

          <div className="map-card-list">
            {mapProperties.length > 0 ? (
              mapProperties.map((property) => (
                <MapListCard
                  key={property.id}
                  property={property}
                  selected={property.id === selectedId}
                  onSelect={setSelectedId}
                  registerRef={registerCardRef(property.id)}
                />
              ))
            ) : (
              <div className="map-card-empty">
                <p>조건에 맞는 매물이 없습니다.</p>
                <p>필터를 조금 넓혀 다시 확인해보세요.</p>
              </div>
            )}
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

        <div className="map-canvas-area">
          <MapFilterBar
            filters={filters}
            onChange={setFilters}
            expanded={filterExpanded}
            setExpanded={setFilterExpanded}
            resultCount={filteredProperties.length}
          />
          <MapView
            properties={mapProperties}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </section>
    </div>
  );
}

export default MapPage;
