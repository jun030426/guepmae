# 360 실내 투어 + 로드뷰 폴백 설계

작성일: 2026-09-29
상태: 사용자 방향 확정 (2026-09-29 대화) — 합성 JPG 우선, 전부 무료 스택, 지점 간 화살표 이동

## 1. 배경

매물 상세의 "3D 투어" 탭은 현재 세 갈래로 동작한다.

| 매물 데이터 | 지금 보이는 것 | 상태 |
|---|---|---|
| `.glb` 3D 모델 (`media[].type = '3d'`) | `<model-viewer>` 회전 뷰 | 라이브에 7KB 샘플 1건뿐. 하이브리드 모드 전용 |
| 360 파노라마 (`tour.panoramas`) | Pannellum 단일 씬 + 공간 버튼 | 뷰어만 있고 **올리는 경로가 없다**. 데이터를 만들어 주는 코드가 어디에도 없음 |
| 아무것도 없음 | Google/Naver 거리뷰 → 사진 넘기기 | 기본 지도가 OSM으로 바뀌면서 거리뷰 코드는 꺼져 있고, 등록 시 좌표를 만들지 않아 새 매물은 좌표가 비어 있음 |

사용자가 원하는 것은 두 가지다.

1. **360 카메라로 찍은 사진이 있으면** — 찍은 지점 사이를 로드뷰처럼 화살표로 이동하며 집 안을 둘러본다. 자유 이동(메시 기반)은 아니다.
2. **없으면** — 등록 주소로 좌표를 잡아 집 앞 도로뷰를 자동으로 보여준다. 중개사가 따로 할 일은 없다.

제약: **전부 무료로.** 결제 등록이 필요한 API, 유료 스티칭 서비스, 별도 서버는 쓰지 않는다.

### 1.1 Insta360 원본(.insp) 실측

상위 폴더의 `IMG_20260501_162230_00_021.insp`를 열어 확인했다 (2026-09-29).

- JPEG 컨테이너(`FF D8`), 6080×3040, EXIF 모델 `Insta360 ONE X2`
- 내용은 **앞·뒤 어안 렌즈 원본 두 장이 나란히 든 미합성 이미지**. 정방형 파노라마가 아니다. GPano/equirectangular 메타데이터 없음
- 따라서 브라우저에 그대로 넣으면 원 두 개가 보인다. 360으로 쓰려면 스티칭(합성)이 필요하다

스티칭 선택지와 판정:

| 방법 | 화질 | 비용/인프라 | 판정 |
|---|---|---|---|
| Insta360 공식 Media SDK | 앱과 동일(광학 흐름) | 승인 필요한 비공개 C++ 라이브러리. Supabase Edge/Vercel에서 못 돌림 → 별도 리눅스 서버 필요 | 기각 — "무료·서버 없음" 위배 |
| 브라우저 WebGL 재투영 | 이음새에서 가까운 물체가 어긋날 수 있음(시차 미보정) | 없음. 업로드 시점에 클라이언트에서 수 초 | **2단계** 편의 기능 |
| Insta360 앱/Studio에서 내보낸 합성 JPG 업로드 | 최상 | 없음. 폰 앱은 사진을 폰으로 받는 순간 자동 합성 | **1단계 기본 경로** |

## 2. 목표

1. 중개사가 합성된 360 JPG를 여러 장 올리면, 상세 페이지에서 찍은 순서대로 앞/뒤 화살표로 이동하는 투어가 된다. 로컬 데모·하이브리드 양쪽에서 동작한다.
2. 360 사진이 없는 매물은 등록 주소 기준 카카오 로드뷰를 자동으로 보여주고, 로드뷰가 없는 위치는 지금처럼 사진으로 폴백한다.
3. 등록 시 주소를 좌표로 바꿔 저장한다 (지도 탭·로드뷰·생활권의 공통 전제).
4. (2단계) `.insp` 원본을 올리면 브라우저에서 자동 변환한다. (2단계) 갈래가 있는 구조를 위해 화살표를 직접 잇는 편집기를 붙인다.

