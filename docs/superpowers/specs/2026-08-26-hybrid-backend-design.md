# 하이브리드 백엔드 전환 — 설계 스펙

- 작성: 2026-08-26
- 상태: 사용자 방향 승인됨 (하이브리드 / 새 전용 Supabase 프로젝트 / 8-28까지 인증 연동)

## 1. 배경과 목적

7-01 로컬 데모 모드 전환으로 앱은 백엔드 없이 완전히 동작한다(읽기=번들 JSON, 쓰기=localStorage). 포트폴리오 열람에는 강하지만, 쓰기가 브라우저 안에 갇혀 있어 **회원·중개사 매물 등록·문의가 실제 서비스로 성립하지 않는다**. 런칭 가능성을 열려면 쓰기 경로가 진짜여야 한다.

전면 동적 전환은 하지 않는다. 이유:

1. 무료 티어는 7일 무활동 시 일시정지된다. 읽기까지 백엔드에 걸면 그 순간 사이트 전체가 죽는다 (2026-08-26 실측: 잠든 프로젝트 첫 쿼리 타임아웃).
2. 방금 구축한 SEO 정적 페이지 395장 + sitemap 전략이 정적 읽기를 전제로 한다.
3. "클론 → npm run dev 만으로 전체 앱 실행"이라는 포트폴리오 속성을 잃는다.

## 2. 아키텍처 결정

**읽기는 번들, 쓰기와 인증은 Supabase, 백엔드가 없으면 지금처럼 로컬.**

| 경로 | 로컬 모드 (현행) | 하이브리드 모드 (신규) |
|---|---|---|
| 매물·시세·리포트 읽기 | 번들 JSON | 번들 JSON (동일) + Supabase 신규분 오버레이 |
| 회원가입·로그인·세션 | localStorage mock | **Supabase Auth** |
| 매물 등록·수정·삭제 | localStorage 오버레이 | **Supabase `properties`** (RLS) |
| 중개사 신청·회원 관리 | localStorage | **Supabase** |
| 백엔드 잠들었을 때 | 영향 없음 | 읽기 정상, 쓰기만 오류 안내 |

모드 결정: `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` 가 모두 있으면 하이브리드, 없으면 로컬. 코드 분기는 `src/lib/dataClient.js` 한 곳에서만 한다 — 서비스·페이지 코드는 지금처럼 `db.from()` / `db.auth.*` 만 호출하고 모드를 모른다.

핵심 대칭성: 현행 로컬 모드가 이미 "번들 + localStorage 오버레이(created/edits/deleted)" 병합 구조다. 하이브리드는 **오버레이 저장소를 localStorage에서 Supabase로 바꾸는 것**이며, 병합 로직은 동일하다.

## 3. 인프라

- **새 전용 Supabase 프로젝트** 생성 (ap-northeast-2). 무료 티어 활성 2개 제한 대응으로 `cheongyak-platform` 은 일시정지한다(가역 — 언제든 복원 가능).
- 기존 `geupmae-platform` (nmxdgfgyhxcqkksiknhp) 은 건드리지 않는다. 6-30 이후 다른 실험들(금리모아 gm_* 765건, 청헌 등)이 public 스키마를 쓰고 있고, 급매 원본 테이블은 `archive_geupmae` 스키마에 보존돼 있다.
- 스키마는 레포의 `supabase/migrations/` 25개 파일을 순서대로 적용한다 (초기 스키마 → auth/profiles → 중개사 신청 → storage → 역할 4단계·정지 → 시세·리포트 테이블 → 2026-06-24 정밀화까지).
- 데이터는 `public/data/*.json` 번들이 원본이다. `scripts/reload-supabase-tables.py` 로 재적재한다 (properties 395 · complex_prices · market_snapshots · property_reports 15 · ai_market_reports 1).
- 시크릿: 새 프로젝트의 URL/키는 `.env.local` 에만 둔다. service role 키는 재적재 스크립트에만 쓰고 절대 커밋하지 않는다 (.gitignore 확인 완료, 이력 유출 0건 확인 완료).

## 4. dataClient 변경 설계

