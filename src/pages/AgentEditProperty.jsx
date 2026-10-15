import PropertyLoadError from '../components/PropertyLoadError.jsx';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useProperty } from '../hooks/useProperties.js';
import { updateProperty } from '../services/propertyMutations.js';
import { uploadPropertyMedia } from '../services/propertyRegistration.js';
import PanoramaUploadField from '../components/PanoramaUploadField.jsx';
import LocalMediaImage from '../components/LocalMediaImage.jsx';
import { formatPrice } from '../utils/priceUtils.js';
import { formatPhone, PHONE_MAX_LENGTH } from '../utils/phoneFormat.js';
import { isValidContactPhone } from '../../supabase/functions/_shared/contactPhone.js';

function AgentEditProperty() {
  const { id } = useParams();
  const { property, isLoading, error: loadError, refresh } = useProperty(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [existingMedia, setExistingMedia] = useState([]); // 유지할 기존 사진
  const [newFiles, setNewFiles] = useState([]); // 추가 업로드할 파일
  const [panoramas, setPanoramas] = useState([]); // 360 투어 지점 [{ id, label, src?, file? }] — 순서 = 이동 순서
  const [panoProgress, setPanoProgress] = useState(null);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');
  const [photoOverflow, setPhotoOverflow] = useState(0); // 10장 초과 선택분 안내

  useEffect(() => {
    if (!property) return;
    setForm({
      title: property.title,
      price: String(property.price ?? ''),
      floor: property.floor ?? '',
      direction: property.direction || '남향',
      occupancyStatus: property.occupancyStatus || '공실',
      rooms: property.rooms ?? 0,
      bathrooms: property.bathrooms ?? 0,
      parking: property.parking ?? '',
      description: property.description ?? '',
      contactPhone: property.agent?.phone || '',
    });
    const media = Array.isArray(property.media) ? property.media : [];
    setExistingMedia(media);
    setPanoramas(
      media
        .filter((m) => m && m.type === '360' && m.src)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((m, i) => ({ id: m.id || `pano-${i + 1}`, label: m.label || '', src: m.src, yawOffset: m.yawOffset, links: m.links, linksExplicit: m.linksExplicit, stitched: m.stitched, calibrated: m.calibrated, model: m.model })),
    );
  }, [property]);

  if (loadError) return <div className="page-shell container"><PropertyLoadError onRetry={refresh} /></div>;

  // 로드가 끝났는데 매물이 없으면 not-found — "불러오는 중" 무한 표시 방지
  if (!isLoading && !property) {
    return (
      <div className="page-shell agent-register-page">
        <section className="container empty-state detail-empty">
          <h1>매물을 찾을 수 없습니다.</h1>
          <p>삭제되었거나 주소가 잘못되었을 수 있습니다. 내 매물 목록에서 다시 선택해 주세요.</p>
          <Link to="/agent/properties" className="primary-link-button">
            내 매물 목록으로 이동
          </Link>
        </section>
      </div>
    );
  }

  if (isLoading || !form) {
    return (
      <div className="page-shell agent-register-page">
        <section className="container">
          <p className="admin-empty">불러오는 중...</p>
        </section>
      </div>
    );
  }

  const update = (key) => (event) => {
    const value = key === 'contactPhone' ? formatPhone(event.target.value) : event.target.value;
    setForm((s) => ({ ...s, [key]: value }));
  };

  // 아래 할인율은 현재 기준가로 계산한 미리보기. 저장 시 서버가 근거를 다시 조회한다
  // (자기 호가를 기준가로 삼으면 항상 0%가 되는 가짜 지표가 됨)
  const market = property.actualTransactionPrice || 0;
  const newDiscount = market > 0 ? (((market - Number(form.price)) / market) * 100).toFixed(1) : null;

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving || converting) return;
    if (!form.title || !form.price) {
      setError('매물 타이틀과 매도 호가는 필수입니다.');
      return;
    }
    if (!isValidContactPhone(form.contactPhone)) {
      setError('문의 연락처에 올바른 전화번호를 입력해주세요.');
      return;
    }
    setSaving(true);
    setError('');

    // 사진: 유지한 기존 + 새로 업로드, 첫 장을 대표 사진으로 재라벨.
    // 비사진 항목은 재라벨에서 제외한다. 예전 3D 모델(type: '3d') 항목은 저장 시 함께 정리된다.
    let photoMedia = existingMedia.filter((m) => !m.type || m.type === 'photo');
    let panoramaMedia = [];
    try {
      const uploaded = await uploadPropertyMedia(newFiles, panoramas, id, { onProgress: setPanoProgress });
      photoMedia = [...photoMedia, ...uploaded.filter(item => item.type === 'photo')];
      panoramaMedia = uploaded.filter(item => item.type === '360');
    } catch (uploadErr) {
      setError(uploadErr.message || '사진 업로드 실패');
      setSaving(false);
      setPanoProgress(null);
      return;
    }
    let media = photoMedia.map((m, i) => ({ ...m, label: i === 0 ? '대표 사진' : `사진 ${i + 1}` }));
    media = [...media, ...panoramaMedia];


    try {
      await updateProperty(property, {
        title: form.title, price: Number(form.price), floor: form.floor,
        direction: form.direction, occupancy_status: form.occupancyStatus,
        rooms: Number(form.rooms), bathrooms: Number(form.bathrooms),
        parking: form.parking || '미공개', description: form.description, media,
        contact_phone: form.contactPhone,
      });
    } catch (saveError) {
      setError(`수정 실패: ${saveError.message || '네트워크 오류 — 잠시 후 다시 시도해주세요.'}`);
      setSaving(false);
      return;
    }
    navigate('/agent/properties', { replace: true });
  };

  return (
    <div className="page-shell agent-register-page">
      <section className="container agent-register-hero">
        <p className="section-eyebrow">매물 수정</p>
        <h1>{property.title}</h1>
        <p>자주 바뀌는 정보를 수정할 수 있습니다. 저장하면 가격 근거가 다시 계산되고 승인 대기로 전환됩니다. 단지·면적·주소 변경은 재등록해주세요.</p>
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
          <div className="register-grid-3">
            <label>
              향
              <select value={form.direction} onChange={update('direction')}>
                {['남향', '동향', '서향', '북향', '남동향', '남서향'].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label>
              현재 거주 상태
              <select value={form.occupancyStatus} onChange={update('occupancyStatus')}>
                {['공실', '세입자 거주', '집주인 거주'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label>
              주차
              <input type="text" value={form.parking} onChange={update('parking')} placeholder="예: 세대당 1.3대" />
            </label>
          </div>
        </fieldset>

        <fieldset className="register-section">
          <legend>매물 사진</legend>
          {existingMedia.length > 0 ? (
            <div className="edit-photo-grid">
              {existingMedia
                .map((m, i) => ({ m, i }))
                .filter(({ m }) => !m.type || m.type === 'photo')
                .map(({ m, i }, photoIndex) => (
                  <div key={m.src} className="edit-photo-item">
                    <LocalMediaImage src={m.src} alt={m.alt || `사진 ${photoIndex + 1}`} />
                    {photoIndex === 0 && <span className="edit-photo-cover">대표</span>}
                    <button
                      type="button"
                      className="edit-photo-remove"
                      aria-label="사진 삭제"
                      disabled={saving}
                      onClick={() => setExistingMedia((arr) => arr.filter((_, idx) => idx !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <p className="register-hint">등록된 사진이 없습니다.</p>
          )}
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="추가할 매물 사진 선택 (최대 10장)"
            disabled={saving}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              setPhotoOverflow(Math.max(0, selected.length - 10));
              setNewFiles(selected.slice(0, 10));
            }}
          />
          {newFiles.length > 0 && (
            <p className="register-hint"><strong>{newFiles.length}장</strong> 추가 예정 — 저장 시 업로드됩니다.</p>
          )}
          {photoOverflow > 0 && (
            <p className="register-hint">최대 10장까지 추가됩니다 — 초과한 {photoOverflow}장은 제외했습니다.</p>
          )}
          <p className="register-hint">첫 번째 사진이 대표 사진으로 표시됩니다. 기존 사진은 × 로 삭제할 수 있어요.</p>

          <PanoramaUploadField items={panoramas} onChange={setPanoramas} disabled={saving} onBusyChange={setConverting} idPrefix="edit-pano" />
        </fieldset>

        <fieldset className="register-section">
          <legend>문의 연락처</legend>
          <label>
            매수자 문의 연락처 *
            <input type="tel" name="contactPhone" value={form.contactPhone} onChange={update('contactPhone')}
              maxLength={PHONE_MAX_LENGTH} autoComplete="tel" required />
          </label>
          <p className="register-hint">변경한 전화번호는 운영팀 재승인 후 매물 상세의 문의 버튼에 반영됩니다.</p>
        </fieldset>

        <fieldset className="register-section">
          <legend>매물 설명</legend>
          <textarea aria-label="매물 설명" value={form.description} onChange={update('description')} rows={6} />
        </fieldset>

        {error && <p className="form-status error">{error}</p>}

        <div className="register-submit-row">
          <button type="button" className="auth-text-button" onClick={() => navigate('/agent/properties')}>
            목록으로
          </button>
          <button type="submit" className="primary-link-button" disabled={saving || converting}>
            {saving
              ? panoProgress && panoProgress.total > 0
                ? `360 사진 처리 중 ${panoProgress.done}/${panoProgress.total}`
                : '저장 중...'
              : '수정 저장'}
            {!saving && <ArrowRight size={17} />}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AgentEditProperty;
