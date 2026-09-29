# 자동 수집 워크플로 리허설

`.github/workflows/daily-trades-refresh.yml` 의 `run` 단계를 **실제 키 없이** 처음부터 끝까지 돌려 보는 도구다.
파이프라인 스크립트나 워크플로를 고친 뒤, 푸시하기 전에 실행한다.

```bash
python scripts/rehearsal/rehearse.py
```

- Windows 는 Git Bash 에서 실행한다. 1~2분 걸린다.
- 필요: Python 3 + PyYAML(`pip install pyyaml`), Node(`npm install` 을 마친 상태), git, bash.
- `--verbose` 단계 출력을 모두 본다 · `--keep` 임시 폴더를 남겨 둔다.
- 작업은 전부 임시 폴더에서 한다. 저장소의 `scripts/data`·`public/data` 나 실제 Supabase 는 건드리지 않는다.

## 무엇으로 바꿔치기하나

| 실제 | 리허설 |
|---|---|
| 국토부 실거래가 API | `pysite/sitecustomize.py` — 파이썬의 `urlopen` 을 가로채 가짜 XML 을 돌려준다 |
| Supabase (Storage · REST) | `fake-supabase.mjs` — 스크립트가 쓰는 경로만 메모리에서 흉내 |
| GitHub 원격 저장소 | 임시 폴더의 bare git 저장소 |
| 실거래 원본 CSV | `gen-base.mjs` — 번들의 단지·가격 수준을 본떠 만든 가짜 CSV (실제 거래가 아님) |
| GitHub Actions 러너 | `rehearse.py` — job env 의 식, 단계 `if`, `GITHUB_OUTPUT`, 단계 결과만 흉내 |

## 확인하는 상황

| | 상황 | 기대 |
|---|---|---|
| A | 시크릿 없음 | 실패 없이 전부 건너뜀 |
| A2 | 예약 실행을 아직 켜지 않음 | 예약 실행은 건너뜀 (수동 실행은 동작) |
| B | 버킷이 비어 있음 | 안내만 남기고 수집을 건너뜀 |
| C | 첫 수동 실행(dry_run) | API 호출 = 시군구 × 3개월, 이번 달 제외, Supabase 쓰기 0건 |
| D | 매일 실행 | `complex_trades` upsert(삭제 없음), 원본 17개 + 메타 올림 |
| D2 | 다시 실행 | 행이 중복되지 않음 |
| E | 한 시도 API 장애(정상 응답·0건) | 경고만, 그 시도의 기존 이력 보존 |
| L | API 일일 한도 | 경고만, 받은 데까지 반영 |
| H | 한 시도 응답이 1/10 | 행 수 점검에서 중단, 아무것도 올리지 않음 |
| K | API 키 오류 | 실패로 끝남, 아무것도 올리지 않음 |
| M | `months` 입력 오류 | 수집 전에 중단 |
| F | 번들 갱신(publish_bundles) | 봇 커밋이 `public/data` 만 바꿈, 탈락 매물만 DB 에서 정리, **중개사 등록 매물 보존** |
| N | 바로 다시 실행 | 바뀐 것이 없으면 커밋하지 않음 |
| I | 실행 중 main 이 앞서 감 | 다른 커밋 위에 얹어서 푸시 |
| G | 매물이 10% 넘게 탈락 | 재계산에서 중단, 커밋·DB 변경 없음 |

## 확인하지 못하는 것

`actions/checkout`·`setup-node`·`setup-python`, `npm ci`, Ubuntu 러너 환경, 실제 국토부 API 와 Supabase 의 응답 형식.
이것들은 Actions 탭에서 `dry_run` 을 켠 첫 수동 실행으로 확인한다 (`docs/DESKTOP_TODO.md` C).
