# Supabase + Vercel 연결 메모

## 1. 로컬 환경변수

프로젝트 루트에 `.env.local`을 만들고 아래 값을 넣습니다.

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_NAVER_MAP_CLIENT_ID=your_naver_map_client_id
```

구형 Supabase 프로젝트를 쓰는 경우 `VITE_SUPABASE_PUBLISHABLE_KEY` 대신 `VITE_SUPABASE_ANON_KEY`도 동작합니다.
`service_role` 또는 `sb_secret_` 키는 브라우저 앱에 넣지 않습니다.

## 2. Supabase DB 적용

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

적용되는 테이블:

- `properties`: 공개 매물 목록
- `property_submissions`: 매도자 검증 요청 저장
- `profiles`: Supabase Auth 사용자별 내부 역할
- `seller_verifications`: 매도자 소유 증빙 심사
- `agent_applications`: 중개사 가입/광고문의 신청서

## 3. Auth 역할 운영

공개 로그인 화면에서는 역할을 선택하지 않습니다. 로그인 후 `profiles.role` 값을 기준으로 내부 권한을 판단합니다.

- `user`: 일반 사용자
- `seller`: 매도자 회원
- `agent`: 제휴 중개사 계정
- `admin`: 내부 관리자 계정

공개 회원가입 화면에서는 일반 사용자 계정만 생성합니다. `agent`, `admin`은 Supabase Dashboard에서 Auth 사용자를 만든 뒤 SQL Editor 또는 Table Editor에서 역할을 바꿉니다.

```sql
update public.profiles
set role = 'agent'
where email = 'agent@example.com';

update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

중개사 가입/광고문의 화면은 Auth 계정을 바로 만들지 않고 `agent_applications`에 신청서를 저장합니다. 제출 서류는 `agent-application-documents` Storage bucket에 저장됩니다.

## 4. Vercel 배포 설정

Vercel 프로젝트 환경변수에 로컬과 같은 값을 추가합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_NAVER_MAP_CLIENT_ID`

Vite 기본 설정:

- Build Command: `npm run build`
- Output Directory: `dist`

`vercel.json`의 rewrite 설정으로 `/properties/gm-001` 같은 React Router 경로를 새로고침해도 `index.html`로 연결합니다.
