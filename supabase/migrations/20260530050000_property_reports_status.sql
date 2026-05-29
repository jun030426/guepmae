/*
 * property_reports 에 status 컬럼 추가 — 동시 생성 레이스 방지용 락.
 *   - 'ready'      : 생성 완료된 정상 리포트 (기존 행 전부 이 값)
 *   - 'generating' : 생성 중 선점 락 (report_data 는 임시 {} )
 *
 * 생성 시작 시 status='generating' 로우를 먼저 insert(PK 선점) → 한 요청만 AI 호출.
 * 완료되면 status='ready' 로 update. (api/property-report.js)
 */

alter table public.property_reports
  add column if not exists status text not null default 'ready';
