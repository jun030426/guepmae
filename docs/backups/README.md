# Supabase 백업

## supabase_backup_20260827/

2026-08-27 실거래 최신화 작업에서 `properties` 테이블을 395행 → 387행으로
교체하기 직전의 스냅샷.

- `properties.json` — 395행 (price_basis.computedAt 전량 2026-06-24)
- `property_reports.json` — 15행

복원이 필요하면 `properties` → `property_reports` 순서로 넣는다.
`property_reports_property_id_fkey` 가 ON DELETE CASCADE 라 순서를 지켜야 한다.

## Supabase 스키마 `backup_20261008` (DB 안에 보관)

2026-10-08 데이터 전면 갱신을 위해 매물을 전부 지우기 직전의 스냅샷. 파일이 아니라
라이브 DB(`geupmae`, oormfipegcfbhvctikfl)의 별도 스키마에 테이블로 복사해 두었다.
API(anon·authenticated)에서는 접근할 수 없다.

| 테이블 | 행 수 | 내용 |
|---|---|---|
| `properties` | 390 | 수집 매물 387 (검증 완료) + 테스트 매물 3 |
| `property_reports` | 15 | AI 매물 리포트 |
| `property_inspections` | 2 | AI 설비 점검 |
| `property_verifications` | 387 | 운영 검증 기록 |
| `property_daily_stats` | 10 | 조회·문의 일별 합계 |

복원은 `properties` 를 먼저 넣고 나머지를 넣는다. 예:
`insert into public.properties select * from backup_20261008.properties;`
더 이상 필요 없으면 `drop schema backup_20261008 cascade;`

같은 날 저장소의 `public/data/properties.json` · `property_reports.json` 은 `[]` 로 비웠고,
오래된 115건 가짜 시드(`supabase/seed/properties_seed.sql`)는 삭제했다. 이전 내용은 git 이력에 있다.