## 3. 비목표

- 메시/가우시안 스플랫 기반 자유 이동, 돌하우스 뷰 (Matterport 영역)
- `.insv` 360 영상
- 사진에서 문 위치를 자동 인식해 화살표를 놓는 것 (CV)
- 실내 로드뷰. 로드뷰는 도로에서 집을 바라보는 용도로만
- 일반 사진 저장 방식(행 안 data URL) 개선 — 별도 작업. 단, 이 스펙의 로컬 저장소는 나중에 사진에도 재사용 가능하게 설계한다
- 기존 `.glb` 뷰어 제거 — 그대로 두되 우선순위만 낮춘다

## 4. 아키텍처 결정

### 4.1 스택 (전부 무료)

| 역할 | 선택 | 근거 |
|---|---|---|
| 360 뷰어·지점 이동 | Pannellum 2.5.6 (이미 CDN 지연 로드 중) | 멀티 씬 + `type: 'scene'` 핫스팟이 기본 기능. 추가 의존성 없음 |
| 파노라마 저장 (하이브리드) | Supabase Storage 버킷 `property-360` (공개 읽기) | `property-3d`와 같은 패턴. 무료 1GB — 장당 ≤2MB로 줄이면 파일럿 수십 건 충분 |
| 파노라마 저장 (로컬 데모) | IndexedDB | localStorage 5MB 한도 때문. 새로고침 후에도 유지되어야 시연이 됨 |
| 이미지 처리 | 브라우저 (`createImageBitmap` 리사이즈 → canvas → JPEG) | 서버 없음. 4096×2048로 통일 |
| 로드뷰 + 지오코딩 | 카카오맵 JavaScript SDK (`Roadview`, `RoadviewClient`, `services.Geocoder`) | 결제 등록 없이 무료. 지오코딩이 같은 SDK에 있어 서버 없이 등록 화면에서 처리. 구글은 한국 커버리지 없음, 네이버는 클라우드 결제 등록 필요 |
| 지도 탭 | 변경 없음 (OSM/Leaflet) | 이 스펙은 투어 탭과 좌표 생성만 다룬다 |

카카오 무료 한도의 정확한 수치는 콘솔 기준으로 구현 시 확인해 이 문서에 기록한다. 파일럿 규모(일 수천 회)에서는 문제되지 않는다.

### 4.2 투어 탭 표시 우선순위

```
360 파노라마 있음  → 지점 이동 투어 (신규)
.glb 모델 있음     → <model-viewer> (기존)
embedUrl 있음      → iframe (기존)
좌표 있음          → 카카오 로드뷰 (신규) — 반경 내 로드뷰 없으면 ↓
그 외              → 등록 사진 넘기기 (기존 TourFallbackPreview)
```

탭 라벨은 "3D 투어"에서 **"360 투어"** 로 바꾼다. 파노라마 기반이라 "3D"는 과장이고, 이 제품의 원칙은 과장하지 않는 것이다.

### 4.3 데이터 모델 — `media` 항목 확장, 컬럼 추가 없음

`properties.tour` 컬럼은 없다(2026-09-29 실측). `.glb`와 같은 방식으로 `media` jsonb 항목에 담고, 읽을 때 `tour.panoramas`로 승격한다. 마이그레이션은 버킷 생성뿐이다.

```jsonc
// properties.media 의 360 항목
{
  "type": "360",
  "id": "p1",                       // 매물 내 고유. 링크 참조용
  "src": "https://…/property-360/properties/gm-xxx/pano-1-1727600000.jpg",
  "label": "현관",                  // 선택. 기본 "지점 1"
  "order": 1,                       // 찍은 순서 = 이동 순서
  "yawOffset": 0,                   // 정면 보정(도). 1단계에서는 항상 0
  "links": [                        // 선택. 없으면 order 기반 자동 링크
    { "to": "p2", "yaw": 0, "pitch": -10, "label": "거실로" }
  ]
}
```

