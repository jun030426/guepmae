import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

// 중앙 확인 모달 (네이티브 confirm 대체). 전역 .confirm-* CSS 사용.
// 실패 처리는 호출부의 onConfirm 이 페이지 에러 상태로 표시한다는 계약 —
// 여기서는 unhandled rejection 만 막고 닫는다.
function ConfirmDialog({ title, message, confirmLabel = '확인', danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (err) {
      console.warn('확인 작업 실패 — 호출부 에러 표시에 위임.', err);
    } finally {
      onClose();
    }
  };

  return (
    <div className="confirm-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="confirm-box"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={danger ? 'confirm-icon danger' : 'confirm-icon'} aria-hidden="true">
          {danger ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
        </div>
        <h3 className="confirm-title" id={titleId}>{title}</h3>
        {message && <p className="confirm-message">{message}</p>}
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onClose} disabled={busy} ref={cancelRef}>
            취소
          </button>
          <button
            type="button"
            className={danger ? 'confirm-ok danger' : 'confirm-ok'}
            onClick={run}
            disabled={busy}
          >
            {busy ? '처리 중...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
