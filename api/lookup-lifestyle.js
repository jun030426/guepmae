/*
 * /api/lookup-lifestyle — 좌표(lat,lng) 받아 Kakao Local API 로
 * 주변 편의시설 6종 검색 후 lifestyle 객체 반환.
 *
 * 응답:
 *   {
 *     lifestyle: { subway, school, mart, hospital, convenience, gym },
 *     nearest: { place, label, minutes, type } | null
 *   }
 *
 * 환경변수: KAKAO_REST_API_KEY
 */

const CATEGORIES = [
  { key: 'subway', code: 'SW8', label: '지하철', mode: 'walk', radius: 2000 },
  { key: 'school', code: 'SC4', label: '학교', mode: 'walk', radius: 2000 },
  { key: 'mart', code: 'MT1', label: '마트', mode: 'drive', radius: 5000 },
  { key: 'hospital', code: 'HP8', label: '병원', mode: 'drive', radius: 5000 },
  { key: 'convenience', code: 'CS2', label: '편의점', mode: 'walk', radius: 1500 },
];

const GYM_KEYWORDS = ['체육관', '헬스장', '스포츠센터'];

const KAKAO_BASE = 'https://dapi.kakao.com/v2/local/search';

function minutesFromMeters(meters, mode) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return null;
  // 도보 80m/분, 차량 500m/분 (도심 평균)
  const minutes = mode === 'walk' ? m / 80 : m / 500;
  return Math.max(1, Math.round(minutes));
}

async function searchCategory(apiKey, { code, x, y, radius }) {
  const url = `${KAKAO_BASE}/category.json?category_group_code=${code}&x=${x}&y=${y}&radius=${radius}&sort=distance&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.documents?.[0] ?? null;
}

async function searchKeyword(apiKey, { query, x, y, radius }) {
  const url = `${KAKAO_BASE}/keyword.json?query=${encodeURIComponent(query)}&x=${x}&y=${y}&radius=${radius}&sort=distance&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.documents?.[0] ?? null;
}

export default async function handler(req, res) {
  const lat = req.query.lat;
  const lng = req.query.lng;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat, lng 쿼리 파라미터가 필요합니다.' });
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.' });
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
    // 5개 카테고리 코드 기반
    for (const cat of CATEGORIES) {
      const doc = await searchCategory(apiKey, { code: cat.code, x: lng, y: lat, radius: cat.radius });
      if (!doc) continue;
      const minutes = minutesFromMeters(doc.distance, cat.mode);
      if (!minutes) continue;
      const modeLabel = cat.mode === 'walk' ? '도보' : '차량';
      const label = `${doc.place_name} ${modeLabel} ${minutes}분`;
      lifestyle[cat.key] = label;
      const distance = Number(doc.distance);
      if (!nearest || distance < nearest.distance) {
        nearest = {
          place: doc.place_name,
          label,
          minutes,
          type: cat.label,
          distance,
        };
      }
    }

    // 체육시설은 카테고리 코드 없음 → 키워드 검색 (여러 키워드 시도해서 가장 가까운 것)
    let gymDoc = null;
    for (const kw of GYM_KEYWORDS) {
      const doc = await searchKeyword(apiKey, { query: kw, x: lng, y: lat, radius: 2000 });
      if (doc) {
        if (!gymDoc || Number(doc.distance) < Number(gymDoc.distance)) gymDoc = doc;
      }
    }
    if (gymDoc) {
      const minutes = minutesFromMeters(gymDoc.distance, 'walk');
      const label = `${gymDoc.place_name} 도보 ${minutes}분`;
      lifestyle.gym = label;
      const distance = Number(gymDoc.distance);
      if (!nearest || distance < nearest.distance) {
        nearest = { place: gymDoc.place_name, label, minutes, type: '체육시설', distance };
      }
    }

    return res.status(200).json({ lifestyle, nearest });
  } catch (err) {
    console.error('[lookup-lifestyle] failed:', err);
    return res.status(500).json({ error: err.message ?? 'unknown error' });
  }
}
