import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, ShieldCheck, TrendingDown } from 'lucide-react';
import UrgentBadge from './UrgentBadge.jsx';
import { formatPrice } from '../utils/priceUtils.js';
import { getPrimaryPropertyPhoto } from '../utils/propertyMedia.js';

function PropertyCard({ property, compact = false }) {
  const primaryPhoto = getPrimaryPropertyPhoto(property);

  return (
    <article className={compact ? 'property-card compact' : 'property-card'}>
      <Link to={`/properties/${property.id}`} className="property-image-link" aria-label={`${property.title} 상세 보기`}>
        <div className={primaryPhoto ? 'property-image-placeholder has-photo' : 'property-image-placeholder'}>
          {primaryPhoto && (
            <img
              className="property-card-photo"
              src={primaryPhoto.src}
              alt={primaryPhoto.alt}
              loading="lazy"
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
          <div className="discount-metric">
            <TrendingDown size={17} />
            <span>{property.discountRate}% 저렴</span>
          </div>
          <div>
            <span>최근 실거래일</span>
            <strong>{property.recentTransactionDate}</strong>
          </div>
        </div>

        <div className="property-card-actions">
          <Link to={`/properties/${property.id}`} className="outline-button">
            상세 보기
          </Link>
          <button type="button" className="contact-button">
            문의하기
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default PropertyCard;
