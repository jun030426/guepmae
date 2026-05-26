/*
 * property_reports — AI가 생성한 매물별 리포트 캐시 (1매물 1리포트).
 *
 * 생성: api/property-report.js (Vercel 서버리스 함수) 가 Gemini 호출 후 upsert.
 * 읽기: 누구나 (RLS allows anon read).
 * 갱신: service_role 만 (서버리스 함수가 service role key로 INSERT/UPDATE).
 *
 * 구조: report_data 는 5개 파트 객체 (summary / basic / priceAnalysis / location / opinion).
 * 자세한 schema 는 src/services/propertyReports.js 의 zod schema 참조.
 */

create table if not exists public.property_reports (
  property_id text primary key references public.properties(id) on delete cascade,
  report_data jsonb not null,
  model text not null default 'google/gemini-2.0-flash',
  generated_at timestamptz not null default now(),
  prompt_token_count int,
  completion_token_count int
);

alter table public.property_reports enable row level security;

grant select on public.property_reports to anon, authenticated;

drop policy if exists "Public can read property reports" on public.property_reports;
create policy "Public can read property reports"
on public.property_reports
for select
to anon, authenticated
using (true);
