/*
 * properties 에 향(direction)·거주상태(occupancy_status) 컬럼 추가.
 *   - direction: '남향' 등
 *   - occupancy_status: '공실' | '세입자 거주' | '집주인 거주'
 */

alter table public.properties
  add column if not exists direction text;

alter table public.properties
  add column if not exists occupancy_status text;
