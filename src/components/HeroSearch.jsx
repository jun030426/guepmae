import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

function HeroSearch() {
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (event) => {
    event.preventDefault();
    const query = keyword.trim();
    navigate(query ? `/properties?keyword=${encodeURIComponent(query)}` : '/properties');
  };

  return (
    <section className="hero-section">
      <div className="hero-visual" aria-hidden="true">
        <div className="skyline skyline-a" />
        <div className="skyline skyline-b" />
        <div className="skyline skyline-c" />
        <div className="skyline skyline-d" />
      </div>
      <div className="hero-overlay" />

      <div className="hero-content">
        <p className="hero-kicker">국토부 실거래가 기준 급매 플랫폼</p>
        <h1>
          실거래가로 증명된
          <br />
          급매만 모았습니다.
        </h1>
        <p className="hero-subtitle">
          시세 대비 5%이상 저렴한 매물을 한눈에 확인하세요.
        </p>

        <form className="hero-search-panel hero-search-panel--minimal" onSubmit={handleSubmit}>
          <div className="hero-search-row">
            <Search size={20} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="지역명, 단지명, 지하철역을 검색하세요."
              aria-label="지역명, 단지명, 지하철역 검색"
            />
            <button type="submit" className="primary-button">
              검색하기
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default HeroSearch;
