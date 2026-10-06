/*
 * kakaoLoader.js — 카카오맵 JavaScript SDK 지연 로드 + 주소 지오코딩.
 *
 * 용도: 지도(Map · MarkerClusterer), 집 앞 로드뷰(Roadview / RoadviewClient), 등록 시 주소→좌표(services.Geocoder).
 * 키가 없으면(VITE_KAKAO_APP_KEY 미설정) 호출 측이 사진 폴백으로 가도록 KAKAO_KEY_MISSING 을 던진다.
 * SDK 는 지도·투어 탭을 열거나 매물을 등록할 때만 로드한다 (초기 번들 불변).
 *
 * 콘솔 설정(사용자): 카카오 디벨로퍼스 → 앱 → 플랫폼 Web 에 localhost:5173, guepmae.vercel.app 등록,
 * 카카오맵 사용 설정 ON. 설정이 빠지면 SDK 가 조용히 실패하므로 콘솔 로그로 원인을 남긴다.
 */

export const KAKAO_APP_KEY = String(import.meta.env?.VITE_KAKAO_APP_KEY || '').trim();
export const hasKakaoKey = Boolean(KAKAO_APP_KEY);

let loadPromise;

export function loadKakaoMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('KAKAO_BROWSER_ONLY'));
  if (!hasKakaoKey) return Promise.reject(new Error('KAKAO_KEY_MISSING'));
  if (window.kakao?.maps?.Roadview) return Promise.resolve(window.kakao.maps);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const fail = (reason) => {
      loadPromise = undefined;
      console.error('[kakao] SDK 로드 실패 — 앱 키·Web 도메인 등록·카카오맵 사용 설정을 확인하세요.', reason);
      reject(new Error(reason));
    };
    const script = document.createElement('script');
    script.src =
      `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_APP_KEY)}` +
      '&libraries=services,clusterer&autoload=false';
    script.async = true;
    script.dataset.geupmaeKakao = 'true';
    script.onload = () => {
      if (!window.kakao?.maps?.load) {
        fail('KAKAO_LOAD_FAILED');
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao.maps));
    };
    script.onerror = () => fail('KAKAO_SCRIPT_ERROR');
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * 주소 → { lat, lng }. 못 찾으면 null. 키가 없거나 SDK 실패면 null (등록은 계속 진행).
 * 도로명·지번 모두 addressSearch 가 처리한다.
 */
export async function geocodeAddress(address) {
  const query = String(address || '').trim();
  if (!query) return null;
  let maps;
  try {
    maps = await loadKakaoMaps();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    try {
      const geocoder = new maps.services.Geocoder();
      geocoder.addressSearch(query, (result, status) => {
        if (status === maps.services.Status.OK && Array.isArray(result) && result[0]) {
          const lat = Number(result[0].y);
          const lng = Number(result[0].x);
          resolve(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null);
        } else {
          resolve(null);
        }
      });
    } catch (error) {
      console.warn('[kakao] 지오코딩 실패', error);
      resolve(null);
    }
  });
}
