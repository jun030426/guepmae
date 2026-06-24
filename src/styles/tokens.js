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

// === Brand — Primary (절약 초록 / Savings) ===
export const PRIMARY = '#1e8e5a';
export const PRIMARY_HOVER = '#157a4a';
export const PRIMARY_ACTIVE = '#0f5e39';
export const PRIMARY_STRONG = '#157a4a';
export const PRIMARY_SUBTLE = '#ecf6f0';

// === Savings green scale (할인 등급 농도) ===
export const SAVE_50 = '#ecf6f0';
export const SAVE_100 = '#d6ede0';
export const SAVE_600 = '#1e8e5a';
export const SAVE_700 = '#157a4a';
export const SAVE_800 = '#0f5e39';

// === Surface (쿨 톤) ===
export const BG = '#fbfcfe';
export const SURFACE = '#ffffff';
export const SURFACE_WARM = '#f5f7fa';
export const NAVY_DEEP = '#0e1a30';
export const BORDER = '#e4e8ef';
export const BORDER_STRONG = '#1a2233';

// === Text (쿨 잉크/슬레이트 계열) ===
export const TEXT_STRONG = '#1a2233';
export const TEXT_STRONG_SOFT = '#1f2a40'; // fill on L1 — 밝은 면 위 네이비 채움
export const TEXT_SECONDARY = '#4f5d75';
export const TEXT_MUTED = '#8a93a6';

// === Status (상승=빨강, 하락=파랑) ===
export const PRICE_UP = '#c9453b';
export const PRICE_DOWN = '#2e6be6';
export const SUCCESS = '#1e8e5a';
export const WARNING = '#e0a82e';
export const DANGER = '#c9453b';

// === Map Marker — 할인율 등급(초록 농도) ===
export const MARKER_HOT = '#0f5e39';
export const MARKER_WARM = '#157a4a';
export const MARKER_MILD = '#1e8e5a';
