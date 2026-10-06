import { db } from '../lib/dataClient.js';
import { buildTourPanoramas } from '../utils/panoramaTour.js';
import { isLocalMediaRef, resolveMediaUrl } from '../utils/mediaUrl.js';

// 로컬 데모 저장소 참조(idb:)가 섞인 media 는 표시용 object URL 로 바꾼 사본(mediaDisplay)을 붙인다.
// media 자체는 원본 참조를 유지한다 — 수정 폼이 저장할 때 blob: URL 이 행에 들어가면 안 되기 때문.
async function withDisplayMedia(property) {
  const media = Array.isArray(property.media) ? property.media : [];
  if (!media.some((item) => item && isLocalMediaRef(item.src))) return { ...property, mediaDisplay: media };
  const mediaDisplay = await Promise.all(
    media.map(async (item) => (item && isLocalMediaRef(item.src) ? { ...item, src: await resolveMediaUrl(item.src) } : item)),
  );
  return { ...property, mediaDisplay };
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

const defaultAgent = {
  name: '담당자',
  office: '',
  phone: '',
  verified: false,
};

const defaultLifestyle = {
  subway: '',
  school: '',
  mart: '',
  hospital: '',
  park: '',
  commute: '',
};

function normalizeProperty(row) {
  const priceHistory = Array.isArray(row.price_history) ? row.price_history : [];

  return {
    id: row.id,
    title: row.title,
    address: row.address,
    coordinates: row.coordinates ?? null,
    region: row.region,
    propertyType: row.property_type,
    price: toNumber(row.price),
    // 판정 보류 매물은 기준가·할인율이 null — 0 으로 바꾸면 "0% 저렴"이라는 가짜 주장이 된다
    actualTransactionPrice: row.actual_transaction_price == null ? null : toNumber(row.actual_transaction_price),
    discountRate: row.discount_rate == null ? null : toNumber(row.discount_rate),
    urgentScore: toNumber(row.urgent_score),
    area: toNumber(row.area),
    supplyArea: toNumber(row.supply_area),
    floor: row.floor ?? '',
    direction: row.direction ?? '',
    occupancyStatus: row.occupancy_status ?? '',
    builtYear: toNumber(row.built_year),
    imageLabel: row.image_label ?? '',
    verified: Boolean(row.verified),
    lastVerifiedAt: row.last_verified_at ?? '',
    recentTransactionDate: row.recent_transaction_date ?? '',
    description: row.description ?? '',
    parking: row.parking ?? '',
    maintenanceFee: toNumber(row.maintenance_fee),
    moveInDate: row.move_in_date ?? '',
    rooms: toNumber(row.rooms),
    bathrooms: toNumber(row.bathrooms),
    unitCount: toNumber(row.unit_count),
    agent: { ...defaultAgent, ...(row.agent ?? {}) },
    lifestyle: { ...defaultLifestyle, ...(row.lifestyle ?? {}) },
    priceHistory,
    priceTable: row.price_table ?? null,
    media: Array.isArray(row.media) ? row.media : [],
    // 투어 데이터는 media 항목에서 승격한다 — { type: '360' } 파노라마(순서·자동 링크 포함).
    tour: (() => {
      const media = Array.isArray(row.media) ? row.media : [];
      const baseTour = row.tour && typeof row.tour === 'object' ? row.tour : {};
      const tour = { ...baseTour };
      const panoramas = buildTourPanoramas(media);
      if (panoramas.length > 0) tour.panoramas = panoramas;
      return tour;
    })(),
    createdAt: row.created_at ?? null,
    priceBasis: row.price_basis ?? null,
  };
}

export async function fetchProperties() {
  const { data, error } = await db
    .from('properties')
    .select('*')
    .order('discount_rate', { ascending: false });

  if (error) {
    throw error;
  }

  return Promise.all((data ?? []).map((row) => withDisplayMedia(normalizeProperty(row))));
}

export async function fetchPropertyById(id) {
  const { data, error } = await db
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? withDisplayMedia(normalizeProperty(data)) : null;
}