- 행에는 **URL만** 들어간다(항목당 300바이트 안팎). 하이브리드 목록 오버레이가 `select *`로 전 매물을 읽는 구조라, 파노라마를 data URL로 행에 넣는 일은 절대 하지 않는다.
- 로컬 데모 모드의 `src`는 `idb:<key>` 형식이다. 뷰어에 넘기기 직전에 IndexedDB blob → object URL로 바꾼다.
- `propertiesRepository.normalizeProperty`가 `tour.panoramas`를 만든다: `order` 오름차순, 각 항목에 `links`가 없으면 자동 링크를 채운다.

**자동 링크 규칙 (1단계):**

| 링크 | 위치 (yaw, pitch) | 대상 | 진입 시 시선 |
|---|---|---|---|
| 앞으로 | (0°, −10°) | `order + 1` | yaw 0 (진행 방향 유지) |
| 뒤로 | (180°, −10°) | `order − 1` | yaw 180 (왔던 방향을 본다) |

yaw 0 = 이미지 중앙 = 카메라 앞면 방향이다 (Insta360 앱 내보내기 기본). 그래서 등록 폼에 촬영 안내를 넣는다: **"진행 방향으로 카메라 앞면을 향하게 세워 들고, 한 걸음씩 이동하며 찍으세요."** 이 규칙을 지키면 편집 없이 화살표가 맞아떨어진다. 갈래(거실에서 세 방향)는 2단계 편집기로 `links`를 직접 쓴다.

### 4.4 업로드 처리 파이프라인 (브라우저)

```
파일 선택 (image/jpeg, 최대 12장)
  → 검증: 가로:세로 = 2:1 (±2%), 가로 ≥ 2048  — 아니면 "360 사진이 아닌 것 같습니다" 거부
  → 리사이즈: createImageBitmap(file, { resizeWidth: 4096, resizeHeight: 2048, resizeQuality: 'high' })
              (미지원 브라우저는 canvas.drawImage 스케일 폴백)
  → 인코딩: canvas.toBlob('image/jpeg', 0.85)  → 보통 1~2MB
  → 저장: 하이브리드 = Storage 업로드 후 공개 URL / 로컬 = IndexedDB put → idb:<key>
  → media 항목 생성 (order = 선택 순서, label = 입력값 또는 "지점 n")
```

4096×2048로 통일하는 이유: Pannellum이 모바일 GPU 텍스처 한계로 4096 초과 파노라마에 경고를 내고, 저장 용량도 이 크기에서 장당 ≤2MB로 잡힌다. 원본(6080×3040, 72MP 등)은 보관하지 않는다.

업로드는 순차 처리하고 진행률(n/총)을 보여준다. 한 장이 실패하면 나머지는 계속 올리고, 실패 장수만 안내한다.

### 4.5 지점 이동 뷰어 (`IndoorTourPreview` 교체)

현재는 씬이 바뀔 때마다 뷰어를 파괴·재생성하며 핫스팟이 없다. Pannellum 멀티 씬 설정으로 바꾼다.

```js
pannellum.viewer(el, {
  default: { firstScene: panoramas[0].id, sceneFadeDuration: 600, autoLoad: true, hfov: 100 },
  scenes: Object.fromEntries(panoramas.map((p) => [p.id, {
    type: 'equirectangular',
    panorama: resolvedSrc(p),           // idb: → object URL
    title: p.label,
    yaw: p.yawOffset ?? 0,
    hotSpots: p.links.map((l) => ({
      type: 'scene', sceneId: l.to, yaw: l.yaw, pitch: l.pitch, text: l.label,
      targetYaw: 0, targetPitch: 0,
      cssClass: `tour-arrow tour-arrow-${directionOf(l.yaw)}`,   // forward / back / left / right
    })),
  }])),
});
```

