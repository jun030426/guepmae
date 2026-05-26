import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { registerProperty } from '../services/propertyRegistration.js';
import { formatPhone, PHONE_MAX_LENGTH } from '../utils/phoneFormat.js';

const SALE_REASONS = [
  { value: '양도세 마감 임박', label: '양도세 마감 임박' },
  { value: '이사/실거주 처분', label: '이사 또는 실거주 처분' },
  { value: '투자 정리', label: '투자 매물 정리' },
  { value: '이혼/상속', label: '이혼/상속 등 가사 사유' },
  { value: '대출/자금 사정', label: '대출 만기/자금 사정' },
  { value: '기타', label: '기타 (상세 설명)' },
];

const DIRECTIONS = ['남향', '동향', '서향', '북향', '남동향', '남서향'];

const initialForm = {
  title: '',
  address: '',
  region: '',
  lat: '',
  lng: '',
  area: '',
  supplyArea: '',
  floor: '',
  direction: '남향',
  rooms: 3,
  bathrooms: 2,
  builtYear: '',
  unitCount: '',
  price: '',
  actualTransactionPrice: '',
  parking: '',
  maintenanceFee: '',
  moveInDate: '협의',
  saleReason: '양도세 마감 임박',
  saleDeadline: '',
  description: '',
  agencyName: '',
  agentPhone: '',
  photos: [], // File[] — 사진 업로드용
};

