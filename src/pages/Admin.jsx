import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, CheckCircle2, ClipboardCheck, ExternalLink, ShieldCheck, XCircle } from 'lucide-react';
import SectionTitle from '../components/SectionTitle.jsx';
import StatCard from '../components/StatCard.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { setPropertyVerified } from '../services/propertyRegistration.js';
import { formatPrice } from '../utils/priceUtils.js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

function Admin() {
  const { properties } = useProperties();
  const [refreshTick, setRefreshTick] = useState(0);
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState('');

  // 미검증 매물 (verified=false) — 운영팀 승인 대기 큐
  const pendingProperties = properties.filter((p) => !p.verified);
  const verifiedCount = properties.filter((p) => p.verified).length;

  const handleApprove = async (id) => {
    setUpdating(id);
    setError('');
    try {
      await setPropertyVerified(id, true);
      // 로컬 즉시 반영 (실제 다음 fetch까지 캐시 유지)
      setRefreshTick((t) => t + 1);
      window.location.reload(); // 간단하게 reload — useProperties 가 재페치
    } catch (err) {
      setError(`승인 실패: ${err.message}`);
      setUpdating(null);
    }
  };

  const handleReject = async (id, title) => {
    if (!confirm(`정말로 "${title}" 매물을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setUpdating(id);
    setError('');
    try {
      const { error: delError } = await supabase.from('properties').delete().eq('id', id);
      if (delError) throw delError;
      window.location.reload();
    } catch (err) {
      setError(`반려/삭제 실패: ${err.message}`);
      setUpdating(null);
    }
  };

  return (
    <div className="admin-page page-shell">
      <section className="page-hero compact-hero">
        <div className="container">
          <SectionTitle
            eyebrow="관리자"
            title="급매 운영 대시보드"
            description="매물 승인, 신고 처리, 검증 로그를 한 화면에서 관리합니다."
          />
        </div>
      </section>

      <section className="container admin-stat-grid">
        <StatCard
          icon={Building2}
          label="승인 대기 매물"
          value={`${pendingProperties.length}건`}
          description="중개사 등록 후 검토 필요"
          tone="accent"
        />
        <StatCard
          icon={ClipboardCheck}
          label="검증 완료 매물"
          value={`${verifiedCount}건`}
          description="플랫폼 전체 노출 중"
        />
        <StatCard
          icon={AlertTriangle}
          label="신고된 매물"
          value="0건"
          description="신고 기능 준비 중"
        />
        <StatCard
          icon={ShieldCheck}
          label="중개사 인증 대기"
          value="0명"
          description="agent_applications 연동 예정"
        />
      </section>

      {error && (
        <section className="container">
          <p className="form-status error">{error}</p>
        </section>
      )}

      <section className="container admin-grid">
        <div className="admin-panel wide">
          <div className="admin-panel-header">
            <h2>매물 승인 대기 ({pendingProperties.length})</h2>
            <span>중개사가 등록한 새 매물 — 승인하면 일반 사이트에 "검증 완료" 라벨로 노출됨</span>
          </div>
          {pendingProperties.length === 0 ? (
            <p className="admin-empty">승인 대기 중인 매물이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>매물명</th>
                    <th>지역</th>
                    <th>매도가</th>
                    <th>할인율</th>
                    <th>등록일</th>
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingProperties.map((property) => (
                    <tr key={property.id}>
                      <td>
                        <Link to={`/properties/${property.id}`} className="admin-link" target="_blank">
                          {property.title}
                          <ExternalLink size={12} />
                        </Link>
                      </td>
                      <td>{property.region}</td>
                      <td>{formatPrice(property.price)}</td>
                      <td>{property.discountRate}%</td>
                      <td>{property.lastVerifiedAt}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="admin-approve-button"
                            disabled={updating === property.id}
                            onClick={() => handleApprove(property.id)}
                          >
                            <CheckCircle2 size={14} />
                            {updating === property.id ? '처리 중...' : '승인'}
                          </button>
                          <button
                            type="button"
                            className="admin-reject-button"
                            disabled={updating === property.id}
                            onClick={() => handleReject(property.id, property.title)}
                          >
                            <XCircle size={14} />
                            반려
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="admin-panel wide">
          <div className="admin-panel-header">
            <h2>검증 완료 매물 ({verifiedCount}건)</h2>
            <span>현재 사이트에 노출 중인 매물</span>
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
                {properties.filter((p) => p.verified).slice(0, 10).map((property) => (
                  <tr key={property.id}>
                    <td>
                      <Link to={`/properties/${property.id}`} className="admin-link" target="_blank">
                        {property.title}
                        <ExternalLink size={12} />
                      </Link>
                    </td>
                    <td>{property.region}</td>
                    <td>{formatPrice(property.price)}</td>
                    <td>{property.discountRate}%</td>
                    <td>
                      <button
                        type="button"
                        className="admin-revoke-button"
                        disabled={updating === property.id}
                        onClick={async () => {
                          if (!confirm(`"${property.title}" 검증을 취소(노출 중단)하시겠습니까?`)) return;
                          setUpdating(property.id);
                          try {
                            await setPropertyVerified(property.id, false);
                            window.location.reload();
                          } catch (err) {
                            setError(`검증 취소 실패: ${err.message}`);
                            setUpdating(null);
                          }
                        }}
                      >
                        검증 취소
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Admin;
