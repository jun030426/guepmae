/*
 * /api/lookup-lifestyle — 좌표 또는 주소를 받아 주변 편의시설 6종 + 좌표를 반환.
 *
 * 입력 (둘 중 하나):
 *   - lat, lng: 좌표 직접
 *   - address: 주소 (서버에서 Geocoding API로 좌표 변환)
 *
 * 응답:
 *   {
 *     coordinates: { lat, lng } | null,
 *     lifestyle: { subway, school, mart, hospital, convenience, gym },
 *     nearest: { place, label, minutes, type, distance } | null
 *   }
 *
 * 환경변수:
 *   GOOGLE_PLACES_API_KEY  — 서버 사이드용 Google API 키 (Places API + Geocoding API 활성화 필요)
 */

const CATEGORIES = [
  { key: 'subway', type: 'subway_station', label: '지하철', mode: 'walk', radius: 2000 },
  { key: 'school', type: 'school', label: '학교', mode: 'walk', radius: 2000 },
  { key: 'mart', type: 'supermarket', label: '마트', mode: 'drive', radius: 5000 },
  { key: 'hospital', type: 'hospital', label: '병원', mode: 'drive', radius: 5000 },
  { key: 'convenience', type: 'convenience_store', label: '편의점', mode: 'walk', radius: 1500 },
  { key: 'gym', type: 'gym', label: '체육시설', mode: 'walk', radius: 2000 },
];

// Haversine: 두 좌표 간 직선 거리(m)
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function minutesFromMeters(meters, mode) {
  if (!Number.isFinite(meters)) return null;
  // 도보 80m/분, 차량 500m/분 (도심 평균)
  const minutes = mode === 'walk' ? meters / 80 : meters / 500;
  return Math.max(1, Math.round(minutes));
}

// Geocoding 주소 구성요소에서 "시도 + 구/시/군" 행정구역 키를 추출.
// price_trends 테이블의 gu 값(예: "서울특별시 강남구", "경기도 수원시 영통구")과 매칭하기 위함.
function extractRegion(components) {
  if (!Array.isArray(components)) return null;
  const sidoComp = components.find((c) => c.types?.includes('administrative_area_level_1'));
  const sido = sidoComp?.long_name;
  if (!sido) return null;

  // 시도를 제외하고 시/군/구로 끝나는 구성요소 수집 (중복 제거)
  const seen = new Set();
  const units = [];
  for (const c of components) {
    const name = c.long_name;
    if (!name || name === sido || seen.has(name)) continue;
    if (/(시|군|구)$/.test(name)) {
      seen.add(name);
      units.push(name);
    }
  }
  // 시 → 군 → 구 순서 (예: "수원시 영통구")
  const rank = (n) => (n.endsWith('시') ? 0 : n.endsWith('군') ? 1 : 2);
  units.sort((a, b) => rank(a) - rank(b));

  const gu = [sido, ...units].join(' ');
  return { sido, gu };
}

async function googleGeocode({ apiKey, address }) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('language', 'ko');
  url.searchParams.set('region', 'kr');
  url.searchParams.set('key', apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    console.warn('[Geocoding] status:', data.status, data.error_message);
    return null;
  }
  const result = data.results[0];
  const loc = result.geometry?.location;
  if (!loc) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    region: extractRegion(result.address_components),
  };
}

async function googleNearbySearch({ apiKey, type, lat, lng, radius }) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', String(radius));
  url.searchParams.set('type', type);
  url.searchParams.set('language', 'ko');
  url.searchParams.set('rankby', 'prominence');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn('[Places] non-OK status:', data.status, data.error_message);
  }
  const results = data.results ?? [];
  if (results.length === 0) return null;

  // 직선 거리 계산해서 가장 가까운 것 1개 (좌표도 보관 — Distance Matrix 용)
  let nearest = null;
  for (const r of results) {
    const loc = r.geometry?.location;
    if (!loc) continue;
    const d = haversineMeters(lat, lng, loc.lat, loc.lng);
    if (!nearest || d < nearest.distance) {
      nearest = { name: r.name, distance: d, vicinity: r.vicinity, lat: loc.lat, lng: loc.lng };
    }
  }
  return nearest;
}

// Distance Matrix — 실제 도보/차량 경로 거리·시간 (한 모드당 배치 1회)
async function googleDistanceMatrix({ apiKey, origin, destinations, mode }) {
  if (!destinations.length) return [];
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destinations', destinations.map((d) => `${d.lat},${d.lng}`).join('|'));
  url.searchParams.set('mode', mode); // 'walking' | 'driving'
  url.searchParams.set('language', 'ko');
  url.searchParams.set('key', apiKey);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'OK') {
      console.warn('[DistanceMatrix] status:', data.status, data.error_message);
      return [];
    }
    const elements = data.rows?.[0]?.elements ?? [];
    return elements.map((el) =>
      el?.status === 'OK'
        ? {
            meters: el.distance?.value ?? null,
            minutes: el.duration ? Math.max(1, Math.round(el.duration.value / 60)) : null,
          }
        : null,
    );
  } catch (err) {
    console.warn('[DistanceMatrix] failed:', err);
    return [];
  }
}

