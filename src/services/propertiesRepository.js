import { db } from '../lib/dataClient.js';
import { buildTourPanoramas } from '../utils/panoramaTour.js';

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
    actualTransactionPrice: toNumber(row.actual_transaction_price),
    discountRate: toNumber(row.discount_rate),
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
    // 투어 데이터는 media 항목에서 승격한다 — { type: '360' } 파노라마(순서·자동 링크 포함), { type: '3d' } 모델.
    tour: (() => {
      const media = Array.isArray(row.media) ? row.media : [];
      const baseTour = row.tour && typeof row.tour === 'object' ? row.tour : {};
      const tour = { ...baseTour };
      const panoramas = buildTourPanoramas(media);
      if (panoramas.length > 0) tour.panoramas = panoramas;
      const model3d = media.find((item) => item && item.type === '3d' && item.src);
      if (model3d) {
        tour.modelUrl = model3d.src;
        tour.modelLabel = model3d.label ?? null;
      }
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

  return (data ?? []).map(normalizeProperty);
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

  return data ? normalizeProperty(data) : null;
}
