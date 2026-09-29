import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { isSubscribedOnDevice, subscribeAlert } from '../services/complexAlerts.js';
import { complexOf, isValidEmail } from '../utils/alertMatch.js';

/*
 * ComplexAlertCard — 매물 상세의 "이 단지 급매 알림" 신청 카드.
 * 단지(국토부 기준 단지명 + 구)를 알 수 있는 매물에서만 보인다.
 * 발송은 아직 시작 전이므로, 저장됐다는 사실과 발송 준비 중임을 그대로 말한다(없는 기능을 약속하지 않는다).
 */
export default function ComplexAlertCard({ property }) {
  const { profile } = useAuth();
  const target = complexOf(property);
  const myArea = Number.isFinite(Number(property?.area)) ? Math.floor(Number(property.area)) : null;

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState('area'); // 'area' 이 평형만 | 'all' 단지 전체
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState('idle'); // idle | saving | done | duplicate
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile?.email) setEmail((current) => current || profile.email);
  }, [profile?.email]);

  if (!target) return null;

  const areaM2 = scope === 'area' ? myArea : null;
  const alreadyOnDevice = isValidEmail(email) && isSubscribedOnDevice({ email, complex: target.complex, gu: target.gu, areaM2 });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!isValidEmail(email)) {
      setError('이메일 주소를 확인해주세요.');
      return;
    }
    if (!consent) {
      setError('개인정보 수집·이용에 동의해야 알림을 신청할 수 있습니다.');
      return;
    }
    setState('saving');
    try {
      const result = await subscribeAlert({
        email,
        complex: target.complex,
        gu: target.gu,
        areaM2,
        minDiscount: 5,
        sourcePropertyId: property.id,
      });
      setState(result.duplicate ? 'duplicate' : 'done');
    } catch (submitError) {
      setError(submitError.message || '알림 신청을 저장하지 못했습니다.');
      setState('idle');
    }
  };

  const scopeLabel = areaM2 != null ? `${target.complex} ${areaM2}㎡` : `${target.complex} 전체 평형`;

  if (state === 'done' || state === 'duplicate') {
    return (
      <section className="sidebar-proof-card complex-alert-card is-done" aria-live="polite">
        <CheckCircle2 size={21} />
        <strong>{state === 'duplicate' ? '이미 신청된 알림입니다' : '알림 신청이 저장되었습니다'}</strong>
        <span>
          {scopeLabel} · 검증된 급매(5% 이상)가 새로 등록되면 알려드릴 대상에 포함했습니다.
          알림 발송은 시범 운영 준비 중이며, 시작되면 이 주소로 안내드립니다.
        </span>
        <Link to="/alerts" className="complex-alert-manage">내 알림 관리</Link>
      </section>
    );
  }

  return (
    <section className="sidebar-proof-card complex-alert-card">
      <Bell size={21} />
      <strong>이 단지 급매 알림</strong>
      <span>{target.complex}에 검증된 급매가 새로 올라오면 알려드립니다. 급매는 속도가 중요합니다.</span>

      {!open ? (
        <button type="button" className="complex-alert-open" onClick={() => setOpen(true)}>
          알림 신청하기
        </button>
      ) : (
        <form className="complex-alert-form" onSubmit={handleSubmit} noValidate>
          <label>
            이메일
            <input
              type="email"
              name="alertEmail"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <fieldset className="complex-alert-scope">
            <legend>알림 범위</legend>
            {myArea != null && (
              <label>
                <input type="radio" name="alertScope" value="area" checked={scope === 'area'} onChange={() => setScope('area')} />
                이 평형만 ({myArea}㎡)
              </label>
            )}
            <label>
              <input type="radio" name="alertScope" value="all" checked={scope === 'all' || myArea == null} onChange={() => setScope('all')} />
              단지 전체 평형
            </label>
          </fieldset>
          <label className="complex-alert-consent">
            <input type="checkbox" name="alertConsent" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>
              개인정보 수집·이용 동의 — 항목: 이메일 · 목적: 관심 단지 급매 알림 · 보유: 알림 해지 시까지.
              동의하지 않아도 매물 열람에는 제한이 없습니다.
            </span>
          </label>
          {alreadyOnDevice && <p className="register-hint">이 기기에서 이미 신청한 알림입니다.</p>}
          {error && <p className="form-status error">{error}</p>}
          <div className="complex-alert-actions">
            <button type="submit" className="complex-alert-submit" disabled={state === 'saving'}>
              {state === 'saving' ? '저장 중…' : '알림 신청'}
            </button>
            <button type="button" className="auth-text-button" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