- 화살표는 Pannellum 기본 아이콘 대신 `cssClass`로 로드뷰풍 화살표를 그린다 (앞·뒤·좌·우 4종).
- 기존 공간 버튼 목록은 유지한다 (버튼 = `viewer.loadScene(id)`). 화살표와 버튼 둘 다 되게.
- `scenechange` 이벤트로 현재 지점 라벨을 갱신한다.
- 키보드: ↑ = 앞 링크, ↓ = 뒤 링크 (있을 때만).

### 4.6 카카오 로드뷰 폴백 (`KakaoRoadviewPanel` 신규)

```
좌표 없음 → 사진 폴백 (기존)
좌표 있음 → RoadviewClient.getNearestPanoId(latlng, 50)
             없으면 반경 150 재시도 → 그래도 없으면 사진 폴백 + "이 위치는 로드뷰가 없습니다"
             있으면 Roadview.setPanoId(panoId, latlng)
                    setViewpoint({ pan: 파노라마 위치 → 매물 좌표 방위각, tilt: 0, zoom: 0 })
```

- 집을 바라보도록 시선을 맞추는 것이 핵심이다. 방위각은 파노라마 위치(`roadview.getPosition()`)에서 매물 좌표로 계산한다.
- 아파트 단지 안쪽 도로는 로드뷰가 없는 경우가 많다. 반경 150m면 대개 단지 입구 도로가 잡힌다. 그것도 없으면 정직하게 사진으로 간다.
- SDK 로더 `src/utils/kakaoLoader.js`: `https://dapi.kakao.com/v2/maps/sdk.js?appkey=…&libraries=services&autoload=false` → `kakao.maps.load()`. 투어 탭을 열 때만 로드한다.
- 키가 없으면(`VITE_KAKAO_APP_KEY` 미설정) 로드뷰 단계를 건너뛰고 사진 폴백으로 간다. 클론 후 키 없이도 앱은 깨지지 않는다.

### 4.7 등록 시 지오코딩

`registerProperty`의 `fetchLifestyleAndCoords`는 지금 항상 `null`을 돌려준다. 여기에 카카오 `Geocoder.addressSearch(address)`를 붙여 `coordinates: { lat, lng }`를 저장한다.

- 단지 자동완성으로 고른 경우도 주소 입력값으로 지오코딩한다 (단지 좌표 테이블이 없음).
- 실패(키 없음·주소 미인식)하면 좌표 `null` — 지금과 동일. 폼에 "좌표를 찾지 못해 지도·로드뷰가 표시되지 않습니다" 안내를 띄운다.
- 생활권(지하철·학교 거리) 자동 조회는 이 스펙 범위 밖이다.

### 4.8 로컬 데모 저장소 (`src/utils/localMediaStore.js`)

- IndexedDB `geupmae-media` / object store `blobs` (key: `pano-<timestamp>-<n>`, value: Blob)
- `put(blob) → key`, `getObjectUrl(key) → string` (캐시), `remove(key)`
- `dataClient.js`의 `localStorageMock.upload`가 이 저장소에 쓰고 `path = idb:<key>`를 돌려준다. `getPublicUrl(path)`는 그대로 `idb:<key>`.
- `src/utils/mediaUrl.js`의 `resolveMediaUrl(src)`: `idb:`면 object URL, 아니면 그대로. 투어 패널과 (추후) 사진 뷰어가 이 함수를 거친다.
- 매물 삭제 시 해당 키를 정리한다 (best effort).

### 4.9 인프라·설정

- 마이그레이션 `supabase/migrations/20260930000000_property_360_bucket.sql`: 버킷 `property-360`, 공개 읽기, `agent/admin/owner` 쓰기·수정·삭제, 파일 한도 8MB, `image/jpeg`만. `property_3d_bucket.sql`과 동일 구조.
- `.env.example`에 `VITE_KAKAO_APP_KEY=` 추가. Vercel 환경변수에도 동일 키.
- 카카오 디벨로퍼스 (사용자 작업): 앱 생성 → JavaScript 키 → 플랫폼 Web에 `http://localhost:5173`, `https://guepmae.vercel.app` 등록 → 카카오맵 사용 설정 ON.
- CSP/헤더 변경 없음 (현재 제한 없음).

