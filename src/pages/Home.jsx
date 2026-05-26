import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import HeroSearch from '../components/HeroSearch.jsx';
import PropertyCard from '../components/PropertyCard.jsx';
import SectionTitle from '../components/SectionTitle.jsx';
import { useProperties } from '../hooks/useProperties.js';

function Home() {
  const { properties: urgentProperties } = useProperties({ urgentOnly: true });
  const verifiedDeals = urgentProperties.filter((property) => property.verified).slice(0, 6);

  return (
    <div className="home-page">
      <HeroSearch />

      <section className="section featured-section">
        <div className="container">
          <div className="section-heading-row">
            <SectionTitle
              eyebrow="추천 급매"
              title="오늘의 급매 순위"
              description="가격 차이와 최근 확인일을 함께 보고 비교하세요."
            />
            <Link to="/properties" className="text-arrow-link">
              전체 보기
              <ArrowRight size={17} />
            </Link>
          </div>

          <div className="property-grid">
            {verifiedDeals.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;
