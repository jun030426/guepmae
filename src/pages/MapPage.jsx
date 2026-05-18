import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MapPin, Minus, Plus, SlidersHorizontal, X } from 'lucide-react';
import MapView from '../components/MapView.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { formatPrice } from '../utils/priceUtils.js';
import { getPrimaryPropertyPhoto } from '../utils/propertyMedia.js';

const MAP_ITEMS_PER_PAGE = 10;
const MAX_ROOMS = 4;
const DISCOUNT_OPTIONS = [
  { value: 5, label: '5% 이상' },
  { value: 7, label: '7% 이상' },
  { value: 10, label: '10% 이상' },
];
const UNIT_COUNT_OPTIONS = [
  { value: 'all', label: '전체', test: () => true },
  { value: 'lt100', label: '100세대 미만', test: (n) => n < 100 },
  { value: 'gte100', label: '100세대 이상', test: (n) => n >= 100 },
  { value: 'gte500', label: '500세대 이상', test: (n) => n >= 500 },
  { value: 'gte1000', label: '1000세대 이상', test: (n) => n >= 1000 },
];

const BUDGET_MIN = 0;
const BUDGET_MAX = 30; // 억
const BUDGET_TICKS = [5, 10, 15, 20, 25];
const PYEONG_MIN = 0;
const PYEONG_MAX = 80;
const PYEONG_TICKS = [20, 40, 60];
const MAX_BATHS = 3;

const initialFilters = {
  budgetMin: BUDGET_MIN,
  budgetMax: BUDGET_MAX,
  minRooms: 0, // 0 = 전체
  minBaths: 0, // 0 = 전체
  pyeongMin: PYEONG_MIN,
  pyeongMax: PYEONG_MAX,
  unitBucket: 'all',
  minDiscount: 5,
};

function getUnitCount(property) {
  return property.unitCount ?? 500;
}

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