## 5. 화면

### 5.1 등록 폼 (`AgentRegisterProperty`) — 새 섹션 "360 투어 사진 (선택)"

- 파일 입력 `accept="image/jpeg"` 다중, 최대 12장. 2단계에서 `.insp` 추가.
- 촬영 안내 3줄: 카메라 앞면을 진행 방향으로 · 한 걸음씩 · 세워서(수평 유지).
- 선택 후 목록: 썸네일(원본 축소), 라벨 입력(선택), ↑↓ 순서 변경, 삭제.
- 제출 시 처리·업로드 진행률 표시. 파노라마 처리는 사진·3D 업로드와 병렬로 시작하되 순차 업로드.
- 결과 매물의 `media`에 360 항목이 붙는다.

### 5.2 수정 폼 (`AgentEditProperty`)

- 기존 360 항목 목록(라벨·순서·삭제) + 추가 업로드. 삭제된 하이브리드 객체는 Storage에서도 지운다 (best effort).

### 5.3 상세 페이지

- 탭 라벨 "360 투어". 파노라마가 있으면 갤러리의 "투어 보기" 타일에 "360 · n지점" 배지.
- 투어 없는 매물은 로드뷰 또는 사진 폴백. 폴백 문구는 기존 문구 유지.

## 6. 2단계

### 6.1 `.insp` 자동 변환 (`src/utils/inspStitch.js`)

- 입력 판별: 확장자 `.insp` 또는 EXIF 모델이 `Insta360`으로 시작하고 GPano 메타가 없는 JPEG.
- 모델 프리셋 (`inspPresets.js`): 렌즈 원 중심·반지름, 화각, 회전. **ONE X2부터** 상위 폴더 샘플 20장으로 보정해 확정한다. 프리셋 없는 모델은 "앱에서 내보낸 360 사진을 올려주세요"로 거부.
- 변환: WebGL 프래그먼트 셰이더. 출력 픽셀(경도·위도) → 방향 벡터 → 앞/뒤 렌즈 선택 → 등거리 어안 투영 좌표로 샘플 → 겹침 구간(화각−180°)은 알파 블렌딩. 출력 4096×2048 JPEG.
- 수평 보정(자이로)은 하지 않는다. 촬영 안내로 대신한다.
- 결과 항목에 `stitched: 'browser'`를 남기고, 폼에 "자동 변환은 렌즈 이음새가 보일 수 있습니다. 더 좋은 화질은 Insta360 앱에서 내보낸 사진" 안내.

### 6.2 갈래 편집기

- 수정 폼에서 파노라마를 열고 클릭한 위치(yaw, pitch)에 "→ 어느 지점으로" 링크를 추가/삭제. 저장 시 `links`를 명시적으로 쓴다.
- `links`가 있는 항목은 자동 링크를 적용하지 않는다 (명시가 우선).

## 7. 검증 기준

1단계 완료 판정은 아래를 모두 만족할 때다.

1. **로컬 모드:** 360 JPG 3장 등록 → 새로고침 후에도 360 투어 탭에서 앞/뒤 화살표로 3지점 이동. localStorage에 파노라마 바이트가 들어가지 않음 (행 크기 < 5KB).
2. **하이브리드:** 같은 흐름에서 `property-360` 버킷에 3개 객체 생성, 각 ≤2MB, 매물 `media`에는 URL만.
3. 2:1이 아닌 일반 사진을 360 칸에 올리면 거부 메시지, 나머지 등록은 정상.
4. 6080×3040 JPG 1장 처리+업로드 5초 이내 (일반 노트북, 로컬 모드).
5. 360 없는 매물 + 좌표 있음 + 카카오 키 있음 → 로드뷰가 집을 향해 열림. 로드뷰 없는 좌표(예: 산간) → 사진 폴백 + 안내 문구.
6. 카카오 키 없이 클론 → 등록·상세 모두 오류 없이 사진 폴백.
7. 등록 시 주소로 좌표가 저장되고 지도 탭에 마커가 뜬다.
8. 기존 SPA 회귀 없음 — 사진·지도·리포트 탭, `.glb` 매물, 클라이언트 라우팅 정상, 콘솔 오류 0.
9. 테스트: `node --test`로 순수 함수 검증 — 비율 검증, 자동 링크 생성, 방위각 계산, `resolveMediaUrl`.

