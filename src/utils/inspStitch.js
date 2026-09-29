/*
 * inspStitch.js — Insta360 .insp(어안 2장, 미합성) → 정방형(equirectangular) 파노라마. 브라우저 WebGL2.
 *
 * .insp 는 JPEG 컨테이너 안에 앞·뒤 렌즈의 원형 어안 이미지가 나란히 든 파일이다(예: ONE X2 6080×3040).
 * 등거리 어안 모델(r = R·θ/θmax)로 두 원을 구면에 되쏘아 정방형으로 펼치고, 두 렌즈가 겹치는 띠(약 10°)는
 * 부드럽게 섞는다. 광학 흐름 시차 보정은 없어 가까운 물체가 이음새에서 어긋날 수 있다(설계 §6.1).
 *
 * 프리셋은 2026-09-29 ONE X2 실제 샘플 20장 중 3장으로 보정했다: 원은 각 반쪽에 내접(중심 W/4·3W/4, 반지름 H/2),
 * 화각 200°, 왼쪽 원 = 앞 렌즈(회전 +90°), 오른쪽 원 = 뒤 렌즈(회전 +270°), 미러 없음.
 * 다른 Insta360 모델은 같은 값으로 시도하되 calibrated:false 를 돌려줘 화면에 "미보정" 안내를 붙인다.
 */

export const INSP_TARGET_WIDTH = 4096;
export const INSP_BLEND_DEGREES = 8;

const ONE_X2 = {
  key: 'insta360-one-x2',
  label: 'Insta360 ONE X2',
  fov: 200,
  frontRotation: 90,
  backRotation: 270,
  frontMirror: false,
  backMirror: false,
  frontCircle: 'left',
  calibrated: true,
};

export const INSP_PRESETS = {
  'insta360-one-x2': ONE_X2,
  default: { ...ONE_X2, key: 'insta360-generic', label: 'Insta360 (미보정)', calibrated: false },
};

export function isInspFile(file) {
  return /\.insp$/i.test(String(file?.name ?? ''));
}

/** 카메라 모델명 → 프리셋. 모델을 모르면 default(미보정). */
export function presetFor(model) {
  const key = String(model ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (key.includes('onex2')) return INSP_PRESETS['insta360-one-x2'];
  return INSP_PRESETS.default;
}

/**
 * JPEG EXIF 의 Make/Model 만 읽는다 (APP1 → TIFF IFD0, 태그 0x010F / 0x0110). 없으면 빈 문자열.
 * 첫 256KB 만 본다 — Insta360 은 파일 앞머리에 EXIF 를 둔다.
 */
export function readJpegMakeModel(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, 256 * 1024));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const empty = { make: '', model: '' };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return empty;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return empty; // 이미지 데이터 시작 — EXIF 없음
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && length >= 8) {
      const start = offset + 4;
      const isExif = bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66; // "Exif"
      if (isExif) return parseTiff(view, bytes, start + 6, Math.min(bytes.length, start + length - 2));
    }
    offset += 2 + length;
  }
  return empty;
}

function parseTiff(view, bytes, tiffStart, end) {
  const out = { make: '', model: '' };
  if (tiffStart + 8 > end) return out;
  const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const u16 = (o) => view.getUint16(o, little);
  const u32 = (o) => view.getUint32(o, little);
  if (u16(tiffStart + 2) !== 42) return out;
  const ifd = tiffStart + u32(tiffStart + 4);
  if (ifd + 2 > end) return out;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    const tag = u16(entry);
    if (tag !== 0x010f && tag !== 0x0110) continue;
    const type = u16(entry + 2);
    const n = u32(entry + 4);
    if (type !== 2) continue; // ASCII
    const valueOffset = n <= 4 ? entry + 8 : tiffStart + u32(entry + 8);
    if (valueOffset + n > end) continue;
    let text = '';
    for (let k = 0; k < n; k += 1) {
      const c = bytes[valueOffset + k];
      if (c === 0) break;
      text += String.fromCharCode(c);
    }
    if (tag === 0x010f) out.make = text.trim();
    else out.model = text.trim();
  }
  return out;
}

export async function readFileMakeModel(file) {
  const head = await file.slice(0, 256 * 1024).arrayBuffer();
  return readJpegMakeModel(head);
}

// ───────────────────────── WebGL ─────────────────────────

const VERT = `#version 300 es
precision highp float;
const vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
const float PI = 3.141592653589793;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uOutSize;
uniform vec2 uFrontCenter;
uniform vec2 uBackCenter;
uniform float uRadius;
uniform float uThetaMax;
uniform float uBlend;
uniform float uFrontRot;
uniform float uBackRot;
uniform float uFrontMirror;
uniform float uBackMirror;
out vec4 outColor;

vec2 lensPixel(vec3 d, vec2 center, float rot, float mirror) {
  float theta = acos(clamp(d.z, -1.0, 1.0));
  float r = uRadius * theta / uThetaMax;
  float psi = atan(d.y, d.x);
  if (mirror > 0.5) psi = PI - psi;
  psi += rot;
  return vec2(center.x + r * cos(psi), center.y - r * sin(psi));
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / uOutSize.x, 1.0 - gl_FragCoord.y / uOutSize.y);
  float lam = (uv.x - 0.5) * 2.0 * PI;
  float phi = (0.5 - uv.y) * PI;
  vec3 d = vec3(cos(phi) * sin(lam), sin(phi), cos(phi) * cos(lam));
  vec3 dBack = vec3(-d.x, d.y, -d.z);
  float thetaF = acos(clamp(d.z, -1.0, 1.0));
  float thetaB = acos(clamp(dBack.z, -1.0, 1.0));
  float wF = 1.0 - smoothstep(uThetaMax - uBlend, uThetaMax, thetaF);
  float wB = 1.0 - smoothstep(uThetaMax - uBlend, uThetaMax, thetaB);
  vec4 cF = texture(uTex, lensPixel(d, uFrontCenter, uFrontRot, uFrontMirror) / uTexSize);
  vec4 cB = texture(uTex, lensPixel(dBack, uBackCenter, uBackRot, uBackMirror) / uTexSize);
  float sum = wF + wB;
  outColor = sum > 0.0 ? (cF * wF + cB * wB) / sum : vec4(0.0, 0.0, 0.0, 1.0);
  outColor.a = 1.0;
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WEBGL_SHADER: ${log}`);
  }
  return shader;
}

