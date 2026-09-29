/*
 * panoramaTour.js — 360 투어 순수 로직. 브라우저 API 를 쓰지 않아 node:test 로 검증한다.
 *
 * 데이터 모델 (properties.media 의 360 항목):
 *   { type: '360', id, src, label, order, yawOffset, stitched?,
 *     links?: [{ to, yaw, pitch, targetYaw, label }], linksExplicit?: true }
 *
 * yaw 규약: 0 = 이미지 중앙 = 촬영 시 카메라 앞면 방향. 시계 방향으로 증가(도).
 * 자동 링크: 직접 편집하지 않은 지점은 찍은 순서로 앞(다음 지점, yaw 0)·뒤(이전 지점, yaw 180)를 잇는다.
 * 직접 편집(linksExplicit): 갈래 편집기에서 손댄 지점은 links 를 그대로 쓴다 — 빈 배열이면 화살표 없음.
 * 설계: docs/superpowers/specs/2026-09-29-360-tour-roadview-design.md §4.3, §6.2
 */

export const PANORAMA_MEDIA_TYPE = '360';
export const PANORAMA_MAX_COUNT = 12;
export const PANORAMA_MIN_WIDTH = 2048;

export const LINK_PITCH = -10;

/** 정방형(equirectangular) 파노라마 판별 — 가로:세로 = 2:1 (±tolerance), 최소 가로폭 이상. */
export function isEquirectangular(width, height, { tolerance = 0.04, minWidth = PANORAMA_MIN_WIDTH } = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return false;
  if (width < minWidth) return false;
  return Math.abs(width / height - 2) <= tolerance;
}

