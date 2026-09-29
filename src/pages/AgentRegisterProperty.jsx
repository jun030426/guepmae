import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { canUpload3DModel, getAreaBucket, registerProperty, resolveReferencePrice } from '../services/propertyRegistration.js';
import ComplexAutocomplete from '../components/ComplexAutocomplete.jsx';
import PanoramaUploadField from '../components/PanoramaUploadField.jsx';
import { formatArea, formatPrice, pyeongToSqm } from '../utils/priceUtils.js';
import { formatPhone, PHONE_MAX_LENGTH } from '../utils/phoneFormat.js';

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
  contactPhone: '', // 매수자가 실제로 연락할 번호 — 없으면 매물이 막다른 길이 된다
  photos: [], // File[] — 사진 업로드용
  panoramas: [], // [{ id, label, file, previewUrl }] — 360 투어 사진 (배열 순서 = 이동 순서)
};

function AgentRegisterProperty() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false); // 제출 시도 여부 (필드별 빨간 안내용)
  const [photoOverflow, setPhotoOverflow] = useState(0); // 10장 초과 선택분 안내
  const [panoProgress, setPanoProgress] = useState(null); // 360 사진 처리 진행률 { done, total }
  // 자동 산출된 기준 실거래가 미리보기 { price, source } | null
  const [reference, setReference] = useState(null);

  const update = (key) => (event) => {
    const value = key === 'contactPhone' ? formatPhone(event.target.value) : event.target.value;
    setForm((s) => ({ ...s, [key]: value }));
  };

  // 프로필에 등록된 연락처를 기본값으로 — 비어 있으면 직접 입력해야 등록된다
  useEffect(() => {
    if (profile?.phone) {
      setForm((s) => (s.contactPhone ? s : { ...s, contactPhone: formatPhone(profile.phone) }));
    }
  }, [profile?.phone]);

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
      areaM2: Math.floor(areaSqm), // 등록 시(registerProperty)와 동일한 매칭 키
      areaBucket: getAreaBucket(areaSqm),
    }).then((result) => {
      if (active) setReference(result);
    }).catch((referenceError) => {
      // 미리보기 실패는 치명적이지 않음 — 안내문이 "등록 시 지역 시세로 자동 산출" 폴백을 이미 설명
      console.warn('기준가 미리보기 조회 실패.', referenceError);
      if (active) setReference(null);
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
    contactPhone: '문의 연락처',
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
      const { id, panoramaFailures = [] } = await registerProperty(
        {
          ...form,
          description: enrichedDescription,
          area: areaSqm, // 항상 ㎡로 환산 (공급면적은 서버에서 자동 추정)
        },
        profile,
        { onPanoramaProgress: setPanoProgress },
      );
      // 등록 직후 매물 상세 페이지로 (처리하지 못한 360 사진이 있으면 배너로 알린다)
      const failedParam = panoramaFailures.length > 0 ? `&pano_failed=${panoramaFailures.length}` : '';
      navigate(`/properties/${id}?just_registered=1${failedParam}`, { replace: true });
    } catch (err) {
      console.error(err);
      setError(err.message || '등록 실패. 잠시 후 다시 시도해주세요.');
      setSubmitting(false);
      setPanoProgress(null);
    }
  };

  return (
    <div className="page-shell agent-register-page">
      <section className="container agent-register-hero">
        <p className="section-eyebrow">새 매물 등록</p>
        <h1>매물 정보 입력</h1>
        <p>입력하신 정보로 매물이 등록되고, 국토부 실거래가 기준 할인율과 산출 근거가 자동으로 계산됩니다.</p>
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
            <small className="field-hint">
              {form.complexGu
                ? `선택됨: ${form.complexSigungu} — 단지 실거래가로 기준가가 계산됩니다.`
                : '※ 선택하면 단지 실거래가로, 비우면 지역 시세로 기준 실거래가가 자동 산출됩니다.'}
            </small>
          </label>
          <label>
            주소 *
            <input type="text" name="address" value={form.address} onChange={update('address')} placeholder="예: 서울특별시 마포구 아현동 1-1" required />
            <small className="field-hint">
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
              <input type="number" name="area" min="1" step="0.1" value={form.area} onChange={update('area')} required />
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
                <small className="field-hint">단지 선택으로 자동 입력됨 (수정 가능)</small>
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
            aria-label="매물 사진 선택 (최대 10장)"
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              setPhotoOverflow(Math.max(0, selected.length - 10));
              setForm((s) => ({ ...s, photos: selected.slice(0, 10) }));
            }}
          />
          {form.photos.length > 0 && (
            <p className="register-hint">
              <strong>{form.photos.length}장</strong> 선택됨 — {form.photos.map((f) => f.name).join(', ')}
            </p>
          )}
          {photoOverflow > 0 && (
            <p className="register-hint">
              최대 10장까지 등록됩니다 — 초과한 {photoOverflow}장은 제외했습니다.
            </p>
          )}
          <p className="register-hint">사진을 안 올려도 등록은 가능하지만, 사진이 있는 매물이 매수자 신뢰가 훨씬 높습니다.</p>

          <PanoramaUploadField
            items={form.panoramas}
            onChange={(panoramas) => setForm((s) => ({ ...s, panoramas }))}
            disabled={submitting}
            idPrefix="register-pano"
          />

          {canUpload3DModel && (
            <div className="register-3d-field">
              <label htmlFor="register-model3d">3D 모델 <small>(선택 — .glb/.gltf, 최대 50MB)</small></label>
              <input
                id="register-model3d"
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                aria-label="3D 모델 파일 선택"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setForm((s) => ({ ...s, model3d: file }));
                }}
              />
              {form.model3d && (
                <p className="register-hint">
                  <strong>{form.model3d.name}</strong> ({(form.model3d.size / 1024 / 1024).toFixed(1)}MB) — 등록하면 매물 상세의 “360 투어” 탭에 표시됩니다 (360 사진이 있으면 그쪽이 우선).
                </p>
              )}
              <p className="register-hint">공간 스캔(.glb)을 올리면 매수자가 상세 페이지에서 집 구조를 회전·확대하며 볼 수 있습니다.</p>
            </div>
          )}
        </fieldset>

        {/* Section 7: 매도 사유 + 매물 설명 (매도 사유는 설명문에 합쳐져 매수자에게 표시) */}
        <fieldset className="register-section">
          <legend>매도 사유 <small>(매물 설명에 함께 표시)</small></legend>
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
            placeholder="단지의 특징, 매물의 강점, 매수자가 알아야 할 정보를 자유롭게 입력해주세요."
            rows={5}
            required
          />
          {fieldError('description')}
        </fieldset>

        {/* Section: 문의 연락처 — 매수자의 여정이 여기서 끊기지 않도록 필수 */}
        <fieldset className="register-section">
          <legend>문의 연락처</legend>
          <label>
            매수자 문의 연락처 *
            <input
              type="tel"
              name="contactPhone"
              value={form.contactPhone}
              onChange={update('contactPhone')}
              placeholder="예: 010-1234-5678"
              inputMode="numeric"
              maxLength={PHONE_MAX_LENGTH}
              required
            />
            <small className="field-hint">
              ※ 매물 상세의 문의 버튼에 연결되는 번호입니다. 중개사무소명은 가입 정보로 자동 등록됩니다.
            </small>
            {fieldError('contactPhone')}
          </label>
        </fieldset>

        {error && <p className="form-status error">{error}</p>}

        <div className="register-submit-row">
          <div className="register-ai-note">
            <Sparkles size={16} />
            <span>등록 즉시 실거래가 기준 할인율과 산출 근거가 자동으로 계산됩니다</span>
          </div>
          <button type="submit" className="primary-link-button" disabled={submitting}>
            {submitting
              ? panoProgress && panoProgress.total > 0
                ? `360 사진 처리 중 ${panoProgress.done}/${panoProgress.total}`
                : '등록 중...'
              : '매물 등록 완료'}
            {!submitting && <ArrowRight size={17} />}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AgentRegisterProperty;
