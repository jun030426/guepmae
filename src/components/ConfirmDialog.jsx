import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

// 중앙 확인 모달 (네이티브 confirm 대체). 전역 .confirm-* CSS 사용.
function ConfirmDialog({ title, message, confirmLabel = '확인', danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      onClose();
    }
  };

  return (
    <div className="confirm-backdrop" onClick={busy ? undefined : onClose}>
      <div className="confirm-box" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className={danger ? 'confirm-icon danger' : 'confirm-icon'} aria-hidden="true">
          {danger ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
        </div>
        <h3 className="confirm-title">{title}</h3>
        {message && <p className="confirm-message">{message}</p>}
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onClose} disabled={busy}>
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
