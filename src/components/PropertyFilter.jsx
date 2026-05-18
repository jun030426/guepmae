import { SlidersHorizontal } from 'lucide-react';

const regionOptions = ['전체', '서울', '경기', '인천', '광주', '부산'];
const priceOptions = [
  { label: '전체', value: 'all' },
  { label: '5억 이하', value: 'under-500m' },
  { label: '5억~10억', value: '500m-1b' },
  { label: '10억~20억', value: '1b-2b' },
  { label: '20억 이상', value: 'over-2b' },
];
const areaOptions = [
  { label: '전체', value: 'all' },
  { label: '40㎡ 이하', value: 'under-40' },
  { label: '40~60㎡', value: '40-60' },
  { label: '60~85㎡', value: '60-85' },
  { label: '85㎡ 이상', value: 'over-85' },
];
const discountOptions = [
  { label: '5% 이상', value: '5' },
  { label: '7% 이상', value: '7' },
  { label: '10% 이상', value: '10' },
];
const sortOptions = [
  { label: '할인율 높은 순', value: 'discount-desc' },
  { label: '최근 등록순', value: 'recent-desc' },
  { label: '가격 낮은 순', value: 'price-asc' },
];

function PropertyFilter({ filters, onFilterChange, sort, onSortChange }) {
  const updateFilter = (event) => {
    const { name, value, checked, type } = event.target;
    onFilterChange({
      ...filters,
      [name]: type === 'checkbox' ? checked : value,
    });
  };

  return (
    <aside className="filter-panel">
      <div className="filter-title">
        <SlidersHorizontal size={19} />
        <h2>조건 필터</h2>
      </div>

      <div className="filter-grid">
        <label>
          지역
          <select name="region" value={filters.region} onChange={updateFilter}>
            {regionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          가격 범위
          <select name="priceRange" value={filters.priceRange} onChange={updateFilter}>
            {priceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          전용면적
          <select name="areaRange" value={filters.areaRange} onChange={updateFilter}>
            {areaOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          할인율
          <select name="discountRate" value={filters.discountRate} onChange={updateFilter}>
            {discountOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          정렬
          <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="checkbox-filter">
        <input
          type="checkbox"
          name="verifiedOnly"
          checked={filters.verifiedOnly}
          onChange={updateFilter}
        />
        검증 완료만 보기
      </label>
    </aside>
  );
}

export default PropertyFilter;
