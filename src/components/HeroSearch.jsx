import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

const tabs = ['매물', '실거래가 비교', '집 내놓기'];

function HeroSearch() {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (event) => {
    event.preventDefault();
    const query = keyword.trim();

    if (activeTab === '집 내놓기') {
      navigate('/register');
      return;
    }

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
          국토부 실거래가 대비 5% 이상 저렴한 매물을 한눈에 비교하세요.
        </p>

        <form className="hero-search-panel" onSubmit={handleSubmit}>
          <div className="search-tabs" role="tablist" aria-label="검색 목적">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className={activeTab === tab ? 'search-tab active' : 'search-tab'}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

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

        <div className="hero-cta-row">
          <Link to="/properties" className="hero-cta primary">
            매물
          </Link>
          <Link to="/register" className="hero-cta secondary">
            내 매물 급매 검증하기
          </Link>
        </div>
      </div>
    </section>
  );
}

export default HeroSearch;