2단계: ONE X2 `.insp` 1장 업로드 → 변환된 파노라마 표시, 이음새 안내 노출, 변환 10초 이내.

## 8. 리스크

- **카카오 콘솔 설정.** 도메인 미등록·사용 설정 OFF면 SDK가 조용히 실패한다. 로더가 실패를 잡아 사진 폴백으로 가고 콘솔에 원인을 남긴다.
- **로드뷰 커버리지.** 단지 내부는 없는 경우가 많다. 반경 확대 + 정직한 폴백으로 대응. "집 앞"이 아니라 "단지 입구"가 보일 수 있음을 안내 문구에 반영한다.
- **화살표 방향 오차.** 촬영 규칙을 안 지키면 앞 화살표가 엉뚱한 방향을 가리킨다. 1단계는 안내로, 2단계는 편집기와 `yawOffset`으로 해결.
- **모바일 메모리.** 72MP 원본을 `createImageBitmap` 리사이즈로 처리하면 디코드 단계에서 줄어들지만, 폴백 canvas 경로는 원본 크기 캔버스를 만든다. 폴백에서는 2단계 축소(먼저 1/2, 다시 목표 크기)로 완화.
- **Storage 용량.** 무료 1GB. 장당 2MB 기준 약 500장. 매물당 12장 한도로 약 40건. 넘어가면 Cloudflare R2(무료 10GB)로 버킷만 교체 — URL만 바뀌므로 데이터 모델은 그대로.
- **`.insp` 이음새 품질.** 2단계 기능의 핵심 불확실성. 샘플 보정 후 결과가 실사용 기준에 못 미치면 "앱 내보내기 안내"만 남기고 자동 변환은 접는다.
- **사생활.** 360은 방 전체가 찍힌다. 등록 안내에 "서류·사진·얼굴이 찍히지 않게 정리 후 촬영"을 넣는다.

## 9. 선행 수정 (이 스펙 밖, 먼저 처리)

투어를 확인하려면 등록 직후 상세 페이지에 도달해야 한다. 2026-09-29 점검에서 확인된 아래 항목을 먼저 고친다.

- 로컬 모드 등록 직후 `/properties/undefined`로 이동 — `dataClient.js`의 mutation 결과에 `single()` 미적용
- 등록 폼 기준 실거래가 미리보기 미표시 — `resolveReferencePrice` 호출에 `areaM2` 누락
- "등록 즉시 AI 매물 리포트 생성" 문구 — 생성 백엔드 없음. 문구 제거 또는 사실대로

## 10. 구현 개요 (파일 단위)

1단계:

| 파일 | 변경 |
|---|---|
| `supabase/migrations/20260930000000_property_360_bucket.sql` | 신규 — 버킷·정책 |
| `src/utils/panorama.js` | 신규 — `isEquirectangular(w,h)`, `downscaleTo4096(file)`, `autoLinks(panoramas)`, `bearing(from,to)` (순수 함수 + 브라우저 함수 분리) |
| `src/utils/localMediaStore.js` | 신규 — IndexedDB put/get/remove |
| `src/utils/mediaUrl.js` | 신규 — `resolveMediaUrl` |
| `src/utils/kakaoLoader.js` | 신규 — SDK 지연 로드 |
| `src/lib/dataClient.js` | 로컬 storage mock을 IndexedDB로 |
| `src/services/propertyRegistration.js` | `uploadPropertyPanoramas`, 카카오 지오코딩, `media`에 360 항목 |
| `src/services/propertiesRepository.js` | `tour.panoramas` 승격 + 자동 링크 |
| `src/pages/AgentRegisterProperty.jsx`, `AgentEditProperty.jsx` | 360 섹션 |
| `src/components/PropertyMediaViewer.jsx` | `IndoorTourPreview` 멀티 씬 교체, `KakaoRoadviewPanel`, 우선순위, 탭 라벨 |
| `src/styles/compass-phase1.css` | 화살표 핫스팟, 360 섹션, 진행률 |
| `.env.example`, `README.md`, `SUPABASE_VERCEL_SETUP.md` | 카카오 키 안내 |
| `src/utils/panorama.test.mjs` | 순수 함수 테스트 |

