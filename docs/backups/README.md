# Supabase 백업

## supabase_backup_20260827/

2026-08-27 실거래 최신화 작업에서 `properties` 테이블을 395행 → 387행으로
교체하기 직전의 스냅샷.

- `properties.json` — 395행 (price_basis.computedAt 전량 2026-06-24)
- `property_reports.json` — 15행

복원이 필요하면 `properties` → `property_reports` 순서로 넣는다.
`property_reports_property_id_fkey` 가 ON DELETE CASCADE 라 순서를 지켜야 한다.