/** yaw 를 [0, 360) 로 정규화. */
export function normalizeYaw(yaw) {
  const value = Number(yaw);
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

/** 화살표 방향 분류 — 로드뷰풍 4방향 아이콘 선택용. */
export function directionOf(yaw) {
  const y = normalizeYaw(yaw);
  if (y < 45 || y >= 315) return 'forward';
  if (y < 135) return 'right';
  if (y < 225) return 'back';
  return 'left';
}

export const DIRECTION_LABELS = { forward: '앞', right: '오른쪽', back: '뒤', left: '왼쪽' };

function isExplicit(pano) {
  return pano?.linksExplicit === true || (Array.isArray(pano?.links) && pano.links.length > 0);
}

function normalizeLink(link) {
  return {
    to: link.to,
    yaw: normalizeYaw(link.yaw),
    pitch: Number.isFinite(Number(link.pitch)) ? Math.max(-60, Math.min(60, Number(link.pitch))) : LINK_PITCH,
    targetYaw: Number.isFinite(Number(link.targetYaw)) ? normalizeYaw(link.targetYaw) : 0,
    label: link.label || '',
  };
}

/**
 * media 배열에서 360 항목만 골라 정규화한다: id·label·order 기본값, order 오름차순 정렬.
 * 원본 media 항목 순서가 order 의 기본값이다.
 */
export function normalizePanoramaItems(media) {
  const list = Array.isArray(media) ? media : [];
  const items = list
    .filter((item) => item && item.type === PANORAMA_MEDIA_TYPE && typeof item.src === 'string' && item.src)
    .map((item, index) => ({
      id: item.id || `pano-${index + 1}`,
      src: item.src,
      label: item.label || `지점 ${index + 1}`,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
      yawOffset: Number.isFinite(Number(item.yawOffset)) ? Number(item.yawOffset) : 0,
      links: Array.isArray(item.links) ? item.links : undefined,
      linksExplicit: item.linksExplicit === true ? true : undefined,
      stitched: item.stitched || undefined, // 'browser' = .insp 를 브라우저에서 자동 변환한 파노라마
    }));
  return items.sort((a, b) => a.order - b.order);
}

/** 정렬된 지점 배열에서 index 번째의 순서 기반 자동 링크 */
export function autoLinksAt(items, index) {
  const links = [];
  const next = items[index + 1];
  const prev = items[index - 1];
  if (next) {
    links.push({ to: next.id, yaw: 0, pitch: LINK_PITCH, targetYaw: 0, label: next.label || '다음 지점' });
  }
  if (prev) {
    // 뒤로 갈 때는 왔던 방향(이전 지점의 뒤쪽)을 보게 해 로드뷰처럼 자연스럽게 이어진다.
    links.push({ to: prev.id, yaw: 180, pitch: LINK_PITCH, targetYaw: 180, label: prev.label || '이전 지점' });
  }
  return links;
}

/** index 번째 지점에 실제로 적용되는 링크 — 직접 편집했으면 그것, 아니면 자동. 없는 지점을 가리키는 링크는 뺀다. */
export function effectiveLinks(items, index) {
  const pano = items[index];
  if (!pano) return [];
  if (!isExplicit(pano)) return autoLinksAt(items, index);
  const ids = new Set(items.map((item) => item.id));
  return (pano.links ?? [])
    .filter((link) => link && ids.has(link.to) && link.to !== pano.id)
    .map((link) => {
      const normalized = normalizeLink(link);
      if (!normalized.label) normalized.label = items.find((item) => item.id === link.to)?.label || '';
      return normalized;
    });
}

/**
 * 모든 지점에 적용 링크를 채워 돌려준다(뷰어용). 입력은 order 로 다시 정렬한다.
 */
export function withAutoLinks(panoramas) {
  const sorted = [...(panoramas ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return sorted.map((pano, index) => ({ ...pano, links: effectiveLinks(sorted, index) }));
}

/** media 배열 → 뷰어가 쓰는 투어 지점 목록 (링크 포함). 360 항목이 없으면 빈 배열. */
export function buildTourPanoramas(media) {
  return withAutoLinks(normalizePanoramaItems(media));
}

/** 새 360 media 항목 생성 (등록·수정 폼에서 사용). */
export function panoramaMediaItem({ id, src, label, order, yawOffset = 0, links, linksExplicit, stitched }) {
  const item = {
    type: PANORAMA_MEDIA_TYPE,
    id,
    src,
    label: label && String(label).trim() ? String(label).trim() : `지점 ${order}`,
    order,
    yawOffset,
  };
  if (linksExplicit === true) {
    item.linksExplicit = true;
    item.links = Array.isArray(links) ? links.map(normalizeLink) : [];
  } else if (Array.isArray(links) && links.length > 0) {
    item.links = links.map(normalizeLink);
  }
  if (stitched) item.stitched = stitched;
  return item;
}

// ───────────────────────── 링크 편집 (갈래 편집기) ─────────────────────────
// items 는 폼이 들고 있는 지점 배열(배열 순서 = 이동 순서). 모든 함수는 새 배열을 돌려준다.

function explicitFrom(items, index) {
  return effectiveLinks(items, index).map((link) => ({ ...link }));
}

function yawDistance(a, b) {
  const d = Math.abs(normalizeYaw(a) - normalizeYaw(b));
  return Math.min(d, 360 - d);
}

// 같은 방향에 화살표가 이미 있으면 겹쳐서 하나만 눌린다 — 새 화살표를 아래로 12° 씩 비켜 놓는다.
const OVERLAP_YAW = 15;
const OVERLAP_PITCH = 8;
const OVERLAP_STEP = 12;
export function avoidOverlap(link, existing) {
  const placed = { ...link };
  for (let i = 0; i < 4; i += 1) {
    const clash = existing.some((other) => yawDistance(other.yaw, placed.yaw) < OVERLAP_YAW && Math.abs(other.pitch - placed.pitch) < OVERLAP_PITCH);
    if (!clash) break;
    placed.pitch = Math.max(-60, placed.pitch - OVERLAP_STEP);
  }
  return placed;
}

function replaceLinks(items, id, links) {
  return items.map((item) => (item.id === id ? { ...item, links, linksExplicit: true } : item));
}

/**
 * fromId 지점에 링크 추가. 같은 대상으로 가는 기존 링크는 교체한다.
 * 처음 편집하는 지점은 현재 자동 링크를 직접 링크로 굳힌 뒤 덧붙인다(기존 앞·뒤 화살표가 사라지지 않게).
 * reciprocal: 대상 지점에도 돌아오는 화살표를 넣는다 — 위치는 도착 시선의 반대편, 돌아왔을 때 시선은 출발 화살표의 반대편.
 */
export function addLink(items, fromId, link, { reciprocal = false } = {}) {
  const fromIndex = items.findIndex((item) => item.id === fromId);
  const toIndex = items.findIndex((item) => item.id === link?.to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
  const kept = explicitFrom(items, fromIndex).filter((l) => l.to !== link.to);
  const forward = avoidOverlap(normalizeLink({ ...link, label: link.label || items[toIndex].label || '' }), kept);
  let next = replaceLinks(items, fromId, [...kept, forward]);
  if (reciprocal) {
    const back = normalizeLink({
      to: fromId,
      yaw: forward.targetYaw + 180,
      pitch: forward.pitch,
      targetYaw: forward.yaw + 180,
      label: items[fromIndex].label || '',
    });
    const existing = explicitFrom(next, toIndex);
    if (!existing.some((l) => l.to === fromId)) {
      next = replaceLinks(next, link.to, [...existing, avoidOverlap(back, existing)]);
    }
  }
  return next;
}

/** fromId 지점의 linkIndex 번째(적용 링크 기준) 화살표 삭제. 자동 링크였다면 직접 링크로 굳힌 뒤 뺀다. */
export function removeLink(items, fromId, linkIndex) {
  const fromIndex = items.findIndex((item) => item.id === fromId);
  if (fromIndex < 0) return items;
  const links = explicitFrom(items, fromIndex);
  if (linkIndex < 0 || linkIndex >= links.length) return items;
  links.splice(linkIndex, 1);
  return replaceLinks(items, fromId, links);
}

/** 직접 편집을 버리고 순서 기반 자동 연결로 되돌린다. */
export function resetLinks(items, id) {
  return items.map((item) => {
    if (item.id !== id) return item;
    const { links: _links, linksExplicit: _explicit, ...rest } = item;
    return rest;
  });
}

/** 지점을 지운 뒤 호출 — 사라진 지점을 가리키는 링크를 정리한다. */
export function pruneLinks(items) {
  const ids = new Set(items.map((item) => item.id));
  return items.map((item) => {
    if (!Array.isArray(item.links)) return item;
    const links = item.links.filter((link) => link && ids.has(link.to) && link.to !== item.id);
    return links.length === item.links.length ? item : { ...item, links };
  });
}

export function hasExplicitLinks(item) {
  return isExplicit(item);
}

/**
 * 두 좌표 사이의 방위각(도, 북쪽 0, 시계 방향). 로드뷰가 집을 바라보도록 pan 을 맞출 때 사용.
 * from/to: { lat, lng }
 */
export function bearing(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeYaw(toDeg(Math.atan2(y, x)));
}
