/*
 * 지도 제공자 결정.
 *
 * 기본 규칙:
 *   - 카카오 JavaScript 키(VITE_KAKAO_APP_KEY)가 있으면 카카오맵 — 한국 지도 표기(단지명·동)가 정확하고,
 *     결제 등록 없이 무료 쿼터 안에서 동작한다. 로드뷰와 같은 키를 쓴다.
 *   - 키가 없으면 무료 OpenStreetMap(Leaflet). 클론 후 키 없이도 지도가 뜬다.
 *   - 카카오 SDK 로드가 실패하면(도메인 미등록 등) 화면 쪽에서 OSM 으로 넘어간다.
 *
 * Google/Naver 는 키가 있어도 자동 선택하지 않는다 — 결제 미연결 키가
 * 워터마크·로드 실패를 일으킨 전례(2026-09) 때문. 명시적으로 고를 때만:
 *   VITE_MAP_PROVIDER=google  (+ VITE_GOOGLE_MAPS_API_KEY, 결제 연결 필수)
 *   VITE_MAP_PROVIDER=naver   (+ VITE_NAVER_MAP_CLIENT_ID)
 *   VITE_MAP_PROVIDER=osm     (카카오 키가 있어도 OSM 강제)
 */

import { hasKakaoKey } from './kakaoLoader.js';

const env = import.meta.env ?? {}; // node 테스트에서는 import.meta.env 가 없다

export const GOOGLE_MAPS_API_KEY = env.VITE_GOOGLE_MAPS_API_KEY;
export const NAVER_MAP_CLIENT_ID = env.VITE_NAVER_MAP_CLIENT_ID;

export function resolveMapProvider({ requested, hasGoogle, hasNaver, hasKakao }) {
  const wanted = String(requested || '').trim().toLowerCase();
  if (wanted === 'google' && hasGoogle) return 'google';
  if (wanted === 'naver' && hasNaver) return 'naver';
  if (wanted === 'osm') return 'osm';
  return hasKakao ? 'kakao' : 'osm';
}

export const MAP_PROVIDER = resolveMapProvider({
  requested: env.VITE_MAP_PROVIDER,
  hasGoogle: Boolean(GOOGLE_MAPS_API_KEY),
  hasNaver: Boolean(NAVER_MAP_CLIENT_ID),
  hasKakao: hasKakaoKey,
});
