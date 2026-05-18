let googleMapLoadPromise;

export function loadGoogleMapSdk(apiKey) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('GOOGLE_MAP_BROWSER_ONLY'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (!apiKey) {
    return Promise.reject(new Error('GOOGLE_MAP_API_KEY_REQUIRED'));
  }

  if (googleMapLoadPromise) {
    return googleMapLoadPromise;
  }

  googleMapLoadPromise = new Promise((resolve, reject) => {
    const callbackName = '__geupmaeGoogleMapReady';
    let timeoutId;

    const cleanup = () => {
      if (window[callbackName] === onReady) {
        delete window[callbackName];
      }
      window.clearTimeout(timeoutId);
    };

    const fail = (error) => {
      cleanup();
      googleMapLoadPromise = undefined;
      reject(error);
    };

    function onReady() {
      if (!window.google?.maps) {
        fail(new Error('GOOGLE_MAP_LOAD_FAILED'));
        return;
      }
      cleanup();
      resolve(window.google.maps);
    }

    window[callbackName] = onReady;

    const existingScript = document.querySelector('script[data-geupmae-google-map]');
    if (existingScript) {
      timeoutId = window.setTimeout(() => fail(new Error('GOOGLE_MAP_LOAD_TIMEOUT')), 15000);
      return;
    }

    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: apiKey,
      callback: callbackName,
      language: 'ko',
      region: 'KR',
      v: 'weekly',
      loading: 'async',
    });

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.geupmaeGoogleMap = 'true';
    script.onerror = () => fail(new Error('GOOGLE_MAP_SCRIPT_ERROR'));
    timeoutId = window.setTimeout(() => fail(new Error('GOOGLE_MAP_LOAD_TIMEOUT')), 15000);

    document.head.appendChild(script);
  });

  return googleMapLoadPromise;
}
