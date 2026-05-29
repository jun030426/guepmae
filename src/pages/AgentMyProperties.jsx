import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { supabase } from '../lib/supabaseClient.js';
import { formatPrice } from '../utils/priceUtils.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function AgentMyProperties() {
  const { profile } = useAuth();
  const { properties, refresh } = useProperties();
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');

  const myEmail = profile?.email;
  const mine = useMemo(() => {
    const list = properties.filter((p) => myEmail && p.agent?.email === myEmail);
    return [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [properties, myEmail]);

  const handleDelete = (property) => {
    setConfirm({
      title: '매물 삭제',
      message: `"${property.title}" 매물을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: async () => {
        setError('');
        const { data, error: delError } = await supabase
          .from('properties')
          .delete()
          .eq('id', property.id)
          .select('id');
        if (delError) {
          setError(`삭제 실패: ${delError.message}`);
          return;
        }
        if (!data || data.length === 0) {
          setError('권한이 없거나 매물이 존재하지 않아 삭제되지 않았습니다.');
          return;
        }
        await refresh();
      },
    });
  };

  return (
    <div className="page-shell agent-dashboard">
      <section className="container">
        <div className="agent-dashboard-header">
          <div>
            <p className="section-eyebrow">내 등록 매물</p>
            <h1>내가 등록한 매물</h1>
            <p className="agent-dashboard-subtitle">{mine.length}건 — 수정하거나 삭제할 수 있습니다.</p>
          </div>
          <Link to="/agent/properties/new" className="primary-link-button agent-dashboard-cta">
            <Plus size={17} />
            새 매물 등록
          </Link>
        </div>

        {error && <p className="form-status error">{error}</p>}

        {mine.length === 0 ? (
          <p className="admin-empty">아직 등록한 매물이 없습니다. 새 매물을 등록해보세요.</p>
        ) : (
          <div className="admin-scroll-table">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>매물명</th>
                  <th>지역</th>
                  <th>매도가</th>
                  <th>할인율</th>
                  <th>상태</th>
                  <th>등록일</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((property) => (
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
                      {property.verified ? (
                        <span className="status-badge ok">검증 완료</span>
                      ) : (
                        <span className="status-badge wait">승인 대기</span>
                      )}
                    </td>
                    <td>{formatDate(property.createdAt)}</td>
                    <td className="my-property-actions">
                      <Link to={`/agent/properties/${property.id}/edit`} className="row-action edit">
                        <Pencil size={13} /> 수정
                      </Link>
                      <button type="button" className="row-action delete" onClick={() => handleDelete(property)}>
                        <Trash2 size={13} /> 삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

export default AgentMyProperties;
