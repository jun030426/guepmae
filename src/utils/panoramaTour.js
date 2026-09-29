/*
 * panoramaTour.js — 360 투어 순수 로직. 브라우저 API 를 쓰지 않아 node:test 로 검증한다.
 *
 * 데이터 모델 (properties.media 의 360 항목):
 *   { type: '360', id, src, label, order, yawOffset, links?: [{ to, yaw, pitch, targetYaw, label }] }
 *
 * yaw 규약: 0 = 이미지 중앙 = 촬영 시 카메라 앞면 방향. 시계 방향으로 증가(도).
 * 자동 링크(links 가 없을 때): 찍은 순서(order)로 앞(다음 지점, yaw 0)·뒤(이전 지점, yaw 180)를 잇는다.
 * 설계: docs/superpowers/specs/2026-09-29-360-tour-roadview-design.md §4.3
 */

export const PANORAMA_MEDIA_TYPE = '360';
export const PANORAMA_MAX_COUNT = 12;
export const PANORAMA_MIN_WIDTH = 2048;

const LINK_PITCH = -10;

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
      stitched: item.stitched || undefined, // 'browser' = .insp 를 브라우저에서 자동 변환한 파노라마
    }));
  return items.sort((a, b) => a.order - b.order);
}

/**
 * links 가 없는 지점에 순서 기반 자동 링크를 채운다. 명시된 links 는 그대로 둔다.
 * 입력은 normalizePanoramaItems 결과(정렬됨)를 기대하지만, 안전하게 다시 정렬한다.
 */
export function withAutoLinks(panoramas) {
  const sorted = [...(panoramas ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return sorted.map((pano, index) => {
    if (Array.isArray(pano.links) && pano.links.length > 0) {
      return { ...pano, links: pano.links.map(normalizeLink) };
    }
    const links = [];
    const next = sorted[index + 1];
    const prev = sorted[index - 1];
    if (next) {
      links.push({ to: next.id, yaw: 0, pitch: LINK_PITCH, targetYaw: 0, label: next.label || '다음 지점' });
    }
    if (prev) {
      // 뒤로 갈 때는 왔던 방향(이전 지점의 뒤쪽)을 보게 해 로드뷰처럼 자연스럽게 이어진다.
      links.push({ to: prev.id, yaw: 180, pitch: LINK_PITCH, targetYaw: 180, label: prev.label || '이전 지점' });
    }
    return { ...pano, links };
  });
}

function normalizeLink(link) {
  return {
    to: link.to,
    yaw: normalizeYaw(link.yaw),
    pitch: Number.isFinite(Number(link.pitch)) ? Number(link.pitch) : LINK_PITCH,
    targetYaw: Number.isFinite(Number(link.targetYaw)) ? normalizeYaw(link.targetYaw) : 0,
    label: link.label || '',
  };
}

/** media 배열 → 뷰어가 쓰는 투어 지점 목록 (링크 포함). 360 항목이 없으면 빈 배열. */
export function buildTourPanoramas(media) {
  return withAutoLinks(normalizePanoramaItems(media));
}

/** 새 360 media 항목 생성 (등록·수정 폼에서 사용). */
export function panoramaMediaItem({ id, src, label, order, yawOffset = 0, links, stitched }) {
  const item = {
    type: PANORAMA_MEDIA_TYPE,
    id,
    src,
    label: label && String(label).trim() ? String(label).trim() : `지점 ${order}`,
    order,
    yawOffset,
  };
  if (Array.isArray(links) && links.length > 0) item.links = links;
  if (stitched) item.stitched = stitched;
  return item;
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
