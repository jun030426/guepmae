import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { getAreaBucket, registerProperty, resolveReferencePrice } from '../services/propertyRegistration.js';
import ComplexAutocomplete from '../components/ComplexAutocomplete.jsx';
import { formatArea, formatPrice, pyeongToSqm } from '../utils/priceUtils.js';

const DIRECTIONS = ['남향', '동향', '서향', '북향', '남동향', '남서향'];
const OCCUPANCY_OPTIONS = ['공실', '세입자 거주', '집주인 거주'];

const initialForm = {
  title: '',
  complexName: '', // 단지명 (자동완성 선택)
  complexGu: '', // 선택된 단지의 구/시/군
  complexSigungu: '', // 선택된 단지의 시군구(표시용)
  address: '',
  areaUnit: 'sqm', // 'sqm'(㎡) | 'pyeong'(평) — 입력 단위
  area: '',
  floor: '',
  direction: '남향',
  rooms: 3,
  bathrooms: 2,
  builtYear: '',
  unitCount: '',
  occupancyStatus: '공실',
  price: '',
  parking: '',
  saleReason: '',
  saleDeadline: '',
  description: '',
  photos: [], // File[] — 사진 업로드용
};

function AgentRegisterProperty() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false); // 제출 시도 여부 (필드별 빨간 안내용)
  // 자동 산출된 기준 실거래가 미리보기 { price, source } | null
  const [reference, setReference] = useState(null);

  const update = (key) => (event) => {
    setForm((s) => ({ ...s, [key]: event.target.value }));
  };

  // 입력 단위(㎡/평)를 ㎡로 환산 — 저장·매칭·표시 기준
  const toSqm = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return form.areaUnit === 'pyeong' ? pyeongToSqm(num) : num;
  };
  const areaSqm = toSqm(form.area);
  const unitLabel = form.areaUnit === 'pyeong' ? '평' : '㎡';

  // 단지 선택 + 전용면적이 있으면 기준 실거래가 미리보기 조회
  useEffect(() => {
    if (!form.complexGu || !areaSqm) {
      setReference(null);
      return undefined;
    }
    let active = true;
    resolveReferencePrice({
      complexName: form.complexName,
      gu: form.complexGu,
      areaBucket: getAreaBucket(areaSqm),
    }).then((result) => {
      if (active) setReference(result);
    });
    return () => {
      active = false;
    };
  }, [form.complexGu, form.complexName, areaSqm]);

  const sellPrice = Number(form.price);
  const previewDiscount =
    reference?.price && sellPrice
      ? (((reference.price - sellPrice) / reference.price) * 100).toFixed(1)
      : null;

  // 필수 항목 — key: 사람이 읽는 라벨
  const REQUIRED_FIELDS = {
    title: '매물 타이틀',
    address: '주소',
    area: '전용면적',
    floor: '층',
    builtYear: '건축연도',
    price: '매도 호가',
    description: '매물 설명',
  };

  // 필수 항목인데 비어있고, 제출을 시도한 적이 있으면 표시할 빨간 안내
  const fieldError = (key) =>
    attempted && REQUIRED_FIELDS[key] && !form[key] ? (
      <span className="field-error">{REQUIRED_FIELDS[key]}을(를) 입력해주세요.</span>
    ) : null;

  // 비어있는 필수 항목 목록
  const missingFields = Object.entries(REQUIRED_FIELDS)
    .filter(([key]) => !form[key])
    .map(([, label]) => label);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAttempted(true);
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
      form.saleReason ? `[매도 사유] ${form.saleReason}` : null,
      form.saleDeadline ? `[처분 희망 마감일] ${form.saleDeadline}` : null,
      form.description,
    ].filter(Boolean).join('\n\n');

    try {
      // 면적은 항상 ㎡로 환산해서 저장 (입력 단위가 평이어도)
      const { id } = await registerProperty(
        {
          ...form,
          description: enrichedDescription,
          area: areaSqm, // 항상 ㎡로 환산 (공급면적은 서버에서 자동 추정)
        },
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
          <label>
            매물 타이틀 *
            <input type="text" name="title" value={form.title} onChange={update('title')} placeholder="예: 마포래미안푸르지오 84A" required />
            {fieldError('title')}
          </label>
          <label>
            단지명 <small>(선택)</small>
            <ComplexAutocomplete
              name="complexName"
              value={form.complexName}
              onChange={(text) => setForm((s) => ({ ...s, complexName: text, complexGu: '', complexSigungu: '' }))}
              onSelect={(s) => setForm((prev) => ({
                ...prev,
                complexName: s.complex,
                complexGu: s.gu,
                complexSigungu: s.sigungu,
                // 건축연도 데이터가 있으면 자동 채움(없으면 기존 입력값 유지 → 수동 입력)
                builtYear: s.built_year ? String(s.built_year) : prev.builtYear,
              }))}
              placeholder="단지명 입력 후 목록에서 선택 (예: 마포래미안푸르지오)"
            />
            <small style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {form.complexGu
                ? `선택됨: ${form.complexSigungu} — 단지 실거래가로 기준가가 계산됩니다.`
                : '※ 선택하면 단지 실거래가로, 비우면 지역 시세로 기준 실거래가가 자동 산출됩니다.'}
            </small>
          </label>
          <label>
            주소 *
            <input type="text" name="address" value={form.address} onChange={update('address')} placeholder="예: 서울특별시 마포구 아현동 1-1" required />
            <small style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              ※ 주소를 정확히 입력하면 지역·지도 좌표·주변 시설을 자동으로 찾아드립니다.
            </small>
            {fieldError('address')}
          </label>
        </fieldset>

        {/* Section 2: 평형/구조 */}
        <fieldset className="register-section">
          <legend>평형 및 구조</legend>
          <label>
            면적 입력 단위
            <select value={form.areaUnit} onChange={update('areaUnit')}>
              <option value="sqm">제곱미터 (㎡)</option>
              <option value="pyeong">평</option>
            </select>
          </label>
          <div className="register-grid-2">
            <label>
              전용면적 ({unitLabel}) *
              <input type="number" name="area" step="0.1" value={form.area} onChange={update('area')} required />
              {fieldError('area')}
            </label>
            <label>
              층 *
              <input type="text" name="floor" value={form.floor} onChange={update('floor')} placeholder="예: 12층" required />
              {fieldError('floor')}
            </label>
          </div>
          {areaSqm > 0 && (
            <p className="register-hint">전용 {formatArea(areaSqm)} 로 저장됩니다.</p>
          )}
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
              <input type="number" name="builtYear" min="1970" max="2030" value={form.builtYear} onChange={update('builtYear')} required />
              {form.complexGu && form.builtYear ? (
                <small style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>단지 선택으로 자동 입력됨 (수정 가능)</small>
              ) : null}
              {fieldError('builtYear')}
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
          <label>
            현재 거주 상태
            <select value={form.occupancyStatus} onChange={update('occupancyStatus')}>
              {OCCUPANCY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </fieldset>

        {/* Section 4: 가격 */}
        <fieldset className="register-section">
          <legend>가격 정보</legend>
          <label>
            매도 호가 (원) *
            <input type="number" name="price" min="0" step="100000" value={form.price} onChange={update('price')} placeholder="예: 2150000000" required />
            {fieldError('price')}
          </label>

          {/* 기준 실거래가는 국토부 데이터에서 자동 산출 (중개사 직접 입력 불가) */}
          <div className="reference-price-box">
            <div className="reference-price-head">
              <span>기준 실거래가 <em>(국토부 실거래가 기반 · 자동)</em></span>
              {reference?.source && (
                <span className={reference.source === 'complex' ? 'ref-tag complex' : 'ref-tag region'}>
                  {reference.source === 'complex' ? '단지 실거래 기준' : '지역 시세 기반 추정'}
                </span>
              )}
            </div>
            {reference?.price ? (
              <>
                <strong className="reference-price-value">{formatPrice(reference.price)}</strong>
                {previewDiscount && (
                  <p className="register-hint">
                    예상 할인율 <strong>{previewDiscount}%</strong>
                    {Number(previewDiscount) >= 5 ? ' — 급매 기준 충족' : ' (5% 이상이면 급매로 분류)'}
                  </p>
                )}
              </>
            ) : (
              <p className="reference-price-empty">
                단지명을 선택하고 전용면적을 입력하면 기준 실거래가가 자동으로 표시됩니다.
                {' '}못 찾으면 등록 시 지역 시세로 자동 산출됩니다.
              </p>
            )}
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

        {/* Section 7: 매도 사유 + 매물 설명 (둘 다 AI 리포트 입력) */}
        <fieldset className="register-section">
          <legend>매도 사유 <small>(AI 리포트에 반영)</small></legend>
          <textarea
            name="saleReason"
            value={form.saleReason}
            onChange={update('saleReason')}
            placeholder="왜 급하게 파는지 자유롭게 적어주세요. 예: 양도세 마감이 임박해 이달 내 처분을 원합니다."
            rows={3}
          />
          <label>
            처분 희망 마감일 (선택)
            <input type="date" value={form.saleDeadline} onChange={update('saleDeadline')} />
          </label>
        </fieldset>

        <fieldset className="register-section">
          <legend>매물 설명 *</legend>
          <textarea
            name="description"
            value={form.description}
            onChange={update('description')}
            placeholder="단지의 특징, 매물의 강점, 매수자가 알아야 할 정보를 자유롭게 입력해주세요. AI 리포트에 반영됩니다."
            rows={5}
            required
          />
          {fieldError('description')}
          <p className="register-hint">중개사무소명·연락처는 가입한 중개사 계정 정보로 자동 등록됩니다.</p>
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