// 실제 도보 거리(m) 기준 역세권 분류 (도시계획 통상 기준: 500m/1km 반경)
function classifyStationArea(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters <= 500) return '초역세권';
  if (meters <= 1000) return '역세권';
  if (meters <= 1500) return '역 인접';
  return '비역세권';
}

export default async function handler(req, res) {
  // GOOGLE_PLACES_API_KEY 우선 (별도 서버용 키). 없으면 기존 VITE_GOOGLE_MAPS_API_KEY 재사용.
  // ⚠️ 후자는 HTTP 리퍼러 제한이 걸려있으면 서버 호출 시 REQUEST_DENIED 반환됨 — 제한 해제 필요.
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GOOGLE_PLACES_API_KEY 또는 VITE_GOOGLE_MAPS_API_KEY 환경변수가 필요합니다.',
    });
  }

  let lat = Number(req.query.lat);
  let lng = Number(req.query.lng);
  const address = req.query.address;
  let region = null;

  // 좌표 없으면 주소로 Geocoding
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!address) {
      return res.status(400).json({ error: 'lat/lng 또는 address 가 필요합니다.' });
    }
    const geo = await googleGeocode({ apiKey, address });
    if (!geo) {
      return res.status(404).json({ error: '입력하신 주소의 좌표를 찾을 수 없습니다.' });
    }
    lat = geo.lat;
    lng = geo.lng;
    region = geo.region;
  }

  const lifestyle = {
    subway: '',
    school: '',
    mart: '',
    hospital: '',
    convenience: '',
    gym: '',
  };
  let nearest = null;

  try {
    // 1) 카테고리별 최근접 장소 (Places, 좌표 포함)
    const results = await Promise.all(
      CATEGORIES.map((cat) =>
        googleNearbySearch({ apiKey, type: cat.type, lat, lng, radius: cat.radius })
          .then((doc) => ({ cat, doc }))
          .catch(() => ({ cat, doc: null })),
      ),
    );

    // 2) Distance Matrix 로 실제 경로 거리·시간 (모드별 배치 1회씩)
    const origin = { lat, lng };
    const found = results.filter((r) => r.doc && Number.isFinite(r.doc.lat) && Number.isFinite(r.doc.lng));
    const walkItems = found.filter((r) => r.cat.mode === 'walk');
    const driveItems = found.filter((r) => r.cat.mode === 'drive');
    const [walkDM, driveDM] = await Promise.all([
      googleDistanceMatrix({ apiKey, origin, destinations: walkItems.map((r) => r.doc), mode: 'walking' }),
      googleDistanceMatrix({ apiKey, origin, destinations: driveItems.map((r) => r.doc), mode: 'driving' }),
    ]);
    const dmByCat = new Map();
    walkItems.forEach((r, i) => dmByCat.set(r.cat.key, walkDM[i] || null));
    driveItems.forEach((r, i) => dmByCat.set(r.cat.key, driveDM[i] || null));

    // 3) 라벨 생성 (DM 실패 시 직선거리 fallback)
    let subwayMeters = null;
    for (const { cat, doc } of results) {
      if (!doc) continue;
      const dm = dmByCat.get(cat.key);
      const meters = dm?.meters ?? doc.distance;
      const minutes = dm?.minutes ?? minutesFromMeters(doc.distance, cat.mode);
      if (!minutes) continue;
      const modeLabel = cat.mode === 'walk' ? '도보' : '차량';
      lifestyle[cat.key] = `${doc.name} ${modeLabel} ${minutes}분`;
      if (cat.key === 'subway') subwayMeters = meters;
      if (!nearest || meters < nearest.distance) {
        nearest = { place: doc.name, label: lifestyle[cat.key], minutes, type: cat.label, distance: meters };
      }
    }

    // 4) 역세권 분류 (실제 도보 거리 기준)
    const grade = classifyStationArea(subwayMeters);
    if (grade && lifestyle.subway) {
      lifestyle.stationArea = `${grade} — ${lifestyle.subway} (약 ${Math.round(subwayMeters)}m)`;
    }

    return res.status(200).json({
      coordinates: { lat, lng },
      lifestyle,
      nearest,
      region,
    });
  } catch (err) {
    console.error('[lookup-lifestyle] failed:', err);
    return res.status(500).json({ error: err.message ?? 'unknown error' });
  }
}
