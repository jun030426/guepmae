import { AlertTriangle, Building2, ClipboardCheck, ShieldCheck } from 'lucide-react';
import SectionTitle from '../components/SectionTitle.jsx';
import StatCard from '../components/StatCard.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { formatPrice } from '../utils/priceUtils.js';

function Admin() {
  const { properties } = useProperties();
  const urgentProperties = properties.filter((property) => property.discountRate >= 5);
  const pendingProperties = properties.filter((property) => !property.verified).slice(0, 4);
  const verifiedProperties = urgentProperties.filter((property) => property.verified).slice(0, 5);

  // TODO: Supabase 연결 시 관리자 테이블을 실제 승인 상태, 신고 상태, 검증 로그 데이터와 동기화합니다.
  return (
    <div className="admin-page page-shell">
      <section className="page-hero compact-hero">
        <div className="container">
          <SectionTitle
            eyebrow="관리자"
            title="급매 운영 대시보드"
            description="승인 대기, 신고 매물, 가격 검증 로그를 한 화면에서 관리합니다."
          />
        </div>
      </section>

      <section className="container admin-stat-grid">
        <StatCard icon={Building2} label="승인 대기 매물" value="14건" description="중개사 확인 필요" tone="accent" />
        <StatCard icon={AlertTriangle} label="신고된 매물" value="6건" description="허위매물 신고 접수" />
        <StatCard icon={ClipboardCheck} label="검증 완료 매물" value="1,284건" description="실거래가 비교 완료" />
        <StatCard icon={ShieldCheck} label="중개사 인증 대기" value="9명" description="서류 확인 중" />
      </section>

      <section className="container admin-grid">
        <div className="admin-panel">
          <div className="admin-panel-header">
            <h2>매물 승인 테이블</h2>
            <button type="button" className="outline-button">
              검증 요청
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>매물명</th>
                  <th>지역</th>
                  <th>매도가</th>
                  <th>할인율</th>
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                {pendingProperties.map((property) => (
                  <tr key={property.id}>
                    <td>{property.title}</td>
                    <td>{property.region}</td>
                    <td>{formatPrice(property.price)}</td>
                    <td>{property.discountRate}%</td>
                    <td>
                      <div className="table-actions">
                        <button type="button">승인</button>
                        <button type="button">반려</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-panel">
          <div className="admin-panel-header">
            <h2>신고 매물 테이블</h2>
            <button type="button" className="outline-button">
              신고 처리
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>매물명</th>
                  <th>신고 사유</th>
                  <th>상태</th>
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                {verifiedProperties.slice(0, 4).map((property, index) => (
                  <tr key={property.id}>
                    <td>{property.title}</td>
                    <td>{index % 2 === 0 ? '가격 정보 상이' : '방문 불가 의심'}</td>
                    <td>확인 중</td>
                    <td>
                      <div className="table-actions">
                        <button type="button">신고 처리</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-panel wide">
          <div className="admin-panel-header">
            <h2>가격 검증 로그</h2>
            <span>최근 검증 순</span>
          </div>
          <div className="verification-log">
            {verifiedProperties.map((property) => (
              <div key={property.id} className="log-item">
                <div>
                  <strong>{property.title}</strong>
                  <span>
                    기준 실거래가 {formatPrice(property.actualTransactionPrice)} · 매도가 {formatPrice(property.price)}
                  </span>
                </div>
                <em>{property.discountRate}% 저렴</em>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Admin;