function AgentRegisterProperty() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const update = (key) => (event) => {
    const raw = event.target.value;
    const nextValue = key === 'agentPhone' ? formatPhone(raw) : raw;
    setForm((s) => ({ ...s, [key]: nextValue }));
  };

  // 필수 항목 — key: 사람이 읽는 라벨
  const REQUIRED_FIELDS = {
    title: '매물 타이틀',
    region: '지역',
    address: '주소',
    area: '전용면적',
    floor: '층',
    builtYear: '건축연도',
    price: '매도 호가',
    actualTransactionPrice: '기준 실거래가',
    description: '매물 설명',
  };

  // 비어있는 필수 항목 목록
  const missingFields = Object.entries(REQUIRED_FIELDS)
    .filter(([key]) => !form[key])
    .map(([, label]) => label);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (missingFields.length > 0) {
      setError(`다음 항목을 입력해주세요: ${missingFields.join(', ')}`);
      // 첫 번째 빠진 필드로 스크롤 + 포커스
      const firstMissingKey = Object.keys(REQUIRED_FIELDS).find((k) => !form[k]);
      const el = document.querySelector(`[name="${firstMissingKey}"], [data-field="${firstMissingKey}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof el.focus === 'function') setTimeout(() => el.focus(), 300);
      }
      return;
    }
    setError('');
    setSubmitting(true);

    // 매도 사유와 마감일을 description 에 자동 통합 (AI 가 이 텍스트로 매도 시급도 판단)
    const enrichedDescription = [
      `[매도 사유] ${form.saleReason}`,
      form.saleDeadline ? `[처분 희망 마감일] ${form.saleDeadline}` : null,
      form.description,
    ].filter(Boolean).join('\n\n');

    try {
      const { id } = await registerProperty(
        { ...form, description: enrichedDescription },
        profile,
      );
      // 등록 직후 매물 상세 페이지로 (AI 리포트는 백그라운드 생성 중)
      navigate(`/properties/${id}?just_registered=1`, { replace: true });
    } catch (err) {
      console.error(err);
      setError(err.message || '등록 실패. 잠시 후 다시 시도해주세요.');
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell agent-register-page">
      <section className="container agent-register-hero">
        <p className="section-eyebrow">새 매물 등록</p>
        <h1>매물 정보 입력</h1>
        <p>입력하신 정보로 매물이 등록되며, AI가 자동으로 매물 리포트를 생성합니다.</p>
      </section>

      <form className="container agent-register-form" onSubmit={handleSubmit}>
        {/* Section 1: 기본 정보 */}
        <fieldset className="register-section">
          <legend>기본 정보</legend>
          <div className="register-grid-2">
            <label>
              매물 타이틀 *
              <input type="text" name="title" value={form.title} onChange={update('title')} placeholder="예: 마포래미안푸르지오 84A" required />
            </label>
            <label>
              지역 (시·구) *
              <input type="text" value={form.region} onChange={update('region')} placeholder="예: 서울 마포구" required />
            </label>
          </div>
          <label>
            주소 *
            <input type="text" value={form.address} onChange={update('address')} placeholder="예: 서울특별시 마포구 아현동 1-1" required />
          </label>
          <div className="register-grid-2">
            <label>
              위도 (선택)
              <input type="text" value={form.lat} onChange={update('lat')} placeholder="예: 37.5663" />
            </label>
            <label>
              경도 (선택)
              <input type="text" value={form.lng} onChange={update('lng')} placeholder="예: 126.9019" />
            </label>
          </div>
        </fieldset>

        {/* Section 2: 평형/구조 */}
        <fieldset className="register-section">
          <legend>평형 및 구조</legend>
          <div className="register-grid-3">
            <label>
              전용면적 (㎡) *
              <input type="number" step="0.1" value={form.area} onChange={update('area')} required />
            </label>
            <label>
              공급면적 (㎡)
              <input type="number" step="0.1" value={form.supplyArea} onChange={update('supplyArea')} placeholder="비우면 자동" />
            </label>
            <label>
              층 *
              <input type="text" value={form.floor} onChange={update('floor')} placeholder="예: 12층" required />
            </label>
          </div>
          <div className="register-grid-3">
            <label>
              향
              <select value={form.direction} onChange={update('direction')}>
                {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label>
              방 개수
              <input type="number" min="1" max="6" value={form.rooms} onChange={update('rooms')} />
            </label>
            <label>
              욕실 개수
              <input type="number" min="1" max="4" value={form.bathrooms} onChange={update('bathrooms')} />
            </label>
          </div>
        </fieldset>

        {/* Section 3: 단지 제원 */}
        <fieldset className="register-section">
          <legend>단지 제원</legend>
          <div className="register-grid-3">
            <label>
              건축연도 *
              <input type="number" min="1970" max="2030" value={form.builtYear} onChange={update('builtYear')} required />
            </label>
            <label>
              세대수
              <input type="number" min="1" value={form.unitCount} onChange={update('unitCount')} placeholder="예: 1450" />
            </label>
            <label>
              주차
              <input type="text" value={form.parking} onChange={update('parking')} placeholder="예: 세대당 1.3대" />
            </label>
          </div>
          <div className="register-grid-2">
            <label>
              월 관리비 (원)
              <input type="number" min="0" value={form.maintenanceFee} onChange={update('maintenanceFee')} placeholder="예: 280000" />
            </label>
            <label>
              입주 가능
              <input type="text" value={form.moveInDate} onChange={update('moveInDate')} placeholder="예: 즉시 입주, 협의" />
            </label>
          </div>
        </fieldset>

        {/* Section 4: 가격 */}
        <fieldset className="register-section">
          <legend>가격 정보</legend>
          <div className="register-grid-2">
            <label>
              매도 호가 (원) *
              <input type="number" min="0" step="100000" value={form.price} onChange={update('price')} placeholder="예: 2150000000" required />
            </label>
            <label>
              기준 실거래가 (원) *
              <input type="number" min="0" step="100000" value={form.actualTransactionPrice} onChange={update('actualTransactionPrice')} placeholder="국토부 실거래 평균 또는 단지 평균" required />
            </label>
          </div>
          {form.price && form.actualTransactionPrice && (
            <p className="register-hint">
              자동 할인율: <strong>
                {(((Number(form.actualTransactionPrice) - Number(form.price)) / Number(form.actualTransactionPrice)) * 100).toFixed(1)}%
              </strong> (5% 이상이면 급매로 분류)
            </p>
          )}
        </fieldset>

        {/* Section 5: 매도 사유 */}
        <fieldset className="register-section">
          <legend>매도 사유 <small>(AI 리포트 작성에 핵심 정보)</small></legend>
          <div className="register-grid-2">
            <label>
              사유
              <select value={form.saleReason} onChange={update('saleReason')}>
                {SALE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label>
              처분 희망 마감일 (선택)
              <input type="date" value={form.saleDeadline} onChange={update('saleDeadline')} />
            </label>
          </div>
        </fieldset>

        {/* Section 6: 매물 사진 (선택) */}
        <fieldset className="register-section">
          <legend>매물 사진 <small>(선택 — 최대 10장)</small></legend>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []).slice(0, 10);
              setForm((s) => ({ ...s, photos: files }));
            }}
          />
          {form.photos.length > 0 && (
            <p className="register-hint">
              <strong>{form.photos.length}장</strong> 선택됨 — {form.photos.map((f) => f.name).join(', ')}
            </p>
          )}
          <p className="register-hint">사진을 안 올려도 등록 가능 (placeholder 이미지로 표시).</p>
        </fieldset>

        {/* Section 7: 추가 설명 + 중개사무소 */}
        <fieldset className="register-section">
          <legend>매물 설명 *</legend>
          <textarea
            value={form.description}
            onChange={update('description')}
            placeholder="단지의 특징, 매물의 강점, 매수자가 알아야 할 정보를 자유롭게 입력해주세요. AI 리포트에 반영됩니다."
            rows={5}
            required
          />
        </fieldset>

        <fieldset className="register-section">
          <legend>중개사무소 정보</legend>
          <div className="register-grid-2">
            <label>
              중개사무소명
              <input type="text" value={form.agencyName} onChange={update('agencyName')} placeholder="예: 프라임공인중개사" />
            </label>
            <label>
              연락처
              <input
                type="text"
                value={form.agentPhone}
                onChange={update('agentPhone')}
                placeholder="예: 02-548-9031"
                inputMode="numeric"
                maxLength={PHONE_MAX_LENGTH}
              />
            </label>
          </div>
        </fieldset>

        {error && <p className="form-status error">{error}</p>}

        <div className="register-submit-row">
          <div className="register-ai-note">
            <Sparkles size={16} />
            <span>등록 즉시 AI가 매물 리포트를 자동으로 생성합니다 (10~20초 소요)</span>
          </div>
          <button type="submit" className="primary-link-button" disabled={submitting}>
            {submitting ? '등록 중...' : '매물 등록 완료'}
            {!submitting && <ArrowRight size={17} />}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AgentRegisterProperty;
