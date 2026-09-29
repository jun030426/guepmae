import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PropertyCard from '../components/PropertyCard.jsx';
import PropertyFilter from '../components/PropertyFilter.jsx';
import SectionTitle from '../components/SectionTitle.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { getPaginationItems } from '../utils/pagination.js';
import { getSavedIds } from '../utils/savedProperties.js';

// 매물 데이터는 useProperties 훅을 통해 로컬 번들(public/data) + 등록 매물(localStorage)에서 가져옴.

const initialFilters = {
  region: '전체',
  priceRange: 'all',
  areaRange: 'all',
  discountRate: '5',
};

const ITEMS_PER_PAGE = 10;

function matchesPriceRange(price, range) {
  if (range === 'under-500m') return price <= 500000000;
  if (range === '500m-1b') return price > 500000000 && price <= 1000000000;
  if (range === '1b-2b') return price > 1000000000 && price <= 2000000000;
  if (range === 'over-2b') return price > 2000000000;
  return true;
}

function matchesAreaRange(area, range) {
  if (range === 'under-40') return area <= 40;
  if (range === '40-60') return area > 40 && area <= 60;
  if (range === '60-85') return area > 60 && area <= 85;
  if (range === 'over-85') return area > 85;
  return true;
}

function Properties() {
  const { properties: urgentProperties, isLoading } = useProperties({ urgentOnly: true, verifiedOnly: true });
  // 필터·정렬·페이지·검색어를 전부 URL에 둔다 — 뒤로가기로 되돌릴 수 있고 링크로 공유된다.
  // 기본값은 URL에 쓰지 않아 주소가 조건을 바꾼 만큼만 길어진다.
  const [searchParams, setSearchParams] = useSearchParams();
  const keyword = (searchParams.get('keyword') ?? '').toLowerCase();

  const filters = useMemo(() => ({
    region: searchParams.get('region') ?? initialFilters.region,
    priceRange: searchParams.get('price') ?? initialFilters.priceRange,
    areaRange: searchParams.get('area') ?? initialFilters.areaRange,
    discountRate: searchParams.get('discount') ?? initialFilters.discountRate,
  }), [searchParams]);
  const sort = searchParams.get('sort') ?? 'discount-desc';
  const currentPage = Math.max(1, Number(searchParams.get('page')) || 1);
  // 저장한 매물 보기 — 헤더에서 /properties?saved=1 로 진입
  const savedOnly = searchParams.get('saved') === '1';
  const savedIds = useMemo(() => (savedOnly ? getSavedIds() : []), [savedOnly]);

  // 값이 기본값이면 파라미터를 지워 URL을 짧게 유지
  const writeParams = (patch, { keepPage = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    if (!keepPage) next.delete('page');
    setSearchParams(next);
  };

  const handleFilterChange = (next) => {
    writeParams({
      region: next.region === initialFilters.region ? null : next.region,
      price: next.priceRange === initialFilters.priceRange ? null : next.priceRange,
      area: next.areaRange === initialFilters.areaRange ? null : next.areaRange,
      discount: next.discountRate === initialFilters.discountRate ? null : next.discountRate,
    });
  };

  const handleSortChange = (next) => writeParams({ sort: next === 'discount-desc' ? null : next });
  const setCurrentPage = (page) => writeParams({ page: page === 1 ? null : page }, { keepPage: true });
  // 초기화해도 '저장한 매물' 보기 자체는 유지한다 (조건만 지운다)
  const resetFilters = () => {
    const next = new URLSearchParams();
    if (searchParams.get('saved') === '1') next.set('saved', '1');
    setSearchParams(next);
  };

  // 기본값과 다른 조건이 하나라도 걸려 있으면 초기화 버튼을 띄운다
  const hasActiveFilters =
    Boolean(keyword) ||
    sort !== 'discount-desc' ||
    filters.region !== initialFilters.region ||
    filters.priceRange !== initialFilters.priceRange ||
    filters.areaRange !== initialFilters.areaRange ||
    filters.discountRate !== initialFilters.discountRate;

  const filteredProperties = useMemo(() => {
    const result = urgentProperties
      .filter((property) => {
        const keywordTarget = `${property.title} ${property.address} ${property.region}`.toLowerCase();

        return (
          (!savedOnly || savedIds.includes(property.id)) &&
          (!keyword || keywordTarget.includes(keyword)) &&
          (filters.region === '전체' || property.region.includes(filters.region)) &&
          matchesPriceRange(property.price, filters.priceRange) &&
          matchesAreaRange(property.area, filters.areaRange) &&
          property.discountRate >= Number(filters.discountRate)
        );
      })
      .sort((a, b) => {
        if (sort === 'score-desc') return b.urgentScore - a.urgentScore;
        if (sort === 'recent-desc') return new Date(b.lastVerifiedAt) - new Date(a.lastVerifiedAt);
        if (sort === 'price-asc') return a.price - b.price;
        return b.discountRate - a.discountRate;
      });

    return result;
  }, [urgentProperties, filters, keyword, sort, savedOnly, savedIds]);

  // 페이지 이동 시 최상단으로 스크롤 — 사용자가 새 페이지를 한눈에 볼 수 있게
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredProperties.length / ITEMS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const pagedProperties = useMemo(() => {
    const startIndex = (activePage - 1) * ITEMS_PER_PAGE;
    return filteredProperties.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [activePage, filteredProperties]);
  const pageItems = useMemo(() => getPaginationItems(activePage, totalPages), [activePage, totalPages]);
  const visibleStart = filteredProperties.length === 0 ? 0 : (activePage - 1) * ITEMS_PER_PAGE + 1;
  const visibleEnd = Math.min(activePage * ITEMS_PER_PAGE, filteredProperties.length);

  return (
    <div className="page-shell">
      <section className="page-hero compact-hero">
        <div className="container">
          <SectionTitle
            as="h1"
            title={savedOnly ? '저장한 매물' : '검증된 급매 매물'}
            description={
              savedOnly
                ? '이 브라우저에 저장한 매물입니다. 상세 페이지의 저장 버튼으로 추가·해제할 수 있습니다.'
                : '실거래가 대비 5% 이상 저렴한 매물만 선별했습니다.'
            }
          />
        </div>
      </section>

      <section className="container listing-layout">
        <PropertyFilter
          filters={filters}
          onFilterChange={handleFilterChange}
          sort={sort}
          onSortChange={handleSortChange}
        />

        <div className="listing-content">
          <div className="listing-summary">
            <p>
              총 <strong>{filteredProperties.length}</strong>건의 급매가 조건에 맞습니다.
              {filteredProperties.length > 0 && (
                <span> 현재 {visibleStart}-{visibleEnd}건 표시</span>
              )}
              {keyword && <span> 검색어: {keyword}</span>}
            </p>
            {hasActiveFilters && (
              <button type="button" className="outline-button listing-reset" onClick={resetFilters}>
                조건 초기화
              </button>
            )}
          </div>

          {filteredProperties.length > 0 ? (
            <>
              <div className="property-grid listing-grid">
                {pagedProperties.map((property) => (
                  <PropertyCard key={property.id} property={property} />
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="pagination" aria-label="급매 목록 페이지">
                  <button
                    type="button"
                    className="pagination-control"
                    onClick={() => setCurrentPage(Math.max(1, activePage - 1))}
                    disabled={activePage === 1}
                  >
                    이전
                  </button>

                  <div className="pagination-pages">
                    {pageItems.map((item) =>
                      typeof item === 'number' ? (
                        <button
                          type="button"
                          key={item}
                          className={`pagination-page ${item === activePage ? 'active' : ''}`}
                          onClick={() => setCurrentPage(item)}
                          aria-current={item === activePage ? 'page' : undefined}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={item} className="pagination-ellipsis" aria-hidden="true">
                          …
                        </span>
                      ),
                    )}
                  </div>

                  <button
                    type="button"
                    className="pagination-control"
                    onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))}
                    disabled={activePage === totalPages}
                  >
                    다음
                  </button>
                </nav>
              )}
            </>
          ) : isLoading ? (
            <div className="empty-state">
              <h3>급매를 불러오는 중...</h3>
            </div>
          ) : (
            <div className="empty-state">
              <h3>
                {savedOnly
                  ? '저장한 매물이 없습니다.'
                  : filters.region !== '전체'
                    ? `${filters.region}에 등록된 급매가 없습니다.`
                    : '조건에 맞는 급매가 없습니다.'}
              </h3>
              <p>
                {savedOnly
                  ? '매물 상세 페이지의 저장 버튼을 누르면 여기에 모입니다. 저장 정보는 이 브라우저에만 보관됩니다.'
                  : '기준 실거래가 대비 5% 이상 저렴한 매물만 노출하기 때문에, 조건이 좁으면 결과가 없을 수 있습니다. 지역 또는 할인율 조건을 넓혀 다시 확인해보세요.'}
              </p>
              <div className="empty-state-actions">
                <button type="button" className="outline-button" onClick={resetFilters}>
                  필터 초기화
                </button>
                {keyword && (
                  <Link to="/properties" className="outline-button">
                    검색어 지우기
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default Properties;
