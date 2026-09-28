import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import HeroSearch from '../components/HeroSearch.jsx';
import PropertyCard from '../components/PropertyCard.jsx';
import SectionTitle from '../components/SectionTitle.jsx';
import UrgentBadge from '../components/UrgentBadge.jsx';
import { useProperties } from '../hooks/useProperties.js';

// 첫 방문자에게 낯선 건 '검증'이라는 개념 하나뿐 — 수집→산출→선별 순서 자체가 정보라 번호를 붙인다.
const verifySteps = [
  {
    title: '국토부 실거래가 수집',
    detail: '전국 시군구의 아파트 매매 실거래 계약을 최근 3년치 수집합니다. 호가는 쓰지 않습니다.',
  },
  {
    title: '같은 단지 · 같은 전용면적 중앙값',
    detail: '동일 단지, 동일 전용면적의 실제 거래가만으로 기준 실거래가를 산출합니다. 추정값은 없습니다.',
  },
  {
    title: '5% 이상 저렴할 때만 급매',
    detail: '기준 대비 할인율이 5%를 넘는 매물만 노출하고, 표본 수와 기간까지 매물마다 공개합니다.',
  },
];

function Home() {
  const { properties: urgentProperties } = useProperties({ urgentOnly: true });
  const verifiedDeals = urgentProperties.filter((property) => property.verified).slice(0, 6);

  return (
    <div className="home-page">
      <HeroSearch />

      <section className="section verify-strip" aria-labelledby="verify-strip-title">
        <div className="container">
          <div className="verify-strip-head">
            <h2 id="verify-strip-title">&ldquo;급매&rdquo;라는 말을 이렇게 검증합니다</h2>
            <p>중개사의 표현이 아니라 국토교통부 실거래 데이터가 기준입니다.</p>
          </div>

          <ol className="verify-strip-rail">
            {verifySteps.map(({ title, detail }, index) => (
              <li key={title} className="verify-step">
                <span className="verify-step-number" aria-hidden="true">{index + 1}</span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </li>
            ))}
          </ol>

          <div className="verify-strip-legend">
            <div className="verify-legend-badges">
              <span className="verify-legend-item">
                <UrgentBadge discountRate={7} verified />
                기준 대비 5% 이상 저렴
              </span>
              <span className="verify-legend-item">
                <UrgentBadge discountRate={12} verified />
                기준 대비 10% 이상 저렴
              </span>
            </div>
            <p>산출 근거는 각 매물의 &lsquo;가격 검증 리포트&rsquo;에서 실거래 내역과 함께 확인할 수 있습니다.</p>
          </div>
        </div>
      </section>

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