// 듀얼 핸들 슬라이더 — 한 트랙 위에 두 input[type=range] 겹치고 핸들만 인터랙티브.
// 위에는 현재 범위 툴팁(전체 범위면 "전체"), 아래에는 최소/최대/중간 틱 라벨.
function DualRangeSlider({ min, max, valueMin, valueMax, onChange, unit, ticks = [] }) {
  const range = max - min;
  const minPct = range === 0 ? 0 : ((valueMin - min) / range) * 100;
  const maxPct = range === 0 ? 100 : ((valueMax - min) / range) * 100;

  const updateMin = (event) => {
    const v = Math.min(Number(event.target.value), valueMax);
    onChange({ min: v, max: valueMax });
  };
  const updateMax = (event) => {
    const v = Math.max(Number(event.target.value), valueMin);
    onChange({ min: valueMin, max: v });
  };

  // 핸들 너비 16px 보정 — 핸들 중심이 양쪽 끝에서 8px씩 안쪽으로 이동
  const minOffsetPx = 8 - (minPct / 100) * 16;
  const maxOffsetPx = 8 - (maxPct / 100) * 16;

  const isFullRange = valueMin === min && valueMax === max;
  const tooltipLabel = isFullRange ? '전체' : `${valueMin}${unit} ~ ${valueMax}${unit}`;

  return (
    <div className="dual-range">
      <div className="dual-range-tooltip">{tooltipLabel}</div>

      <div className="dual-range-slider">
        <div className="dual-range-track" />
        <div
          className="dual-range-fill"
          style={{
            left: `calc(${minPct}% + ${minOffsetPx}px)`,
            width: `calc(${maxPct - minPct}% + ${maxOffsetPx - minOffsetPx}px)`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={valueMin}
          onChange={updateMin}
          aria-label="최소"
        />
        <input
          type="range"
          min={min}
          max={max}
          value={valueMax}
          onChange={updateMax}
          aria-label="최대"
        />
      </div>

      <div className="dual-range-labels">
        <span className="dual-range-label-end dual-range-label-end--min">최소</span>
        {ticks.map((tickValue) => {
          const pct = ((tickValue - min) / range) * 100;
          const offset = 8 - (pct / 100) * 16;
          return (
            <span
              key={tickValue}
              className="dual-range-label-tick"
              style={{ left: `calc(${pct}% + ${offset}px)` }}
            >
              {tickValue}{unit}
            </span>
          );
        })}
        <span className="dual-range-label-end dual-range-label-end--max">최대</span>
      </div>
    </div>
  );
}

function MapFilterBar({ filters, onChange, expanded, setExpanded, resultCount }) {
  const update = (patch) => onChange({ ...filters, ...patch });

  const reset = () => onChange(initialFilters);

  const roomLabel = filters.minRooms === 0 ? '전체' : `${filters.minRooms}+`;
  const decRoom = () => update({ minRooms: Math.max(0, filters.minRooms - 1) });
  const incRoom = () => update({ minRooms: Math.min(MAX_ROOMS, filters.minRooms + 1) });

  const bathLabel = filters.minBaths === 0 ? '전체' : `${filters.minBaths}+`;
  const decBath = () => update({ minBaths: Math.max(0, filters.minBaths - 1) });
  const incBath = () => update({ minBaths: Math.min(MAX_BATHS, filters.minBaths + 1) });

  // 적용된 필터 개수 (초기값과 다른 항목)
  const activeFilterCount = [
    filters.budgetMin !== BUDGET_MIN || filters.budgetMax !== BUDGET_MAX,
    filters.minRooms !== 0,
    filters.minBaths !== 0,
    filters.pyeongMin !== PYEONG_MIN || filters.pyeongMax !== PYEONG_MAX,
    filters.unitBucket !== 'all',
    filters.minDiscount !== 5,
  ].filter(Boolean).length;

  return (
    <div className={`map-filter-bar ${expanded ? 'is-expanded' : ''}`}>
      <div className="map-filter-summary">
        <span className="map-filter-summary-text">
          {resultCount}건의 급매
        </span>
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
              <span>필터{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
            </>
          )}
        </button>
      </div>

      {expanded && (
        <div className="map-filter-detail" role="region" aria-label="상세 필터">
          {/* 매매가 듀얼 슬라이더 */}
          <fieldset>
            <legend>매매가</legend>
            <DualRangeSlider
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              valueMin={filters.budgetMin}
              valueMax={filters.budgetMax}
              onChange={({ min: a, max: b }) => update({ budgetMin: a, budgetMax: b })}
              unit="억"
              ticks={BUDGET_TICKS}
            />
          </fieldset>

          {/* 방 + 욕실 — 같은 스테퍼 형태로 통일 */}
          <div className="map-filter-room-box">
            <div className="map-filter-room-col">
              <label className="map-filter-room-label">방</label>
              <div className="map-filter-stepper">
                <button
                  type="button"
                  onClick={decRoom}
                  disabled={filters.minRooms === 0}
                  aria-label="방 줄이기"
                >
                  <Minus size={14} />
                </button>
                <span>{roomLabel}</span>
                <button
                  type="button"
                  onClick={incRoom}
                  disabled={filters.minRooms === MAX_ROOMS}
                  aria-label="방 늘리기"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div className="map-filter-room-col">
              <label className="map-filter-room-label">욕실</label>
              <div className="map-filter-stepper">
                <button
                  type="button"
                  onClick={decBath}
                  disabled={filters.minBaths === 0}
                  aria-label="욕실 줄이기"
                >
                  <Minus size={14} />
                </button>
                <span>{bathLabel}</span>
                <button
                  type="button"
                  onClick={incBath}
                  disabled={filters.minBaths === MAX_BATHS}
                  aria-label="욕실 늘리기"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* 평형 듀얼 슬라이더 */}
          <fieldset>
            <legend>평형(공급면적)</legend>
            <DualRangeSlider
              min={PYEONG_MIN}
              max={PYEONG_MAX}
              valueMin={filters.pyeongMin}
              valueMax={filters.pyeongMax}
              onChange={({ min: a, max: b }) => update({ pyeongMin: a, pyeongMax: b })}
              unit="평"
              ticks={PYEONG_TICKS}
            />
          </fieldset>

          {/* 세대수 */}
          <fieldset>
            <legend>세대수</legend>
            <div className="map-filter-chips">
              {UNIT_COUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`map-filter-chip ${filters.unitBucket === opt.value ? 'active' : ''}`}
                  onClick={() => update({ unitBucket: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* 최소 할인율 */}
          <fieldset>
            <legend>최소 할인율</legend>
            <div className="map-filter-chips">
              {DISCOUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`map-filter-chip ${filters.minDiscount === opt.value ? 'active' : ''}`}
                  onClick={() => update({ minDiscount: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="map-filter-actions">
            <button type="button" className="map-filter-reset" onClick={reset}>
              초기화
            </button>
            <button type="button" className="map-filter-apply" onClick={() => setExpanded(false)}>
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
    const minP = filters.budgetMin <= BUDGET_MIN ? 0 : filters.budgetMin * 100000000;
    const maxP =
      filters.budgetMax >= BUDGET_MAX ? Infinity : filters.budgetMax * 100000000;
    const unitOption = UNIT_COUNT_OPTIONS.find((o) => o.value === filters.unitBucket);

    return urgentProperties.filter((p) => {
      if (p.price < minP || p.price > maxP) return false;
      if (filters.minRooms > 0 && p.rooms < filters.minRooms) return false;
      if (filters.minBaths > 0 && p.bathrooms < filters.minBaths) return false;
      const pyeong = (p.supplyArea ?? p.area ?? 0) / 3.3;
      if (filters.pyeongMin > PYEONG_MIN && pyeong < filters.pyeongMin) return false;
      if (filters.pyeongMax < PYEONG_MAX && pyeong > filters.pyeongMax) return false;
      if (unitOption && !unitOption.test(getUnitCount(p))) return false;
      if (p.discountRate < filters.minDiscount) return false;
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

  // selectedId 가 바뀌면(주로 마커 클릭) 해당 매물이 있는 페이지로 자동 이동.
  // activePage를 의존성에 넣으면 사용자가 직접 페이지 클릭해도 selectedId가 가리키는
  // 옛 페이지로 되돌려져서 페이지 이동이 막힘 → 함수형 update만 사용하고 deps에서 제외.
  useEffect(() => {
    if (!selectedId || !filteredProperties.length) return;
    const idx = filteredProperties.findIndex((p) => p.id === selectedId);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / MAP_ITEMS_PER_PAGE) + 1;
    setCurrentPage((current) => (current === targetPage ? current : targetPage));
  }, [selectedId, filteredProperties]);

  // 페이지 첫 진입 시 — selectedId가 비어 있으면 현재 페이지 첫 매물 선택
  useEffect(() => {
    if (selectedId) return;
    if (!mapProperties.length) return;
    setSelectedId(mapProperties[0].id);
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

          <MapFilterBar
            filters={filters}
            onChange={setFilters}
            expanded={filterExpanded}
            setExpanded={setFilterExpanded}
            resultCount={filteredProperties.length}
          />

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

        <MapView
          properties={filteredProperties}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </section>
    </div>
  );
}

export default MapPage;
