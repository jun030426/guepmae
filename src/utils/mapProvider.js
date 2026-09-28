/*
 * 지도 제공자 결정 — 기본은 무료 OpenStreetMap(Leaflet). 키·계정·결제 불필요.
 *
 * Google/Naver 는 키가 있어도 자동 선택하지 않는다 — 결제 미연결 키가
 * 워터마크·로드 실패를 일으킨 전례(2026-09) 때문. 쓰려면 명시적으로:
 *   VITE_MAP_PROVIDER=google  (+ VITE_GOOGLE_MAPS_API_KEY, 결제 연결 필수)
 *   VITE_MAP_PROVIDER=naver   (+ VITE_NAVER_MAP_CLIENT_ID)
 */

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
export const NAVER_MAP_CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;

const requested = String(import.meta.env.VITE_MAP_PROVIDER || 'osm').toLowerCase();

export const MAP_PROVIDER =
  requested === 'google' && GOOGLE_MAPS_API_KEY
    ? 'google'
    : requested === 'naver' && NAVER_MAP_CLIENT_ID
      ? 'naver'
      : 'osm';