2단계: `src/utils/inspStitch.js`, `src/utils/inspPresets.js`, 링크 편집 컴포넌트, 수정 폼 확장.

## 11. 함께 기록해 두는 결정

- 탭 이름은 "360 투어". "3D"는 `.glb`가 있을 때만 캡션에 쓴다.
- `.glb` 업로드는 유지하되 문서·폼에서 "선택, 실험 기능"으로 낮춘다.
- 로드뷰 제공자 선택 순서: 카카오(키 있음) → 네이버(`VITE_MAP_PROVIDER=naver`) → 구글(`=google`) → 사진. 기존 두 구현은 지우지 않는다.
- 파노라마 원본은 서버에 남기지 않는다. 필요하면 중개사가 다시 올린다.

## 12. 검증 결과 (2026-09-29, 1단계 로컬 데모 모드)

브라우저에서 합성 파노라마 JPG(4096×2048) 3장 + 일반 사진 1장으로 등록 → 상세 → 수정 흐름을 돌렸다.

| §7 기준 | 결과 |
|---|---|
| 1. 로컬 3장 등록 → 새로고침 후 투어 3지점 이동, 행 크기 < 5KB | ✅ 매물 행 1,522바이트(URL 참조만). IndexedDB 에 Blob 3개. 새로고침·재진입 후 투어 유지 |
| 3. 2:1 아닌 사진 거부 | ✅ "360 사진이 아닌 것 같습니다 (1200×900)…" 안내, 나머지 3장은 정상 등록 |
| 4. 처리 시간 | ✅ 4096×2048 3장 검증+축소+저장 2.1초. (6080×3040 실촬영 파일은 샘플 확보 후 재측정) |
| 순서·라벨 편집 | ✅ ↑↓ 로 순서 변경, 라벨 입력 → order·label 로 저장 |
| 화살표 이동 | ✅ 첫 지점: 앞 화살표만 / 중간: 앞·뒤 / 마지막: 뒤 화살표만. 화살표 클릭·지점 버튼 클릭 모두 이동, 현재 지점 라벨·활성 버튼 동기화 |
| 수정 폼 | ✅ 저장된 지점 3개 미리보기(object URL) 표시, 1개 삭제 후 저장 → 2지점으로 갱신 |
| 8. 회귀 | ✅ 기존 테스트 60 + 신규 7 통과, 프로덕션 빌드 통과, 콘솔 오류 없음 |
| 2. 하이브리드 업로드 | ⏳ `property-360` 버킷 마이그레이션 라이브 적용 후 검증 |
| 5·6·7. 로드뷰·지오코딩 | ⏳ `VITE_KAKAO_APP_KEY` 발급 후 검증. 키 없는 상태에서 사진 폴백은 확인 |

발견·반영: Pannellum 크로스페이드는 현재 화면 스냅샷(canvas.toDataURL)을 쓰는데, 뷰어 컨테이너 폭이 0 인 상태(숨겨진 패널)에서 장면을 바꾸면 빈 스냅샷에 걸려 전환이 영구히 멈춘다. 초기화 시 컨테이너 폭이 0 이면 페이드를 끄도록 했다. 보이는 화면에서는 600ms 크로스페이드가 그대로 동작한다.