```
dataClient.js
├─ 모드 판정: hasSupabase = VITE_SUPABASE_URL && VITE_SUPABASE_PUBLISHABLE_KEY
├─ auth: hasSupabase ? 실 supabase-js 클라이언트에 위임 : 현행 mock
├─ from(table):
│   ├─ 읽기 전용 번들 테이블 (complex_prices · market_snapshots ·
│   │   property_reports · ai_market_reports) → 항상 번들
│   ├─ properties 읽기 → 번들 + (hasSupabase ? Supabase 신규분 : localStorage) 오버레이
│   ├─ properties/partner_applications/profiles 쓰기
│   │   → hasSupabase ? Supabase : localStorage
│   └─ 실패 폴백: Supabase 오류 시 읽기는 번들만으로 응답, 쓰기는 오류 반환
└─ 의존성: @supabase/supabase-js 추가 (hasSupabase 일 때만 동적 import — 로컬 모드 번들 크기 불변)
```

`AuthContext.jsx` 는 수정하지 않는다 — 이미 Supabase 인터페이스(getSession / onAuthStateChange / signInWithPassword / signUp / signOut, profiles 조회, suspended 처리)로 작성돼 있다.

## 5. 검증 기준

1. **로컬 모드 회귀 없음**: `.env.local` 없이 클론 → dev → 전 화면 동작 (기존과 동일).
2. **가입 흐름**: 이메일 가입 → DB 트리거로 `profiles` 행 생성(role=user) → 로그인 → `/properties` 리다이렉트.
3. **권한**: user 는 매물 등록 불가(RLS 거부), agent 승인 후 자기 매물만 등록·수정 가능, owner/admin 은 전체.
4. **정지 계정**: suspended=true 계정 로그인 시 강제 로그아웃 동작.
5. **잠든 백엔드 시나리오**: Supabase 접속 실패 상태에서 매물 목록·상세·리포트 화면 정상 렌더.
6. **시크릿**: 커밋 diff 에 키 문자열 부재.

## 6. 단계

- **Phase 1 (8-26 ~ 8-27): 기반 + 인증** — 새 프로젝트 생성 · 마이그레이션 25개 적용 · 데이터 재적재 · dataClient 하이브리드화 · 인증 검증(기준 1·2·4·5·6).
- **Phase 2 (8-27 ~ 8-28): 쓰기 경로** — 중개사 신청 · 매물 등록/수정 RLS 검증(기준 3) · 보고서 반영.
- **Phase 3 (이후)**: 매물 사진 storage, 주 1회 keep-alive ping (GitHub Actions), 배포처 결정 (Vercel Hobby 비상업 제약 → Cloudflare Pages 검토), AI 리포트 주기 재생성.

## 6.5 Phase 1 검증 결과 (2026-08-26)

- 인프라: cheongyak-platform 일시정지 → 새 프로젝트 `geupmae`(oormfipegcfbhvctikfl, ap-northeast-2) 생성. 마이그레이션 25개를 7개 배치로 재적용 (enum 값 추가는 별도 트랜잭션 분리). RLS 공백 2건 보완: 중개사 자기 매물 SELECT, admin/owner 전체 SELECT. 번들에만 있던 `price_table`·`unit_count` 컬럼 추가. `property-photos` 버킷 SQL 생성.
- 데이터 적재: properties 395 · complex_prices 4,000 · market_snapshots 7 · property_reports 15 · ai_market_reports 1 — 전부 적재 확인.
- 기준 2 (가입 흐름): 실 signUp → `handle_new_user` 트리거 → profiles 자동 생성(role=user) → 로그인 세션 발급 확인. 이메일 확인은 신규 프로젝트 기본값 ON.
- 기준 3 (부분): user 권한 매물 INSERT → RLS 거부 확인. 익명 매물 SELECT 395건(전부 verified) 확인. agent/owner 플로우는 Phase 2.
- 기준 6 (시크릿): `.env.local` gitignore 유지, 커밋 diff 에 키 부재.
- 기준 1·4·5 (로컬 모드 회귀 · 정지 계정 · 잠든 백엔드): 코드 경로는 구현됨, 실측은 Phase 2 에서.
- 테스트 계정 `guepmae+verify1@gmail.com` (role=user) 이 검증용으로 남아 있음.

## 7. 리스크와 한계

- 무료 티어 일시정지: Phase 3 의 keep-alive 전까지는 7일 무활동 시 쓰기 경로가 잠들 수 있다. 읽기는 설계상 영향 없음.
- OAuth (signInWithOAuth): 마이그레이션에 흔적은 있으나 Phase 1-2 범위 밖. 이메일 인증만 다룬다.
- 매물 사진: 현행 번들 URL 그대로. storage 업로드는 Phase 3.
- `archive_geupmae` 의 옛 클라우드 데이터는 사용하지 않는다 — 번들 JSON 이 더 최신(6-24 기준가 정밀화 반영)이다.
