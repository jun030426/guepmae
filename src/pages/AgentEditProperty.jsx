import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useProperty } from '../hooks/useProperties.js';
import { supabase } from '../lib/supabaseClient.js';
import { formatPrice } from '../utils/priceUtils.js';

function AgentEditProperty() {
  const { id } = useParams();
  const { property, isLoading } = useProperty(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!property) return;
    setForm({
      title: property.title,
      price: String(property.price ?? ''),
      floor: property.floor ?? '',
      rooms: property.rooms ?? 0,
      bathrooms: property.bathrooms ?? 0,
      parking: property.parking ?? '',
      description: property.description ?? '',
    });
  }, [property]);

  if (isLoading || !form) {
    return (
      <div className="page-shell agent-register-page">
        <section className="container">
          <p className="admin-empty">불러오는 중...</p>
        </section>
      </div>
    );
  }

  const update = (key) => (event) => setForm((s) => ({ ...s, [key]: event.target.value }));

  // 기준 실거래가는 등록 시 확정된 값 유지, 매도가만 바꾸면 할인율 재계산
  const market = property.actualTransactionPrice || Number(form.price);
  const newDiscount =
    market > 0 ? (((market - Number(form.price)) / market) * 100).toFixed(1) : '0.0';

  const handleSave = async (event) => {
    event.preventDefault();
    if (!form.title || !form.price) {
      setError('매물 타이틀과 매도 호가는 필수입니다.');
      return;
    }
    setSaving(true);
    setError('');
    const { data, error: updateError } = await supabase
      .from('properties')
      .update({
        title: form.title,
        price: Number(form.price),
        discount_rate: Number(newDiscount),
        floor: form.floor,
        rooms: Number(form.rooms),
        bathrooms: Number(form.bathrooms),
        parking: form.parking || '미공개',
        description: form.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id');
    if (updateError) {
      setError(`수정 실패: ${updateError.message}`);
      setSaving(false);
      return;
    }
    if (!data || data.length === 0) {
      setError('권한이 없거나 매물이 존재하지 않아 수정되지 않았습니다.');
      setSaving(false);
      return;
    }
    navigate(`/properties/${id}`, { replace: true });
  };

  return (
    <div className="page-shell agent-register-page">
      <section className="container agent-register-hero">
        <p className="section-eyebrow">매물 수정</p>
        <h1>{property.title}</h1>
        <p>자주 바뀌는 정보를 수정할 수 있습니다. 단지·면적·주소 등 구조 정보는 변경하려면 삭제 후 재등록해주세요.</p>
      </section>

      <form className="container agent-register-form" onSubmit={handleSave}>
        <fieldset className="register-section">
          <legend>기본 정보</legend>
          <label>
            매물 타이틀 *
            <input type="text" value={form.title} onChange={update('title')} required />
          </label>
        </fieldset>

        <fieldset className="register-section">
          <legend>가격</legend>
          <label>
            매도 호가 (원) *
            <input type="number" min="0" step="100000" value={form.price} onChange={update('price')} required />
          </label>
          {market > 0 && (
            <p className="register-hint">
              기준 실거래가 {formatPrice(market)} 대비 예상 할인율 <strong>{newDiscount}%</strong>
              {Number(newDiscount) >= 5 ? ' — 급매 기준 충족' : ''}
            </p>
          )}
        </fieldset>

        <fieldset className="register-section">
          <legend>구조</legend>
          <div className="register-grid-3">
            <label>
              층
              <input type="text" value={form.floor} onChange={update('floor')} placeholder="예: 12층" />
            </label>
            <label>
              방 개수
              <input type="number" min="0" max="6" value={form.rooms} onChange={update('rooms')} />
            </label>
            <label>
              욕실 개수
              <input type="number" min="0" max="4" value={form.bathrooms} onChange={update('bathrooms')} />
            </label>
          </div>
          <label>
            주차
            <input type="text" value={form.parking} onChange={update('parking')} placeholder="예: 세대당 1.3대" />
          </label>
        </fieldset>

        <fieldset className="register-section">
          <legend>매물 설명</legend>
          <textarea value={form.description} onChange={update('description')} rows={6} />
        </fieldset>

        {error && <p className="form-status error">{error}</p>}

        <div className="register-submit-row">
          <button type="button" className="auth-text-button" onClick={() => navigate('/agent/properties')}>
            목록으로
          </button>
          <button type="submit" className="primary-link-button" disabled={saving}>
            {saving ? '저장 중...' : '수정 저장'}
            {!saving && <ArrowRight size={17} />}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AgentEditProperty;
