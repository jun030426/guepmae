import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PropertyCard from '../components/PropertyCard.jsx';
import PropertyFilter from '../components/PropertyFilter.jsx';
import SectionTitle from '../components/SectionTitle.jsx';
import { useProperties } from '../hooks/useProperties.js';

// TODO: 실제 서비스에서는 사용자가 직접 등록한 매물과 Supabase 데이터를 사용해야 함.

const initialFilters = {
  region: '전체',
  priceRange: 'all',
  areaRange: 'all',
  discountRate: '5',
  verifiedOnly: false,
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
  const { properties: urgentProperties } = useProperties({ urgentOnly: true });
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState('discount-desc');
  const [currentPage, setCurrentPage] = useState(1);
  const location = useLocation();
  const keyword = new URLSearchParams(location.search).get('keyword')?.toLowerCase() ?? '';

  const filteredProperties = useMemo(() => {
    const result = urgentProperties
      .filter((property) => {
        const keywordTarget = `${property.title} ${property.address} ${property.region}`.toLowerCase();

        return (
          (!keyword || keywordTarget.includes(keyword)) &&
          (filters.region === '전체' || property.region.includes(filters.region)) &&
          matchesPriceRange(property.price, filters.priceRange) &&
          matchesAreaRange(property.area, filters.areaRange) &&
          property.discountRate >= Number(filters.discountRate) &&
          (!filters.verifiedOnly || property.verified)
        );
      })
      .sort((a, b) => {
        if (sort === 'score-desc') return b.urgentScore - a.urgentScore;
        if (sort === 'recent-desc') return new Date(b.lastVerifiedAt) - new Date(a.lastVerifiedAt);
        if (sort === 'price-asc') return a.price - b.price;
        return b.discountRate - a.discountRate;
      });

    return result;
  }, [urgentProperties, filters, keyword, sort]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, keyword, sort]);

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
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);
  const visibleStart = filteredProperties.length === 0 ? 0 : (activePage - 1) * ITEMS_PER_PAGE + 1;
  const visibleEnd = Math.min(activePage * ITEMS_PER_PAGE, filteredProperties.length);

  return (
    <div className="page-shell">
      <section className="page-hero compact-hero">
        <div className="container">
          <SectionTitle
            eyebrow="급매 매물 목록"
            title="검증된 급매 매물"
            description="실거래가 대비 5% 이상 저렴한 매물만 선별했습니다."
          />
        </div>
      </section>

      <section className="container listing-layout">
        <PropertyFilter
          filters={filters}
          onFilterChange={setFilters}
          sort={sort}
          onSortChange={setSort}
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
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={activePage === 1}
                  >
                    이전
                  </button>

                  <div className="pagination-pages">
                    {pageNumbers.map((pageNumber) => (
                      <button
                        type="button"
                        key={pageNumber}
                        className={`pagination-page ${pageNumber === activePage ? 'active' : ''}`}
                        onClick={() => setCurrentPage(pageNumber)}
                        aria-current={pageNumber === activePage ? 'page' : undefined}
                      >
                        {pageNumber}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="pagination-control"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={activePage === totalPages}
                  >
                    다음
                  </button>
                </nav>
              )}
            </>
          ) : (
            <div className="empty-state">
              <h3>조건에 맞는 급매가 없습니다.</h3>
              <p>지역 또는 할인율 조건을 조금 넓혀 다시 확인해보세요.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default Properties;
