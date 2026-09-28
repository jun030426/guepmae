/*
 * property_inspections — AI 점검 리포트 캐시 (수도·배관·가스 등 체크리스트, 1매물 1건).
 *
 * 생성: Edge Function inspection-report 가 매물 사진을 Gemini 멀티모달로 분석해
 *       service role 로 upsert. 클라이언트 직접 쓰기 없음.
 * 읽기: 누구나 (상세 페이지 점검 섹션).
 * 원칙: 사진으로 확인되지 않는 항목은 '확인 불가'로 표기 — 추측·과장 금지.
 */

create table if not exists public.property_inspections (
  property_id text primary key references public.properties(id) on delete cascade,
  report_data jsonb not null,
  status text not null default 'ready' check (status in ('ready', 'generating', 'failed')),
  model text,
  photo_count integer not null default 0,
  generated_at timestamptz not null default now()
);

alter table public.property_inspections enable row level security;

grant select on public.property_inspections to anon, authenticated;

drop policy if exists "Public can read property inspections" on public.property_inspections;
create policy "Public can read property inspections"
on public.property_inspections
for select
to anon, authenticated
using (true);
