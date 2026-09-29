import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchAlertsByEmail, listDeviceAlerts, unsubscribeAlert } from '../services/complexAlerts.js';

/*
 * Alerts — 내 급매 알림 관리.
 * 보이는 것: 이 기기에서 신청한 알림(비로그인 포함) + 로그인 이메일로 등록된 알림.
 * 해지는 토큰으로 한다 — 비로그인도 가능.
 */

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function Alerts() {
  const { profile } = useAuth();
  const [deviceAlerts, setDeviceAlerts] = useState(() => listDeviceAlerts());
  const [accountAlerts, setAccountAlerts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  // 메일의 해지 링크(/alerts?token=…)로 들어온 경우 — 확인 후 해지
  const [searchParams, setSearchParams] = useSearchParams();
  const linkToken = searchParams.get('token');
  const [linkState, setLinkState] = useState('idle'); // idle | done | error

  const handleLinkUnsubscribe = async () => {
    setBusy(linkToken);
    try {
      await unsubscribeAlert(linkToken);
      setLinkState('done');
      setDeviceAlerts(listDeviceAlerts());
      setAccountAlerts((rows) => rows.filter((row) => row.token !== linkToken));
      const next = new URLSearchParams(searchParams);
      next.delete('token');
      setSearchParams(next, { replace: true });
    } catch {
      setLinkState('error');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let active = true;
    if (!profile?.email) {
      setAccountAlerts([]);
      return undefined;
    }
    fetchAlertsByEmail(profile.email).then((rows) => {
      if (active) setAccountAlerts(rows);
    });
    return () => {
      active = false;
    };
  }, [profile?.email]);

  // 기기 목록 + 계정 목록을 토큰 기준으로 합친다
  const alerts = useMemo(() => {
    const byToken = new Map();
    [...deviceAlerts, ...accountAlerts].forEach((item) => {
      if (item?.token && !byToken.has(item.token)) byToken.set(item.token, item);
    });
    return [...byToken.values()].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }, [deviceAlerts, accountAlerts]);

  const handleUnsubscribe = async (item) => {
    setBusy(item.token);
    setError('');
    try {
      await unsubscribeAlert(item.token);
      setDeviceAlerts(listDeviceAlerts());
      setAccountAlerts((rows) => rows.filter((row) => row.token !== item.token));
    } catch (unsubscribeError) {
      setError(unsubscribeError.message || '알림을 해지하지 못했습니다.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page-shell alerts-page">
      <section className="container alerts-hero">
        <p className="section-eyebrow">급매 알림</p>
        <h1>내 관심 단지 알림</h1>
        <p>
          신청한 단지에 검증된 급매(실거래가 대비 5% 이상)가 새로 등록되면 알려드릴 목록입니다.
          알림 발송은 시범 운영 준비 중이며, 지금은 신청 내역을 저장·관리할 수 있습니다.
        </p>
      </section>

      {(linkToken || linkState !== 'idle') && (
        <section className="container">
          <div className="alerts-link-banner" role="status">
            {linkState === 'done' ? (
              <p>알림을 해지했습니다. 더 이상 이 단지의 급매 알림을 보내지 않습니다.</p>
            ) : linkState === 'error' ? (
              <p>알림을 해지하지 못했습니다. 이미 해지됐거나 링크가 올바르지 않습니다.</p>
            ) : (
              <>
                <p>이 링크의 급매 알림을 해지하시겠습니까?</p>
                <button type="button" className="alerts-unsubscribe" disabled={busy === linkToken} onClick={handleLinkUnsubscribe}>
                  {busy === linkToken ? '해지 중…' : '알림 해지'}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      <section className="container">
        {error && <p className="form-status error">{error}</p>}

        {alerts.length === 0 ? (
          <div className="alerts-empty">
            <Bell size={28} aria-hidden="true" />
            <p>아직 신청한 알림이 없습니다.</p>
            <span>매물 상세 화면의 “이 단지 급매 알림”에서 신청할 수 있습니다.</span>
            <Link to="/properties" className="primary-link-button">급매 매물 보러 가기</Link>
          </div>
        ) : (
          <ul className="alerts-list">
            {alerts.map((item) => (
              <li key={item.token} className="alerts-item">
                <div className="alerts-item-main">
                  <strong>{item.complex}</strong>
                  <span>{item.gu}</span>
                </div>
                <div className="alerts-item-meta">
                  <span>{item.areaM2 != null ? `${item.areaM2}㎡` : '전체 평형'}</span>
                  <span>할인율 {item.minDiscount ?? 5}% 이상</span>
                  <span>{item.email}</span>
                  {item.createdAt && <span>{formatDate(item.createdAt)} 신청</span>}
                </div>
                <button
                  type="button"
                  className="alerts-unsubscribe"
                  disabled={busy === item.token}
                  onClick={() => handleUnsubscribe(item)}
                >
                  {busy === item.token ? '해지 중…' : '알림 해지'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!profile?.email && alerts.length > 0 && (
          <p className="register-hint">
            이 기기에서 신청한 알림만 보입니다. 다른 기기에서 신청한 알림은 같은 이메일로 로그인하면 함께 보입니다.
          </p>
        )}
      </section>
    </div>
  );
}
