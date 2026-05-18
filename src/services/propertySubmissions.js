import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

function numberOrNull(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export async function createPropertySubmission(form, result) {
  if (!isSupabaseConfigured) {
    return { data: null, source: 'local' };
  }

  const payload = {
    property_type: form.propertyType,
    address: form.address,
    complex_name: form.complexName || null,
    area: numberOrNull(form.area),
    desired_price: numberOrNull(form.desiredPrice),
    recent_transaction_price: numberOrNull(form.recentTransactionPrice),
    floor: form.floor || null,
    built_year: numberOrNull(form.builtYear),
    move_in_date: form.moveInDate || null,
    reason: form.reason || null,
    discount_rate: result.discountRate,
    price_gap: result.priceGap,
    urgent_score: result.urgentScore,
    is_urgent: result.urgent,
  };

  const { error } = await supabase.from('property_submissions').insert(payload);

  if (error) {
    throw error;
  }

  return { data: null, source: 'supabase' };
}
