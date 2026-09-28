import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, ShieldCheck, TrendingDown } from 'lucide-react';
import UrgentBadge from './UrgentBadge.jsx';
import { formatPrice } from '../utils/priceUtils.js';
import { formatPriceEvidence, hasPriceConflict } from '../utils/priceEvidence.js';
import { getPrimaryPropertyPhoto } from '../utils/propertyMedia.js';

function PropertyCard({ property, compact = false }) {
  const primaryPhoto = getPrimaryPropertyPhoto(property);
  // 외부 CDN 사진이 죽으면 자리 표시자로 폴백
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = primaryPhoto && !photoFailed;
  const savedAmount = property.actualTransactionPrice - property.price;
  // 홈이 "표본 수와 기간까지 매물마다 공개합니다"라고 약속하는 그 근거
  const evidence = formatPriceEvidence(property.priceBasis);
  const priceConflict = hasPriceConflict(property);

  return (
    <article className={compact ? 'property-card compact' : 'property-card'}>
      <Link to={`/properties/${property.id}`} className="property-image-link" aria-label={`${property.title} 상세 보기`}>
        <div className={showPhoto ? 'property-image-placeholder has-photo' : 'property-image-placeholder'}>
          {showPhoto && (
            <img
              className="property-card-photo"
              src={primaryPhoto.src}
              alt={primaryPhoto.alt}
              loading="lazy"
              onError={() => setPhotoFailed(true)}
            />
          )}
        </div>
      </Link>

      <div className="property-card-body">
        <div className="property-card-topline">
          <UrgentBadge discountRate={property.discountRate} verified={property.verified} />
          {property.verified && (
            <span className="verified-chip">
              <ShieldCheck size={14} />
              검증 완료
            </span>
          )}
        </div>

        <Link to={`/properties/${property.id}`} className="property-title-link">
          <h3>{property.title}</h3>
        </Link>
        <p className="property-location">
          <MapPin size={15} />
          {property.region}
        </p>

        <div className="discount-headline">
          <TrendingDown size={20} aria-hidden="true" />
          <strong>{property.discountRate}%</strong>
          <span>
            {savedAmount > 0
              ? `기준 실거래가 대비 ${formatPrice(savedAmount)} 저렴`
              : '기준 실거래가 대비'}
          </span>
        </div>

        {evidence && <p className="price-evidence">{evidence} 중앙값 · 국토부</p>}
        {priceConflict && (
          <p className="price-conflict-chip">설명문에 다른 금액 표기 — 매도가 확인 필요</p>
        )}

        <div className="price-stack">
          <div>
            <span>매도가</span>
            <strong>{formatPrice(property.price)}</strong>
          </div>
          <div>
            <span>기준 실거래가</span>
            <strong>{formatPrice(property.actualTransactionPrice)}</strong>
          </div>
        </div>

        <div className="property-metrics">
          <div>
            <span>최근 실거래일</span>
            <strong>{property.recentTransactionDate}</strong>
          </div>
        </div>

        <div className="property-card-actions">
          <Link to={`/properties/${property.id}`} className="outline-button">
            상세 보기
          </Link>
          <Link to={`/properties/${property.id}#agent`} className="contact-button">
            문의하기
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export default PropertyCard;
