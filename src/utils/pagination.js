// 말줄임 페이지네이션 항목 계산 — 항상 7칸 이하로 고정.
// 반환: 숫자(페이지) 또는 'ellipsis*' 문자열(말줄임 표시자, key 충돌 방지용으로 좌우 구분).
// Properties · MapPage 공용.
export function getPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, 'ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'ellipsis-left', currentPage - 1, currentPage, currentPage + 1, 'ellipsis-right', totalPages];
}
