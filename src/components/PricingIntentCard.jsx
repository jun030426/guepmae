import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchMyPricingIntent, savePricingIntent } from '../services/pilotMetrics.js';
import { COMMENT_MAX, PRICE_BANDS, WILLING_OPTIONS, priceBandLabel, willingLabel } from '../utils/pilotMetrics.js';

/*
 * PricingIntentCard — 중개사 대시보드의 유료 의향 설문.
 * 질문은 사업계획서의 파일럿 지표 그대로다: "유료여도 계속 쓰겠는가".
 * 매물을 등록해 본 중개사에게만 보인다(부모가 listingCount > 0 일 때만 그린다).
 */
export default function PricingIntentCard({ listingCount = 0 }) {
  const { profile } = useAuth();
  const [saved, setSaved] = useState(null); // 저장된 답 (없으면 null)
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [willing, setWilling] = useState('');
  const [priceBand, setPriceBand] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!profile?.id) return undefined;
    fetchMyPricingIntent(profile.id)
      .then((row) => {
        if (!active) return;
        setSaved(row);
        setLoaded(true);
      })
      .catch(() => active && setLoaded(true));
    return () => { active = false; };
  }, [profile?.id]);

  if (!profile?.id || !loaded) return null;

  const startEdit = () => {
    setWilling(saved?.willing ?? '');
    setPriceBand(saved?.price_band ?? '');
    setComment(saved?.comment ?? '');
    setError('');
    setEditing(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const row = await savePricingIntent({
        userId: profile.id,
        email: profile.email,
        willing,
        priceBand,
        comment,
        listingCount,
      });
      setSaved(row);
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message || '답변을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (saved && !editing) {
    return (
      <section className="pricing-intent-card is-done" aria-live="polite">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div>
          <p className="pricing-intent-eyebrow">파일럿 설문 · 답변 완료</p>
          <strong>
            {willingLabel(saved.willing)}
            {saved.price_band ? ` · ${priceBandLabel(saved.price_band)}` : ''}
          </strong>
          {saved.comment && <p className="pricing-intent-comment">{saved.comment}</p>}
        </div>
        <button type="button" className="auth-text-button" onClick={startEdit}>
          답변 수정
        </button>
      </section>
    );
  }

  const asksPrice = willing === 'yes' || willing === 'depends';

  return (
    <section className="pricing-intent-card">
      <p className="pricing-intent-eyebrow">파일럿 설문 · 1분</p>
      <h2>정식 출시 후 유료가 되어도 계속 쓰시겠습니까?</h2>
      <p className="pricing-intent-lead">
        지금은 파일럿 기간이라 무료입니다. 답변은 요금을 정하는 데만 쓰고, 어떻게 답하셔도 이용에는 차이가 없습니다.
      </p>
      <form className="pricing-intent-form" onSubmit={handleSubmit} noValidate>
        <fieldset>
          <legend className="visually-hidden">계속 쓰시겠습니까</legend>
          {WILLING_OPTIONS.map((option) => (
            <label key={option.value} className="pricing-intent-option">
              <input
                type="radio"
                name="intentWilling"
                value={option.value}
                checked={willing === option.value}
                onChange={() => setWilling(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        {asksPrice && (
          <fieldset>
            <legend>한 달에 얼마까지 낼 수 있으신가요?</legend>
            {PRICE_BANDS.map((band) => (
              <label key={band.value} className="pricing-intent-option">
                <input
                  type="radio"
                  name="intentPriceBand"
                  value={band.value}
                  checked={priceBand === band.value}
                  onChange={() => setPriceBand(band.value)}
                />
                {band.label}
              </label>
            ))}
          </fieldset>
        )}

        <label className="pricing-intent-comment-field">
          이유나 바라는 점 (선택)
          <textarea
            name="intentComment"
            rows={3}
            maxLength={COMMENT_MAX}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="예: 매물 수 제한이 어떻게 되는지에 따라 다릅니다"
          />
          <span className="pricing-intent-count">{comment.length}/{COMMENT_MAX}</span>
        </label>

        {error && <p className="form-status error">{error}</p>}
        <div className="pricing-intent-actions">
          <button type="submit" className="primary-link-button" disabled={saving}>
            {saving ? '저장 중…' : '답변 저장'}
          </button>
          {saved && (
            <button type="button" className="auth-text-button" onClick={() => setEditing(false)}>
              취소
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
