/*
 * ai_market_reports — AI 가 생성한 시장 분석 리포트 캐시 (데이터 기준월별 1리포트).
 *
 * 생성: api/market-report.js (Vercel 서버리스 함수) 가 Gemini 호출 후 upsert.
 *       시장 데이터(market_snapshots)는 정적이라 한 번 생성하면 갱신까지 캐시 유지.
 * 읽기: 누구나 (RLS allows anon read) — /report 페이지에 그대로 노출.
 * 갱신: service_role + MARKET_REPORT_SECRET 보호 (force=true 트리거).
 *
 * PK = data_as_of (예: '2026-05'). market_snapshots.metadata.lastUpdated 와 같은 형태.
 * 데이터 갱신될 때마다 새 row 생성, 이전 월 기록은 그대로 보존.
 */

create table if not exists public.ai_market_reports (
  data_as_of text primary key,
  report_data jsonb not null,
  model text not null default 'google/gemini-2.5-flash',
  status text not null default 'ready',
  generated_at timestamptz not null default now(),
  prompt_token_count int,
  completion_token_count int
);

alter table public.ai_market_reports enable row level security;

grant select on public.ai_market_reports to anon, authenticated;

drop policy if exists "Public can read ai market reports" on public.ai_market_reports;
create policy "Public can read ai market reports"
on public.ai_market_reports
for select
to anon, authenticated
using (true);
