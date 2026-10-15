import { db, isHybrid } from '../lib/dataClient.js';
import { resolveReferencePrice } from '../../supabase/functions/_shared/resolveReferencePrice.js';

export async function writeManagedProperty(body) {
  const { data, error } = await db.functions.invoke('property-write', { body });
  if (error) {
    let message;
    try { message = (await error.context?.json())?.error; } catch { /* non-JSON gateway error */ }
    throw new Error(message || '매물 저장 서버에 연결하지 못했습니다. 서버 배포 상태를 확인해주세요.');
  }
  if (!data?.id) throw new Error(data?.error || '매물 저장 결과를 확인하지 못했습니다.');
  return data;
}

export async function updateProperty(property, input) {
  if (isHybrid) return writeManagedProperty({ action: 'edit', id: property.id, expectedRevision: property.revision, input });
  const { contact_phone, ...fields } = input;
  const reference = await resolveReferencePrice(db, {
    complexName: property.complexName || property.priceBasis?.complexName,
    gu: property.complexGu || property.priceBasis?.gu,
    areaM2: property.area, floor: input.floor ?? property.floor, price: input.price ?? property.price,
  });
  const { discountRate, ...basis } = reference.basis;
  const { data, error } = await db.from('properties').update({
    ...fields, ...(contact_phone === undefined ? {} : { agent: { ...property.agent, phone: contact_phone } }),
    verified: false, last_verified_at: null,
    revision: (property.revision || 1) + 1,
    actual_transaction_price: reference.price, discount_rate: discountRate,
    price_basis: { ...basis, complexName: property.priceBasis?.complexName, gu: property.priceBasis?.gu },
    updated_at: new Date().toISOString(),
  }).eq('id', property.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('매물을 찾을 수 없습니다.');
  return data[0];
}

export async function verifyProperty(property, verified) {
  if (isHybrid) return writeManagedProperty({ action: 'verify', id: property.id, expectedRevision: property.revision, input: { verified } });
  const { data, error } = await db.from('properties').update({
    verified, last_verified_at: verified ? new Date().toISOString().slice(0, 10) : null,
    revision: (property.revision || 1) + 1,
  }).eq('id', property.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('매물을 찾을 수 없습니다.');
  return data[0];
}
