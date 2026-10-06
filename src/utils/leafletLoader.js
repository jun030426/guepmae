/*
 * Leaflet + OpenStreetMap — 무료 지도 엔진 (키·결제 불필요).
 * markercluster 플러그인까지 여기서 한 번에 로드해 L 에 등록한다.
 */

import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';

export function createOsmTileLayer() {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  });
}

// 매물 위치 단일 핀 — 네이비 원형 (디자인 토큰 --text-strong 계열). 34×44, 끝점 (17, 42). 카카오 지도도 같은 핀을 쓴다.
const SPOT_PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">' +
  '<path d="M17 1C8.7 1 2 7.7 2 16c0 10.6 12.2 24.3 14.1 26.4a1.2 1.2 0 0 0 1.8 0C19.8 40.3 32 26.6 32 16 32 7.7 25.3 1 17 1z" fill="#1a2233" stroke="#ffffff" stroke-width="2"/>' +
  '<circle cx="17" cy="16" r="5.5" fill="#ffffff"/>' +
  '</svg>';
export const SPOT_PIN_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SPOT_PIN_SVG)}`;

export function createSpotIcon() {
  return L.icon({
    iconUrl: SPOT_PIN_URL,
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    popupAnchor: [0, -40],
  });
}

export default L;
