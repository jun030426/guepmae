/*
 * tokens.js — JSX/Recharts/SVG에서 쓰는 hex 미러
 *
 * ⚠️ CSS(tokens.css)가 단일 진실원(truth).
 *    이 파일은 JSX prop으로 var() 못 쓰는 환경 — Recharts stroke/fill,
 *    <svg fill>, data URL 생성, MarkerClusterer 아이콘 등 — 을 위해
 *    hex 값을 미러링하는 상수 모음.
 *
 * 토큰 값을 바꿀 땐 반드시 tokens.css의 :root 정의와 함께 수정.
 * 토큰명은 CSS 변수명을 SCREAMING_SNAKE_CASE로 그대로 변환
 *   (--primary       → PRIMARY,
 *    --marker-hot    → MARKER_HOT,
 *    --text-strong   → TEXT_STRONG, …)
 */

// === Brand — Primary (테라코타) ===
export const PRIMARY = '#a95c48';
export const PRIMARY_HOVER = '#97503d';
export const PRIMARY_ACTIVE = '#823f30';
export const PRIMARY_STRONG = '#8a4634';
export const PRIMARY_SUBTLE = '#faf1ed';

// === Surface ===
export const BG = '#faf7f2';
export const SURFACE = '#ffffff';
export const SURFACE_WARM = '#ebe5da';
export const BORDER = '#e5dfd5';
export const BORDER_STRONG = '#2b2622';

// === Text (따뜻한 차콜 계열) ===
export const TEXT_STRONG = '#2b2622';
export const TEXT_STRONG_SOFT = '#4a433d'; // fill on L1 — 밝은 면 위 차콜 채움
export const TEXT_SECONDARY = '#6e6864';
export const TEXT_MUTED = '#9a9087';

// === Status ===
export const PRICE_UP = '#e0453e';
export const PRICE_DOWN = '#2563eb';
export const SUCCESS = '#2e9e6b';
export const WARNING = '#e0a82e';
export const DANGER = '#d14343';

// === Map Marker — 톤다운 흙빛 신호등 ===
export const MARKER_HOT = '#a23b2e';
export const MARKER_WARM = '#b0623e';
export const MARKER_MILD = '#c19a5b';
