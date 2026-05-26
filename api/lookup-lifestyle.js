/*
 * /api/lookup-lifestyle — 좌표(lat,lng) 받아 Google Places Nearby Search 로
 * 주변 편의시설 6종 검색 후 lifestyle 객체 반환.
 *
 * 응답:
 *   {
 *     lifestyle: { subway, school, mart, hospital, convenience, gym },
 *     nearest: { place, label, minutes, type, distance } | null
 *   }
 *
 * 환경변수:
 *   GOOGLE_PLACES_API_KEY  — 서버 사이드용 Google Maps API 키 (Places API 활성화 필요)
 *   (옵션: KAKAO_REST_API_KEY 가 설정되어 있고 GOOGLE_PLACES_API_KEY 가 없으면 Kakao 사용)
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

  // 직선 거리 계산해서 가장 가까운 것 1개
  let nearest = null;
  for (const r of results) {
    const loc = r.geometry?.location;
    if (!loc) continue;
    const d = haversineMeters(lat, lng, loc.lat, loc.lng);
    if (!nearest || d < nearest.distance) {
      nearest = { name: r.name, distance: d, vicinity: r.vicinity };
    }
  }
  return nearest;
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat, lng 쿼리 파라미터가 필요합니다 (숫자).' });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY 환경변수가 설정되지 않았습니다.' });
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
    // 6개 카테고리 병렬 조회
    const results = await Promise.all(
      CATEGORIES.map((cat) =>
        googleNearbySearch({ apiKey, type: cat.type, lat, lng, radius: cat.radius })
          .then((doc) => ({ cat, doc }))
          .catch(() => ({ cat, doc: null })),
      ),
    );

    for (const { cat, doc } of results) {
      if (!doc) continue;
      const minutes = minutesFromMeters(doc.distance, cat.mode);
      if (!minutes) continue;
      const modeLabel = cat.mode === 'walk' ? '도보' : '차량';
      const label = `${doc.name} ${modeLabel} ${minutes}분`;
      lifestyle[cat.key] = label;
      if (!nearest || doc.distance < nearest.distance) {
        nearest = {
          place: doc.name,
          label,
          minutes,
          type: cat.label,
          distance: doc.distance,
        };
      }
    }

    return res.status(200).json({ lifestyle, nearest });
  } catch (err) {
    console.error('[lookup-lifestyle] failed:', err);
    return res.status(500).json({ error: err.message ?? 'unknown error' });
  }
}
