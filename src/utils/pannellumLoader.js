/*
 * Pannellum — 경량 360° 파노라마 뷰어 (CDN 지연 로드)
 * https://pannellum.org/
 *
 * 실내 360 데이터가 등록된 매물에서만 호출됨.
 * 라이브러리 자체는 매물에 panoramas 데이터가 있을 때만 fetch되므로
 * 번들 크기에 영향 없음.
 */

const PANNELLUM_VERSION = '2.5.6';
const PANNELLUM_JS = `https://cdn.jsdelivr.net/npm/pannellum@${PANNELLUM_VERSION}/build/pannellum.js`;
const PANNELLUM_CSS = `https://cdn.jsdelivr.net/npm/pannellum@${PANNELLUM_VERSION}/build/pannellum.css`;

let pannellumLoadPromise;

export function loadPannellum() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PANNELLUM_BROWSER_ONLY'));
  }

  if (window.pannellum) {
    return Promise.resolve(window.pannellum);
  }

  if (pannellumLoadPromise) {
    return pannellumLoadPromise;
  }

  pannellumLoadPromise = new Promise((resolve, reject) => {
    // CSS
    if (!document.querySelector('link[data-geupmae-pannellum]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PANNELLUM_CSS;
      link.dataset.geupmaePannellum = 'true';
      document.head.appendChild(link);
    }

    const existing = document.querySelector('script[data-geupmae-pannellum]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.pannellum) resolve(window.pannellum);
        else reject(new Error('PANNELLUM_LOAD_FAILED'));
      });
      existing.addEventListener('error', () => reject(new Error('PANNELLUM_SCRIPT_ERROR')));
      return;
    }

    const script = document.createElement('script');
    script.src = PANNELLUM_JS;
    script.async = true;
    script.defer = true;
    script.dataset.geupmaePannellum = 'true';
    script.onload = () => {
      if (window.pannellum) {
        resolve(window.pannellum);
      } else {
        pannellumLoadPromise = undefined;
        reject(new Error('PANNELLUM_LOAD_FAILED'));
      }
    };
    script.onerror = () => {
      pannellumLoadPromise = undefined;
      reject(new Error('PANNELLUM_SCRIPT_ERROR'));
    };
    document.head.appendChild(script);
  });

  return pannellumLoadPromise;
}
