import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useProperty } from '../hooks/useProperties.js';
import { db } from '../lib/dataClient.js';
import { canUpload3DModel, uploadProperty3DModel, uploadPropertyPanoramas, uploadPropertyPhotos } from '../services/propertyRegistration.js';
import PanoramaUploadField from '../components/PanoramaUploadField.jsx';
import { formatPrice } from '../utils/priceUtils.js';

function AgentEditProperty() {
  const { id } = useParams();
  const { property, isLoading } = useProperty(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [existingMedia, setExistingMedia] = useState([]); // 유지할 기존 사진
  const [newFiles, setNewFiles] = useState([]); // 추가 업로드할 파일
  const [model3dFile, setModel3dFile] = useState(null); // 새로/교체 업로드할 3D 모델(.glb)
  const [panoramas, setPanoramas] = useState([]); // 360 투어 지점 [{ id, label, src?, file? }] — 순서 = 이동 순서
  const [panoProgress, setPanoProgress] = useState(null);
  const [saving, setSaving] = useState(false);
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
    });
    const media = Array.isArray(property.media) ? property.media : [];
    setExistingMedia(media);
    setPanoramas(
      media
        .filter((m) => m && m.type === '360' && m.src)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((m, i) => ({ id: m.id || `pano-${i + 1}`, label: m.label || '', src: m.src, yawOffset: m.yawOffset, links: m.links })),
    );
  }, [property]);

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

  const update = (key) => (event) => setForm((s) => ({ ...s, [key]: event.target.value }));

  // 기준 실거래가는 등록 시 확정된 값 유지 — 없으면 할인율을 계산하지 않는다
  // (자기 호가를 기준가로 삼으면 항상 0%가 되는 가짜 지표가 됨)
  const market = property.actualTransactionPrice || 0;
  const newDiscount = market > 0 ? (((market - Number(form.price)) / market) * 100).toFixed(1) : null;

  const handleSave = async (event) => {
    event.preventDefault();
    if (!form.title || !form.price) {
      setError('매물 타이틀과 매도 호가는 필수입니다.');
      return;
    }
    setSaving(true);
    setError('');

    // 사진: 유지한 기존 + 새로 업로드, 첫 장을 대표 사진으로 재라벨.
    // 3D 모델 등 비사진 항목은 재라벨에서 제외하고 뒤에 붙인다.
    let photoMedia = existingMedia.filter((m) => !m.type || m.type === 'photo');
    let model3dItem = existingMedia.find((m) => m.type === '3d') ?? null;
    let panoramaMedia = [];
    try {
      if (newFiles.length > 0) {
        const uploaded = await uploadPropertyPhotos(newFiles, id);
        photoMedia = [...photoMedia, ...uploaded];
      }
      if (model3dFile) {
        model3dItem = await uploadProperty3DModel(model3dFile, id);
      }
      if (panoramas.length > 0) {
        const result = await uploadPropertyPanoramas(panoramas, id, { onProgress: setPanoProgress });
        panoramaMedia = result.media;
        if (result.failures.length > 0) {
          // 일부만 저장하면 투어 순서가 어긋난다 — 실패 원인을 보여주고 저장을 멈춘다.
          throw new Error(
            `360 사진 ${result.failures.length}장을 처리하지 못했습니다: ${result.failures
              .map((f) => `${f.label} — ${f.message}`)
              .join(' / ')}`,
          );
        }
      }
    } catch (uploadErr) {
      setError(uploadErr.message || '사진 업로드 실패');
      setSaving(false);
      setPanoProgress(null);
      return;
    }
    let media = photoMedia.map((m, i) => ({ ...m, label: i === 0 ? '대표 사진' : `사진 ${i + 1}` }));
    if (model3dItem) {
      media = [...media, model3dItem];
    }
    media = [...media, ...panoramaMedia];

    let data;
    try {
      const { data: updated, error: updateError } = await db
        .from('properties')
        .update({
          title: form.title,
          price: Number(form.price),
          // 기준가가 없어 재계산 불가하면 기존 할인율 유지
          discount_rate: newDiscount !== null ? Number(newDiscount) : property.discountRate,
          floor: form.floor,
          direction: form.direction,
          occupancy_status: form.occupancyStatus,
          rooms: Number(form.rooms),
          bathrooms: Number(form.bathrooms),
          parking: form.parking || '미공개',
          description: form.description,
          media,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id');
      if (updateError) throw updateError;
      data = updated;
    } catch (saveError) {
      setError(`수정 실패: ${saveError.message || '네트워크 오류 — 잠시 후 다시 시도해주세요.'}`);
      setSaving(false);
      return;
    }
    if (!data || data.length === 0) {
      setError('권한이 없거나 매물이 존재하지 않아 수정되지 않았습니다.');
      setSaving(false);
      return;
    }

    // 로컬 모드: AI 리포트는 사전 생성해 번들(public/data/property_reports.json)하므로
    // 무효화할 서버 캐시가 없다. 수정 내용은 다음 번들 재생성 때 반영된다.

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
                    <img src={m.src} alt={m.alt || `사진 ${photoIndex + 1}`} />
                    {photoIndex === 0 && <span className="edit-photo-cover">대표</span>}
                    <button
                      type="button"
                      className="edit-photo-remove"
                      aria-label="사진 삭제"
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

          <PanoramaUploadField items={panoramas} onChange={setPanoramas} disabled={saving} idPrefix="edit-pano" />

          {(canUpload3DModel || existingMedia.some((m) => m.type === '3d')) && (
            <div className="register-3d-field">
              <label htmlFor="edit-model3d">3D 모델 <small>(선택 — .glb/.gltf, 최대 50MB)</small></label>
              {existingMedia.some((m) => m.type === '3d') && !model3dFile && (
                <p className="register-hint">
                  현재 3D 모델이 등록돼 있습니다. 새 파일을 올리면 교체됩니다.{' '}
                  <button
                    type="button"
                    className="register-3d-remove"
                    onClick={() => setExistingMedia((arr) => arr.filter((m) => m.type !== '3d'))}
                  >
                    3D 모델 제거
                  </button>
                </p>
              )}
              {canUpload3DModel && (
                <input
                  id="edit-model3d"
                  type="file"
                  accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                  aria-label="3D 모델 파일 선택"
                  onChange={(event) => setModel3dFile(event.target.files?.[0] ?? null)}
                />
              )}
              {model3dFile && (
                <p className="register-hint">
                  <strong>{model3dFile.name}</strong> ({(model3dFile.size / 1024 / 1024).toFixed(1)}MB) — 저장 시 반영됩니다.
                </p>
              )}
            </div>
          )}
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
