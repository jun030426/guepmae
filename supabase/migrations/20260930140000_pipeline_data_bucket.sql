/*
 * pipeline-data — 데이터 파이프라인 원본 보관 버킷 (비공개).
 *
 * GitHub Actions 의 실거래 증분 수집이 실행 사이에 원본 CSV(시도별 gzip)를 두는 곳.
 * 정책을 만들지 않는다 — anon/authenticated 는 접근할 수 없고, service_role(파이프라인)만 RLS 를 우회해 읽고 쓴다.
 * 내용은 국토교통부 공개 실거래 데이터(개인정보 없음)지만, 공개할 이유가 없어 비공개로 둔다.
 * 동기화: scripts/pipeline-data-sync.mjs · 워크플로: .github/workflows/daily-trades-refresh.yml
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pipeline-data', 'pipeline-data', false, 52428800, array['application/gzip', 'application/json', 'application/octet-stream'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
