/*
 * 한국 전화번호 자동 하이픈 포맷.
 *
 * 사용: <input onChange={(e) => setValue(formatPhone(e.target.value))} />
 *
 * 처리 규칙:
 *   010-XXXX-XXXX  (휴대전화)
 *   02-XXX-XXXX or 02-XXXX-XXXX  (서울 시내)
 *   0XX-XXX-XXXX or 0XX-XXXX-XXXX  (지역번호)
 *   1XXX-XXXX  (대표번호, 4-4)
 *   그 외: 숫자만 남김
 */

export function formatPhone(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/\D/g, '');

  // 휴대전화 (010, 011, 016~019)
  if (/^01[016-9]/.test(d)) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }

  // 서울 시내 (02)
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5, 9)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }

  // 대표번호 (1588, 1577 등)
  if (/^1[5-9]\d{2}/.test(d)) {
    if (d.length <= 4) return d;
    return `${d.slice(0, 4)}-${d.slice(4, 8)}`;
  }

  // 지역번호 (031, 032 등)
  if (d.startsWith('0')) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 10)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }

  // 그 외: 숫자만
  return d;
}

// 최대 길이 (UI 에서 maxLength 로 사용)
export const PHONE_MAX_LENGTH = 13; // "010-1234-5678" 형식 기준
