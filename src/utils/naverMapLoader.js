let naverMapLoadPromise;

export function loadNaverMapSdk(clientId) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('NAVER_MAP_BROWSER_ONLY'));
  }

  if (window.naver?.maps) {
    return Promise.resolve(window.naver.maps);
  }

  if (!clientId) {
    return Promise.reject(new Error('NAVER_MAP_CLIENT_ID_REQUIRED'));
  }

  if (naverMapLoadPromise) {
    return naverMapLoadPromise;
  }

  naverMapLoadPromise = new Promise((resolve, reject) => {
    const callbackName = '__geupmaeNaverMapReady';
    const previousAuthFailure = window.navermap_authFailure;
    let timeoutId;

    const cleanup = () => {
      window.navermap_authFailure = previousAuthFailure;
      if (window[callbackName] === onReady) {
        delete window[callbackName];
      }
      window.clearTimeout(timeoutId);
    };

    const fail = (error) => {
      cleanup();
      naverMapLoadPromise = undefined;
      reject(error);
    };

    function onReady() {
      if (!window.naver?.maps) {
        fail(new Error('NAVER_MAP_LOAD_FAILED'));
        return;
      }

      cleanup();
      resolve(window.naver.maps);
    }

    window[callbackName] = onReady;
    window.navermap_authFailure = () => {
      if (typeof previousAuthFailure === 'function') {
        previousAuthFailure();
      }
      fail(new Error('NAVER_MAP_AUTH_FAILURE'));
    };

    const existingScript = document.querySelector('script[data-geupmae-naver-map]');
    if (existingScript) {
      timeoutId = window.setTimeout(() => fail(new Error('NAVER_MAP_LOAD_TIMEOUT')), 15000);
      return;
    }

    const script = document.createElement('script');
    const params = new URLSearchParams({
      ncpKeyId: clientId,
      callback: callbackName,
      language: 'ko',
    });

    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.geupmaeNaverMap = 'true';
    script.onerror = () => fail(new Error('NAVER_MAP_SCRIPT_ERROR'));
    timeoutId = window.setTimeout(() => fail(new Error('NAVER_MAP_LOAD_TIMEOUT')), 15000);

    document.head.appendChild(script);
  });

  return naverMapLoadPromise;
}
