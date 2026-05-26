import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

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
    media: Array.isArray(row.media) ? row.media : [],
    createdAt: row.created_at ?? null,
  };
}

export async function fetchProperties() {
  if (!isSupabaseConfigured) {
    return [];
  }

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('discount_rate', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map(normalizeProperty);
}

export async function fetchPropertyById(id) {
  if (!isSupabaseConfigured) {
    return null;
  }

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? normalizeProperty(data) : null;
}
