#!/usr/bin/env python
# 정규화 매물 JSON → import-listings.py 가 읽는 "매물입력" 엑셀
#
# 사용:
#   python scripts/write-listing-excel.py <input.json> <output.xlsx>
#
# 입력 JSON: 객체 배열. 키는 엑셀 열 이름 그대로.
#   필수 — 단지명, 구/시군구, 전용면적(㎡), 호가(원)
#   선택 — 제목, 층, 방수, 욕실수, 준공연도, 향, 공급면적(㎡), 관리비(원),
#          주차, 입주가능일, 거주상태, 세대수, 매물설명, 도로명주소, 주소
#   사진 — 문자열 배열. 사진1, 사진2 … 열로 펼쳐진다.
#
# 중개사 개인정보 열은 금지한다.
import json, re, sys
from openpyxl import Workbook

REQUIRED = ["단지명", "구/시군구", "전용면적(㎡)", "호가(원)"]

# import-listings.py:200 의 FIELDS 와 같은 집합. 엑셀 열 순서를 고정한다.
FIELD_ORDER = ["제목", "층", "방수", "욕실수", "준공연도", "향", "공급면적(㎡)",
               "관리비(원)", "주차", "입주가능일", "거주상태", "세대수",
               "매물설명", "도로명주소", "주소"]

# 중개사 개인정보 열 차단. 정확 일치가 아니라 부분 문자열로 판정한다 —
# 수집기가 "중개사무소 전화", "담당자 연락처" 같은 변형 라벨을 보낼 수 있다.
# 허용 열(REQUIRED + FIELD_ORDER + 사진N) 중 어느 것도 아래 조각을 포함하지 않는다.
BANNED_PARTS = ["중개", "전화", "연락처", "휴대", "등록번호", "담당자"]


def _assert_no_private_columns(rows):
    for row in rows:
        for key in row:
            flat = re.sub(r"\s+", "", str(key))
            for part in BANNED_PARTS:
                if part in flat:
                    raise ValueError(
                        f"중개사 개인정보 열은 수집·저장하지 않습니다: {key!r}")


def _is_complete(row):
    return all(row.get(k) not in (None, "") for k in REQUIRED)


def header_for(rows):
    """필수 4열 + 등장한 선택열(FIELD_ORDER 순) + 사진1..N"""
    present = {k for row in rows for k in row}
    header = list(REQUIRED)
    header += [f for f in FIELD_ORDER if f in present]
    max_photos = 0
    for row in rows:
        photos = row.get("사진") or []
        if isinstance(photos, list):
            max_photos = max(max_photos, len(photos))
    header += [f"사진{i + 1}" for i in range(max_photos)]
    return header


def build_workbook(rows):
    _assert_no_private_columns(rows)
    kept = [r for r in rows if _is_complete(r)]
    header = header_for(kept)
    wb = Workbook()
    ws = wb.active
    ws.title = "매물입력"
    ws.append(header)
    for row in kept:
        photos = row.get("사진") or []
        line = []
        for col in header:
            if col.startswith("사진"):
                idx = int(col[2:]) - 1
                line.append(photos[idx] if idx < len(photos) else None)
            else:
                line.append(row.get(col))
        ws.append(line)
    return wb


def main():
    if len(sys.argv) < 3:
        print("사용: python scripts/write-listing-excel.py <input.json> <output.xlsx>")
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        rows = json.load(f)
    wb = build_workbook(rows)
    wb.save(dst)
    kept = wb["매물입력"].max_row - 1
    print(f"입력 {len(rows)}행 → 채택 {kept}행 (필수 4열 미충족 {len(rows) - kept}행 폐기)")
    print(f"출력: {dst}")


if __name__ == "__main__":
    main()
