import {
  ArrowRight,
  BarChart3,
  Building2,
  MapPin,
  TrendingDown,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import HeroSearch from '../components/HeroSearch.jsx';
import PropertyCard from '../components/PropertyCard.jsx';
import SectionTitle from '../components/SectionTitle.jsx';
import { monthlyUrgentTrend } from '../data/properties.js';
import { useProperties } from '../hooks/useProperties.js';

const neighborhoods = [
  {
    title: '강남 생활권',
    description: '강남역, 선릉, 반포를 잇는 직주근접 고가 단지 중심',
    count: 18,
  },
  {
    title: '마포·공덕 생활권',
    description: '여의도와 광화문 접근성이 강한 실거주 선호 지역',
    count: 12,
  },
  {
    title: '분당·판교 생활권',
    description: '판교 테크노밸리와 신분당선 축을 중심으로 탐색',
    count: 16,
  },
  {
    title: '송도 생활권',
    description: '국제업무지구, 센트럴파크, 신축 대단지 중심',
    count: 9,
  },
  {
    title: '광주 수완지구',
    description: '학군과 상권이 함께 형성된 광주 대표 주거지',
    count: 7,
  },
  {
    title: '부산 해운대',
    description: '오션뷰, 센텀 접근성, 고급 주거 수요가 모이는 곳',
    count: 11,
  },
];

const popularRegionGroups = [
  ['서울 강남구', '서울 서초구', '서울 송파구', '서울 성동구', '서울 마포구'],
  ['경기 성남시', '경기 광명시', '경기 화성시', '경기 고양시', '경기 용인시'],
  ['인천 연수구', '인천 남동구', '부산 해운대구', '부산 부산진구', '광주 광산구'],
  ['송도국제도시', '분당·판교', '마포·공덕', '수완지구', '해운대 마린시티'],
];

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

      <section className="section lifestyle-section">
        <div className="container">
          <SectionTitle
            eyebrow="생활권"
            title="생활권으로 찾는 급매"
            description="행정구역보다 실제 이동과 생활 패턴에 가까운 단위로 살펴보세요."
            align="center"
          />
          <div className="neighborhood-grid">
            {neighborhoods.map((item) => (
              <article className="neighborhood-card" key={item.title}>
                <div className="neighborhood-visual" />
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <span>
                    <MapPin size={15} />
                    검증 급매 {item.count}건
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section verify-cta-section">
        <div className="container split-grid reverse">
          <div className="split-visual verify-visual" aria-hidden="true">
            <div className="verify-panel">
              <span>희망 매도가</span>
              <strong>8억 7,500만 원</strong>
              <em>실거래가 대비 5.9% 저렴</em>
            </div>
          </div>
          <div className="split-copy">
            <SectionTitle
              eyebrow="매도자 검증"
              title="내 매물, 급매 기준에 해당할까요?"
              description="주소와 희망 매도가를 입력하면 최근 실거래가와 비교해 등록 가능성을 계산합니다."
            />
            <div className="cta-copy-list">
              <p>5% 이상 낮으면 급매 등록 가능 여부를 안내합니다.</p>
              <p>데이터가 부족하면 비교 기준과 추가 확인 절차를 보여줍니다.</p>
            </div>
            <Link to="/register" className="primary-link-button">
              집 내놓기
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section report-preview-section">
        <div className="container report-preview-grid">
          <div>
            <SectionTitle
              eyebrow="급매 리포트"
              title="지역별 급매 흐름을 데이터로 확인하세요."
              description="평균 할인율, 가격 하락 지역, 거래량 변화, 급매 집중 지역을 한눈에 봅니다."
            />
            <div className="report-preview-list">
              <span>
                <BarChart3 size={18} />
                평균 할인율 추이
              </span>
              <span>
                <TrendingDown size={18} />
                가격 하락 지역
              </span>
              <span>
                <Building2 size={18} />
                최근 거래량 변화
              </span>
            </div>
            <Link to="/report" className="outline-dark-button">
              리포트 자세히 보기
            </Link>
          </div>

          <div className="chart-card large">
            <div className="chart-title-row">
              <h3>급매 평균 할인율</h3>
              <span>최근 6개월</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthlyUrgentTrend} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="discountGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#111111" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#111111" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e5e5e5" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} unit="%" />
                <Tooltip formatter={(value) => [`${value}%`, '평균 할인율']} />
                <Area
                  type="monotone"
                  dataKey="averageDiscount"
                  stroke="#111111"
                  fill="url(#discountGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="section popular-cities-section">
        <div className="container">
          <SectionTitle
            eyebrow="인기 지역"
            title="많이 찾는 급매 지역"
            description="급매 탐색이 많은 지역과 생활권을 빠르게 확인하세요."
          />
          <div className="popular-region-grid">
            {popularRegionGroups.map((group, groupIndex) => (
              <ul key={groupIndex}>
                {group.map((region) => (
                  <li key={region}>
                    <Link to={`/properties?keyword=${encodeURIComponent(region)}`}>
                      {region} 급매
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;