/**
 * 어안 2장 비트맵 → 정방형 캔버스. 반환 { canvas, width, height }.
 * bitmap: ImageBitmap (전체 .insp 이미지). preset: INSP_PRESETS 항목.
 */
export function stitchDualFisheyeToCanvas(bitmap, preset, { targetWidth = INSP_TARGET_WIDTH } = {}) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
  if (!gl) throw new Error('이 브라우저는 WebGL2 를 지원하지 않아 .insp 를 변환할 수 없습니다. Insta360 앱에서 내보낸 360 JPG 를 올려주세요.');

  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  if (bitmap.width > maxTex || bitmap.height > maxTex) {
    throw new Error(`GPU_TEXTURE_LIMIT:${maxTex}`);
  }
  const outW = Math.min(targetWidth, maxRb, maxTex);
  const outH = Math.round(outW / 2);
  canvas.width = outW;
  canvas.height = outH;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WEBGL_LINK: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const W = bitmap.width;
  const H = bitmap.height;
  const radius = H / 2;
  const left = [W / 4, H / 2];
  const right = [(3 * W) / 4, H / 2];
  const front = preset.frontCircle === 'right' ? right : left;
  const back = preset.frontCircle === 'right' ? left : right;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const thetaMax = toRad(preset.fov / 2);
  const blend = Math.min(toRad(INSP_BLEND_DEGREES), Math.max(0.01, thetaMax - Math.PI / 2));

  const u = (name) => gl.getUniformLocation(program, name);
  gl.uniform1i(u('uTex'), 0);
  gl.uniform2f(u('uTexSize'), W, H);
  gl.uniform2f(u('uOutSize'), outW, outH);
  gl.uniform2f(u('uFrontCenter'), front[0], front[1]);
  gl.uniform2f(u('uBackCenter'), back[0], back[1]);
  gl.uniform1f(u('uRadius'), radius);
  gl.uniform1f(u('uThetaMax'), thetaMax);
  gl.uniform1f(u('uBlend'), blend);
  gl.uniform1f(u('uFrontRot'), toRad(preset.frontRotation));
  gl.uniform1f(u('uBackRot'), toRad(preset.backRotation));
  gl.uniform1f(u('uFrontMirror'), preset.frontMirror ? 1 : 0);
  gl.uniform1f(u('uBackMirror'), preset.backMirror ? 1 : 0);

  gl.viewport(0, 0, outW, outH);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();

  gl.deleteTexture(tex);
  gl.deleteProgram(program);
  return { canvas, width: outW, height: outH, gl };
}

async function decodeForGpu(file) {
  const bitmap = await createImageBitmap(file);
  // GPU 텍스처 한도(모바일 4096 등)를 넘는 원본은 한도에 맞춰 줄여 디코드한다
  const probe = document.createElement('canvas').getContext('webgl2');
  const maxTex = probe ? probe.getParameter(probe.MAX_TEXTURE_SIZE) : 4096;
  if (bitmap.width <= maxTex) return bitmap;
  const scaled = await createImageBitmap(file, { resizeWidth: maxTex, resizeHeight: Math.round((bitmap.height * maxTex) / bitmap.width), resizeQuality: 'high' });
  bitmap.close?.();
  return scaled;
}

/**
 * .insp 파일 → 정방형 JPEG Blob.
 * 반환 { blob, width, height, preset, model, calibrated, originalWidth, originalHeight }.
 */
export async function stitchInsp(file, { targetWidth = INSP_TARGET_WIDTH, quality = 0.85 } = {}) {
  const { make, model } = await readFileMakeModel(file);
  const preset = presetFor(model || make);
  const bitmap = await decodeForGpu(file);
  if (Math.abs(bitmap.width / bitmap.height - 2) > 0.05) {
    bitmap.close?.();
    throw new Error(`어안 2장 형식이 아닙니다 (${bitmap.width}×${bitmap.height}). Insta360 원본(.insp)만 자동 변환할 수 있습니다.`);
  }
  let result;
  try {
    result = stitchDualFisheyeToCanvas(bitmap, preset, { targetWidth });
  } finally {
    bitmap.close?.();
  }
  const blob = await new Promise((resolve, reject) => {
    result.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 인코딩에 실패했습니다.'))), 'image/jpeg', quality);
  });
  // WebGL 컨텍스트 반납 (탭당 컨텍스트 수 제한 회피)
  result.gl.getExtension('WEBGL_lose_context')?.loseContext();
  result.canvas.width = 0;
  result.canvas.height = 0;
  return {
    blob,
    width: result.width,
    height: result.height,
    preset: preset.key,
    model: model || make || '',
    calibrated: preset.calibrated,
    originalWidth: bitmap.width,
    originalHeight: bitmap.height,
  };
}
