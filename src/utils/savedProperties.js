// 저장(찜) 매물 — localStorage 기반. 로그인 없이도 동작하는 브라우저 로컬 기능.
const STORAGE_KEY = 'gm_saved_properties';

export function getSavedIds() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function isSaved(id) {
  return getSavedIds().includes(id);
}

// 토글 후 "현재 저장 상태"를 반환
export function toggleSaved(id) {
  const ids = getSavedIds();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장 불가 환경(시크릿 모드 등) — 호출부의 세션 내 상태만 유지
  }
  return next.includes(id);
}
