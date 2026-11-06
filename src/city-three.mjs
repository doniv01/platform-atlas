/**
 * Immersive city renderer for Platform Atlas.
 *
 * Three.js (WebGL2) scene: luminous glass towers, flowing connections, district
 * islands, optional matte/architectural finishes, a dotted ground plane, bloom, a
 * cinematic intro, and an HTML label layer that uses Phosphor icons.
 *
 * createCity() returns the `gpuCity` interface app.mjs drives:
 *   ready, atlasToWorld, buildingHeight, worldToViewBox, hitPolygon,
 *   groundPolygon, panDeltaFromScreen, panForWorld, zoomAtScreen, fitView,
 *   setCamera, setAppearance, sync, capture, setIntroSpeed, playIntro,
 *   pause, setActive, dispose
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { iconSvg } from './icons.mjs';
import { normalizeAppearance } from './palette.mjs';

const WORLD = 0.36; // atlas unit (0..100) → world unit
const PAN = 0.05; // camera pan unit → world unit
const BASE_DISTANCE = 52;
const FOV = 34;
const MAX_NODES = 1000; // matches the generated viewer-pack cap in scripts/viewer-pack.mjs
const BG_HEX = 0x080e21;
const FOG_DENSITY = 0.007;

const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const smooth = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

// Visual variation is deterministic decoration, never an additional data metric.
// Every tier stays inside the original footprint and total source-derived height,
// so the existing hit hulls, labels and edge anchors remain valid.
export function towerProfile(id, height, footprint) {
  const variant = Math.min(2, Math.floor(hashString(id) * 3));
  const crownRatio = [0.09, 0.17, 0.25][variant];
  const crownWidth = [0.84, 0.66, 0.55][variant];
  const plinthHeight = Math.min(0.14, height * 0.07);
  const bodyHeight = height * (1 - crownRatio) - plinthHeight;
  return {
    variant, plinthHeight, bodyHeight,
    bodyWidth: footprint * 0.94,
    crownY: height * (1 - crownRatio),
    crownHeight: height * crownRatio,
    crownWidth: footprint * crownWidth,
    crownDepth: footprint * (variant === 2 ? 0.78 : crownWidth),
  };
}

export function sceneAppearance(value) {
  const name = normalizeAppearance(value);
  const matte = name === 'matte';
  const architectural = name === 'architectural';
  return Object.freeze({
    name,
    matte: matte ? 1 : 0,
    architectural: architectural ? 1 : 0,
    background: architectural ? 0x181d2e : matte ? 0x0a0a0c : BG_HEX,
    exposure: 1.08,
    bloomStrength: matte ? 0 : architectural ? 0.16 : 0.50,
    bloomRadius: architectural ? 0.25 : 0.45,
    bloomThreshold: architectural ? 0.96 : 0.80,
  });
}

/** Andrew monotone chain — returns hull points in order. */
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform vec3 uCamPos;
  vec3 applyFog(vec3 color, vec3 worldPos) {
    float d = distance(uCamPos, worldPos);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    return mix(color, uFog, clamp(f, 0.0, 1.0));
  }
`;

const BUILDING_VERT = /* glsl */ `
  attribute vec3 aState;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vColor;
  varying vec3 vState;
  varying float vLocalY;
  varying vec3 vLocalPos;
  void main() {
    // instanceMatrix is compose(translation, IDENTITY quaternion, scale): no
    // rotation and no shear, so the column lengths are this tower's world size.
    vec3 iScale = vec3(
      length(instanceMatrix[0].xyz),
      length(instanceMatrix[1].xyz),
      length(instanceMatrix[2].xyz)
    );
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    // The inverse transpose of a pure scale is 1/scale. The old
    // mat3(instanceMatrix) * normal tipped the horizontal bevel rings skyward,
    // which fed them through the roof test and lit a bright lip on every tower.
    vNormalW = normalize(mat3(modelMatrix) * (normal / iScale));
    vColor = instanceColor;
    vState = aState;
    vLocalY = position.y;
    vLocalPos = position;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BUILDING_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uLightDir;
  uniform vec3 uFillDir;
  uniform float uTime;
  uniform float uMatte;
  uniform float uSurface;
  uniform float uArchitectural;
  ${FOG_GLSL}
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vColor;
  varying vec3 vState;
  varying float vLocalY;
  varying vec3 vLocalPos;

  // Pixel-filtered facade detail, decorative rather than a runtime signal.
  float lightBand(float coordinate, float width) {
    float footprint = max(fwidth(coordinate), 0.0001);
    float d = abs(fract(coordinate) - 0.5);
    float band = 1.0 - smoothstep(width, width + footprint, d);
    return band * (1.0 - smoothstep(0.24, 0.55, footprint));
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uCamPos - vPosW);
    vec3 L = normalize(uLightDir);
    vec3 F = normalize(uFillDir);
    float emphasis = vState.x;
    float dim = vState.y;
    float ndl = max(dot(N, L), 0.0);
    float ndf = max(dot(N, F), 0.0);
    float hemi = 0.65 + 0.35 * N.y;
    float top = smoothstep(0.88, 0.98, N.y);
    float side = 1.0 - smoothstep(0.35, 0.90, N.y);
    if (uArchitectural < 0.5) {
      // Original single-volume city. Luminous retains the glass facade; Matte
      // uses broad clean faces. Both keep the selected cap and circular halo.
      float capMask = smoothstep(0.930, 0.985, vLocalY);
      vec3 tint = mix(vColor, mix(vec3(0.014, 0.024, 0.06), vec3(0.05, 0.06, 0.10), uMatte), mix(0.22, 0.42, uMatte));
      vec3 col = tint * (mix(0.16, 0.32, uMatte) + mix(0.57, 0.68, uMatte) * ndl + mix(0.23, 0.14, uMatte) * ndf) * mix(hemi, 0.55 + 0.45 * N.y, uMatte);
      col *= mix(0.55 + 0.68 * vLocalY, 0.78 + 0.52 * vLocalY, uMatte);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
      col += vColor * fres * (mix(0.25, 0.10, uMatte) + 0.60 * emphasis);
      float specular = pow(max(dot(N, normalize(L + V)), 0.0), 48.0);
      col += mix(vColor, vec3(0.70, 0.85, 1.0), 0.55) * specular * 0.65 * (1.0 - uMatte);
      float faceU = mix(vLocalPos.x, vLocalPos.z, step(abs(N.z), abs(N.x))) + 0.5;
      float floors = lightBand(vPosW.y / 0.48, 0.035);
      float mullions = lightBand(faceU * 4.0, 0.022);
      float corner = smoothstep(0.435, 0.485, abs(faceU - 0.5));
      col += vColor * (floors * 0.36 + mullions * 0.11 + corner * 0.24) * side * (0.85 + 0.65 * emphasis) * (1.0 - uMatte);
      float roofEdge = smoothstep(0.34, 0.48, max(abs(vLocalPos.x), abs(vLocalPos.z)));
      col += vColor * capMask * (0.24 + roofEdge * 0.75) * (1.0 - uMatte);
      float pulse = 0.5 + 0.5 * sin(uTime * 3.4);
      col += mix(vColor, vec3(1.0), 0.12) * capMask * emphasis * (0.85 + 0.15 * pulse);
      col += vColor * emphasis * 0.18;
      float contact = 1.0 - 0.24 * exp(-vPosW.y / 0.18) - 0.10 * exp(-vPosW.y / 0.80);
      col *= max(contact, 0.72);
      col = mix(col, vec3(0.025, 0.042, 0.085), dim * 0.78);
      gl_FragColor = vec4(applyFog(col, vPosW), 1.0);
      return;
    }
    float isPlinth = step(1.5, uSurface);
    float luminance = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 pigment = mix(vColor, vec3(luminance), mix(0.04, 0.16, uMatte));
    vec3 tint = mix(pigment, vec3(0.16, 0.18, 0.20), isPlinth * 0.78);
    // Broad neutral key and softer opposing fill separate the faces. Matte
    // removes the glass-like rim without losing the source's district pigment.
    vec3 col = tint * (0.32 + 0.63 * ndl + 0.18 * ndf) * hemi;
    col *= mix(0.83 + 0.17 * vLocalY, 1.0, isPlinth);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    col += pigment * fres * mix(0.22, 0.025, uMatte) * (1.0 - isPlinth);
    float specular = pow(max(dot(N, normalize(L + V)), 0.0), mix(52.0, 14.0, uMatte));
    col += vec3(0.93, 0.94, 0.96) * specular * mix(0.38, 0.045, uMatte);

    float faceU = mix(vLocalPos.x, vLocalPos.z, step(abs(N.z), abs(N.x))) + 0.5;
    float floors = lightBand(vPosW.y / 0.56, 0.025);
    float mullions = lightBand(faceU * 3.0, 0.016);
    float corner = smoothstep(0.435, 0.485, abs(faceU - 0.5));
    // Recessed joints replace emissive window grids. They remain quiet close up
    // and their pixel filter suppresses shimmer at the overview scale.
    float facade = (floors * 0.15 + mullions * 0.08) * side * (1.0 - isPlinth);
    col *= 1.0 - facade;
    col += pigment * corner * side * 0.035;
    float roofInset = 1.0 - smoothstep(0.28, 0.33, max(abs(vLocalPos.x), abs(vLocalPos.z)));
    col *= 1.0 - top * roofInset * 0.12 * (1.0 - isPlinth);
    col += pigment * top * 0.08;
    col += pigment * emphasis * mix(0.13, 0.08, uMatte);
    float contact = 1.0 - 0.24 * exp(-vPosW.y / 0.18) - 0.10 * exp(-vPosW.y / 0.80);
    col *= max(contact, 0.72);
    col = mix(col, vec3(0.035, 0.044, 0.057), dim * 0.70);
    col = applyFog(col, vPosW);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const PAD_VERT = /* glsl */ `
  attribute vec3 aState;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vState;
  varying vec3 vPosW;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vUv = uv;
    vColor = instanceColor;
    vState = aState;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SHADOW_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vState;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = max(abs(p.x), abs(p.y));
    float shadow = (1.0 - smoothstep(0.32, 0.90, r)) * 0.60 * vState.z;
    gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
  }
`;

const GLOW_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uMatte;
  uniform float uArchitectural;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vState;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float halo = (1.0 - smoothstep(0.0, 1.0, r));
    float emphasis = vState.x;
    float square = max(abs(p.x), abs(p.y));
    float plinth = (1.0 - smoothstep(0.0, 0.035, abs(square - 0.54))) * 0.06;
    float a = (plinth + halo * 0.035) * emphasis * mix(1.0, 0.3, uMatte);
    if (uArchitectural < 0.5) {
      float ring = smoothstep(0.30, 0.52, r) * (1.0 - smoothstep(0.52, 1.0, r));
      float pulse = 0.5 + 0.5 * sin(uTime * 2.6);
      a = ring * (mix(0.065, 0.018, uMatte) + 0.45 * emphasis)
        + halo * (0.045 * (1.0 - uMatte) + emphasis * (0.14 + 0.08 * pulse));
    }
    a *= (1.0 - vState.y * 0.85) * vState.z;
    gl_FragColor = vec4(vColor * mix(1.2 + emphasis, 1.0, uArchitectural), a);
  }
`;

const EDGE_VERT = /* glsl */ `
  uniform float uArchitectural;
  attribute vec4 aState;
  attribute float aStyle;
  varying float vT;
  varying vec3 vColor;
  varying vec4 vState;
  varying vec3 vN;
  varying vec3 vPosW;
  varying float vStyle;
  void main() {
    vStyle = aStyle;
    vec3 p = position + normal * (0.026 * (1.0 - uArchitectural) + mix(0.04, 0.010, uArchitectural) * aState.x + mix(0.03, 0.008, uArchitectural) * aState.z);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vPosW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vT = uv.x;
    vColor = color;
    vState = aState;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const EDGE_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uDraw;
  uniform float uMatte;
  uniform float uArchitectural;
  ${FOG_GLSL}
  varying float vT;
  varying vec3 vColor;
  varying vec4 vState;
  varying vec3 vN;
  varying vec3 vPosW;
  varying float vStyle;
  void main() {
    if (vState.w > 0.5 || vT > uDraw) discard;
    // Relationship class is carried by the line pattern, not by a second color palette.
    // Relationship class is carried by the line pattern, so the pattern is a
    // DATA channel and must not scintillate. Written branch-free on purpose:
    // fwidth() is undefined in non-uniform control flow and vStyle is a varying.
    float dashed = step(0.5, vStyle) * step(vStyle, 1.5);   // response
    float dotted = step(1.5, vStyle) * step(vStyle, 2.5);   // hook / event
    float patterned = min(dashed + dotted, 1.0);
    // Solid lines fall out as freq = 1, duty = 1, which integrates to exactly 1.
    float patFreq = 15.0 * dashed + 26.0 * dotted + (1.0 - patterned);
    float patDuty = 0.58 * dashed + 0.40 * dotted + (1.0 - patterned);
    float px = vT * patFreq;
    // Derivative of the UNWRAPPED coordinate: fwidth of a fract() spikes to ~1
    // on the wrap line and paints a bright seam once per period.
    float pw = max(fwidth(px), 1e-4);
    float p0 = px - 0.5 * pw;
    float p1 = px + 0.5 * pw;
    // Exact box integral of a duty-cycle pulse train over the pixel footprint.
    float cov = (min(fract(p1), patDuty) - min(fract(p0), patDuty)
                 + (floor(p1) - floor(p0)) * patDuty) / pw;
    // Below ~2.5 device px per cycle the pattern carries no information: hold it
    // at its own duty cycle, which is its mean, so the fade is mean-preserving
    // and a short pipe fades to a fainter solid rather than crawling.
    float pattern = mix(patDuty, clamp(cov, 0.0, 1.0), smoothstep(1.2, 2.5, patDuty / pw));
    vec3 N = normalize(vN);
    vec3 V = normalize(uCamPos - vPosW);
    float roundness = 0.55 + 0.45 * max(dot(N, V), 0.0);
    float emphasis = vState.x;
    float current = vState.z;
    float speed = 0.16 + 0.5 * current + 0.14 * emphasis;
    float f1 = fract(vT * 2.0 - uTime * speed);
    float f2 = fract(vT * 2.0 - uTime * speed + 0.5);
    float comet = pow(1.0 - f1, 8.0) + pow(1.0 - f2, 8.0) * 0.55;
    // tip of the drawing edge glows during the intro
    float tip = (1.0 - smoothstep(0.0, 0.12, uDraw - vT)) * step(uDraw, 0.999);
    float focused = max(emphasis, current);
    vec3 pulseColor = mix(vColor, vec3(1.0), 0.20);
    vec3 muted = mix(vColor, vec3(0.29, 0.34, 0.40), 0.58);
    vec3 col = mix(muted, vColor, focused) * (0.64 + 0.40 * focused) * roundness;
    // Only the inspected path moves; the overview is a legible static network.
    col += pulseColor * comet * focused * mix(0.24, 0.055, uMatte);
    col += vColor * tip * 0.55;
    col = applyFog(col, vPosW);
    float alpha = (0.25 + 0.56 * focused) * (1.0 - 0.82 * vState.y) * pattern;
    if (uArchitectural < 0.5) {
      vec3 richPulse = vStyle > 2.5 ? vec3(0.98, 0.44, 0.52) : mix(vColor, vec3(1.0), 0.35);
      col = vColor * (0.92 + 0.8 * emphasis) * roundness;
      col += richPulse * comet * (0.5 + 1.7 * emphasis + 1.3 * current) * mix(1.0, 0.35, uMatte);
      col += vColor * tip * 2.0;
      col = applyFog(col, vPosW);
      alpha = (0.32 + 0.55 * emphasis + 0.08 * current) * (1.0 - 0.8 * vState.y) * pattern;
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

const DISTRICT_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPosW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const DISTRICT_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec2 uSize;
  uniform float uRadius;
  uniform float uActive;
  uniform float uReveal;
  uniform float uArchitectural;
  uniform float uMatte;
  ${FOG_GLSL}
  varying vec2 vUv;
  varying vec3 vPosW;
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = sdRoundBox(p, uSize * 0.5, uRadius);
    float inside = 1.0 - smoothstep(-0.04, 0.04, d);
    float border = 1.0 - smoothstep(0.013, 0.013 + fwidth(d), abs(d + 0.05));
    float a = inside * (0.045 + 0.025 * uActive) + border * (0.21 + 0.23 * uActive);
    vec3 plotColor = mix(uColor, vec3(0.20, 0.25, 0.30), 0.45);
    vec3 col = applyFog(plotColor * (0.85 + 0.20 * uActive), vPosW);
    if (uArchitectural < 0.5) {
      float edge = 1.0 - smoothstep(0.0, 1.0, -d);
      float outer = 1.0 - smoothstep(0.025, 0.025 + fwidth(d), abs(d + 0.07));
      float inner = 1.0 - smoothstep(0.02, 0.02 + fwidth(d), abs(d + 0.28));
      a = inside * (0.038 + 0.04 * uActive) + inside * edge * (0.10 + 0.10 * uActive)
        + outer * (0.34 + 0.32 * uActive) + inner * 0.07;
      a *= mix(1.0, 0.55, uMatte);
      col = applyFog(uColor * mix(1.25 + 0.45 * uActive, 1.0, uMatte), vPosW);
    }
    gl_FragColor = vec4(col, a * uReveal);
  }
`;

const GROUND_VERT = /* glsl */ `
  varying vec3 vPosW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GROUND_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uBg;
  uniform float uReveal;
  uniform float uTime;
  ${FOG_GLSL}
  varying vec3 vPosW;
  void main() {
    vec2 g = vPosW.xz;
    float radius = length(g);
    // fine dotted grid every 0.8 world units, kept quiet
    vec2 cell = fract(g / 0.8) - 0.5;
    float dist = length(cell);
    float gridDot = 1.0 - smoothstep(0.035, 0.075, dist);
    // faint major lines every 4.8 units frame the field
    vec2 major = abs(fract(g / 4.8 + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.006, min(major.x, major.y));
    float fade = 1.0 - smoothstep(10.0, 32.0, radius);
    float reveal = smoothstep(0.0, 1.0, uReveal * 1.35 - radius / 42.0);
    vec3 col = uBg;
    col += vec3(0.035, 0.043, 0.055) * gridDot * fade * reveal;
    col += vec3(0.025, 0.031, 0.039) * line * fade * reveal * 0.38;
    float cyanPool = exp(-dot(g - vec2(10.0, -8.0), g - vec2(10.0, -8.0)) / 210.0);
    float violetPool = exp(-dot(g - vec2(-12.0, 5.0), g - vec2(-12.0, 5.0)) / 180.0);
    col += (vec3(0.012, 0.026, 0.048) * cyanPool + vec3(0.025, 0.016, 0.043) * violetPool) * reveal;
    col = applyFog(col, vPosW);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const RING_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uStrength;
  uniform float uMatte;
  uniform float uArchitectural;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float square = max(abs(p.x), abs(p.y));
    float outline = 1.0 - smoothstep(0.012, 0.012 + fwidth(square), abs(square - 0.62));
    // Four architectural corner brackets, not a second animated radar halo.
    float corners = smoothstep(0.33, 0.39, min(abs(p.x), abs(p.y)));
    float a = outline * corners * uStrength * mix(0.70, 0.58, uMatte);
    if (uArchitectural < 0.5) {
      float r = length(p);
      float pulse = fract(uTime * 0.55);
      float ring1 = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.55));
      float ring2 = (1.0 - smoothstep(0.0, 0.08, abs(r - (0.55 + pulse * 0.42)))) * (1.0 - pulse);
      gl_FragColor = vec4(uColor * 1.6, (ring1 * 0.9 + ring2 * 0.7) * uStrength);
      return;
    }
    gl_FragColor = vec4(mix(uColor, vec3(0.82), 0.22), a);
  }
`;

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export async function createCity({ canvas, viewport, svg, labelLayer, onHover } = {}) {
  if (!canvas || !viewport || !svg || !labelLayer) throw new Error('createCity needs canvas, viewport, svg, and labelLayer');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is required for the immersive city');
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(BG_HEX, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_HEX);
  // Near 2.0, not 0.5: the closest the camera can get is BASE_DISTANCE / maxZoom
  // = 13 world units, so this cannot clip, and it is a 4x depth-precision win.
  // At zoom 0.3 the old near plane left the ground stack inside one depth quantum.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 2.0, 400);
  const target = new THREE.Vector3();
  const size = { w: 1, h: 1 };
  const fogColor = new THREE.Color(BG_HEX);
  const lightDir = new THREE.Vector3(-0.45, 1.0, 0.65).normalize();
  // Fill from behind-left so the two faces the key leaves identical separate.
  const fillDir = new THREE.Vector3(0.80, 0.35, -0.45).normalize();

  const shared = {
    uTime: { value: 0 },
    uMatte: { value: 0 },
    uArchitectural: { value: 0 },
    uFog: { value: fogColor },
    uFogDensity: { value: FOG_DENSITY },
    uCamPos: { value: camera.position },
    uLightDir: { value: lightDir },
    uFillDir: { value: fillDir },
  };

  // ---------------------------------------------------------------- ground
  const groundUniforms = { uBg: { value: new THREE.Color(BG_HEX) }, uReveal: { value: 1 }, ...shared };
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, uniforms: groundUniforms }),
  );
  ground.frustumCulled = false;
  scene.add(ground);

  // ------------------------------------------------------------- buildings
  const boxGeometry = new RoundedBoxGeometry(1, 1, 1, 1, 0.025).translate(0, 0.5, 0);
  const buildingState = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 3), 3);
  buildingState.setUsage(THREE.DynamicDrawUsage);
  boxGeometry.setAttribute('aState', buildingState);
  const glassGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.07).translate(0, 0.5, 0);
  glassGeometry.setAttribute('aState', buildingState);
  const buildingMaterial = new THREE.ShaderMaterial({ vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG, uniforms: { ...shared, uSurface: { value: 0 } }, extensions: { derivatives: true } });
  const buildings = new THREE.InstancedMesh(boxGeometry, buildingMaterial, MAX_NODES);
  buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  buildings.frustumCulled = false;
  buildings.count = 0;
  scene.add(buildings);

  // Two extra instanced draw calls give every module a plinth and setback crown,
  // rather than spawning individual meshes or increasing per-node materials.
  function tierMesh(surface) {
    const material = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG,
      uniforms: { ...shared, uSurface: { value: surface } },
      extensions: { derivatives: true },
    });
    const mesh = new THREE.InstancedMesh(boxGeometry, material, MAX_NODES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  }
  const crowns = tierMesh(1);
  const plinths = tierMesh(2);

  const padGeometry = () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 3), 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aState', attribute);
    return { geometry, attribute };
  };
  const shadowPad = padGeometry();
  const shadows = new THREE.InstancedMesh(
    shadowPad.geometry,
    new THREE.ShaderMaterial({ vertexShader: PAD_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false }),
    MAX_NODES,
  );
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.count = 0;
  shadows.renderOrder = 1;
  scene.add(shadows);

  const glowPad = padGeometry();
  const glows = new THREE.InstancedMesh(
    glowPad.geometry,
    new THREE.ShaderMaterial({ vertexShader: PAD_VERT, fragmentShader: GLOW_FRAG, uniforms: { ...shared }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    MAX_NODES,
  );
  glows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glows.frustumCulled = false;
  glows.count = 0;
  glows.renderOrder = 2;
  scene.add(glows);

  const white = new THREE.Color(0xffffff);
  for (let index = 0; index < MAX_NODES; index += 1) {
    buildings.setColorAt(index, white);
    crowns.setColorAt(index, white);
    plinths.setColorAt(index, white);
    shadows.setColorAt(index, white);
    glows.setColorAt(index, white);
  }

  // --------------------------------------------------------- selection ring
  const ringUniforms = { uColor: { value: new THREE.Color(0x6a6a73) }, uStrength: { value: 0 }, ...shared };
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: ringUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  ring.renderOrder = 3;
  ring.visible = false;
  scene.add(ring);

  // ------------------------------------------------------------------ edges
  const edgeUniforms = { uDraw: { value: 1 }, ...shared };
  const edgeMaterial = new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT,
    fragmentShader: EDGE_FRAG,
    uniforms: edgeUniforms,
    // ESSL 1.00 needs the derivative extension declared explicitly; the box
    // filter above depends on fwidth().
    extensions: { derivatives: true },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const edgeMesh = new THREE.Mesh(new THREE.BufferGeometry(), edgeMaterial);
  edgeMesh.frustumCulled = false;
  edgeMesh.renderOrder = 4;
  scene.add(edgeMesh);
  let edgeRanges = [];
  let edgeTopologyKey = '';
  let edgeStateKey = '';

  // -------------------------------------------------------------- districts
  const districtGroup = new THREE.Group();
  districtGroup.renderOrder = 0;
  scene.add(districtGroup);
  const districtMeshes = new Map();
  const districtLabels = new Map();

  // --------------------------------------------------------- post pipeline
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, renderTarget);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.25, 0.96);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  // ------------------------------------------------------------- node state
  const nodes = new Map();
  let nodeOrder = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const colorScratch = new THREE.Color();

  const cameraState = { bearing: -32, pitch: 42, zoom: 0.9, panX: 0, panY: 0, depth: 20 };
  let intro = null;
  let active = true;
  let paused = false;
  let disposed = false;
  let lastFrame = performance.now();
  let labelsVisible = true;
  let hoveredId = null;
  let selectedId = null;
  let journeyLens = false;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let framesToSettle = 3;
  motionPreference.addEventListener('change', () => { framesToSettle = 3; });
  let visualTime = 0;
  let appearance = 'luminous';

  function setAppearance(value) {
    if (disposed) return appearance;
    const style = sceneAppearance(value);
    appearance = style.name;
    shared.uMatte.value = style.matte;
    shared.uArchitectural.value = style.architectural;
    buildings.geometry = style.architectural ? boxGeometry : glassGeometry;
    crowns.visible = plinths.visible = Boolean(style.architectural);
    scene.background.setHex(style.background);
    fogColor.setHex(style.background);
    groundUniforms.uBg.value.setHex(style.background);
    renderer.setClearColor(style.background, 1);
    renderer.toneMappingExposure = style.exposure;
    bloomPass.strength = style.bloomStrength;
    bloomPass.radius = style.bloomRadius;
    bloomPass.threshold = style.bloomThreshold;
    // Matte skips the post-processing pass completely, including its blur work.
    bloomPass.enabled = style.bloomStrength > 0;
    framesToSettle = 3;
    return appearance;
  }

  function atlasToWorld(atlasPosition) {
    return {
      x: (atlasPosition.x - 50) * WORLD,
      y: (atlasPosition.z ?? 0) * 0.16,
      z: -((atlasPosition.y - 50) * WORLD),
    };
  }

  function buildingHeight(atlasPosition, { journey = false } = {}) {
    const z = Number.isFinite(atlasPosition.z) ? atlasPosition.z : 10;
    const base = 0.9 + z * 0.17;
    return journey ? base * 0.9 : base;
  }

  function footprintFor(factor = 1, journey = false) {
    return 1.08 * factor * (journey ? 0.92 : 1);
  }

  function applyCamera(cam) {
    cameraState.bearing = cam.bearing;
    cameraState.pitch = clamp(cam.pitch, 8, 89);
    cameraState.zoom = clamp(cam.zoom, 0.3, 4);
    cameraState.panX = cam.panX;
    cameraState.panY = cam.panY;
    cameraState.depth = cam.depth;
    const az = THREE.MathUtils.degToRad(cameraState.bearing);
    const el = THREE.MathUtils.degToRad(cameraState.pitch);
    // Preserve the whole city on portrait screens instead of cropping its sides.
    const viewportFit = Math.min(1, (size.w / size.h) / (size.w < 700 ? 1.5 : 1.3));
    const distance = BASE_DISTANCE / (cameraState.zoom * viewportFit);
    // Portrait fitting moves the camera back for framing, not atmospheric depth.
    // Compensate fog so the same city does not turn into dark stubs on a phone.
    shared.uFogDensity.value = FOG_DENSITY * viewportFit;
    target.set(cameraState.panX * PAN, 0, cameraState.panY * PAN);
    camera.position.set(
      target.x + distance * Math.cos(el) * Math.sin(az),
      target.y + distance * Math.sin(el),
      target.z + distance * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }

  function worldToScreen(x, y, z) {
    projected.set(x, y, z).project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * size.w,
      y: (-projected.y * 0.5 + 0.5) * size.h,
      depth: projected.z,
      behind: projected.z > 1 || projected.z < -1,
    };
  }

  function screenToViewBox(point) {
    const viewBox = svg.viewBox.baseVal;
    const width = viewBox.width || 1120;
    const height = viewBox.height || 700;
    const fit = Math.min(size.w / width, size.h / height) || 1;
    const offsetX = (size.w - width * fit) / 2;
    const offsetY = (size.h - height * fit) / 2;
    return { x: viewBox.x + (point.x - offsetX) / fit, y: viewBox.y + (point.y - offsetY) / fit };
  }

  function worldToViewBox(world) {
    return screenToViewBox(worldToScreen(world.x, world.y, world.z));
  }

  function hitPolygon(atlasPosition, { journey = false, footprint = 1, nodeId = null } = {}) {
    const world = atlasToWorld(atlasPosition);
    const node = nodeId ? nodes.get(nodeId) : null;
    const height = node ? Math.max(0.05, node.h * node.reveal) : buildingHeight(atlasPosition, { journey });
    const half = footprintFor(footprint, journey) / 2;
    const corners = [];
    for (const dx of [-half, half]) {
      for (const dz of [-half, half]) {
        for (const dy of [0, height]) {
          corners.push(screenToViewBox(worldToScreen(world.x + dx, dy, world.z + dz)));
        }
      }
    }
    return convexHull(corners).map((corner) => `${corner.x.toFixed(1)},${corner.y.toFixed(1)}`).join(' ');
  }

  function groundPolygon(bounds) {
    const corners = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ].map((corner) => {
      const world = atlasToWorld({ ...corner, z: 0 });
      return screenToViewBox(worldToScreen(world.x, 0.02, world.z));
    });
    return convexHull(corners).map((corner) => `${corner.x.toFixed(1)},${corner.y.toFixed(1)}`).join(' ');
  }

  function groundPointAtScreen(px, py) {
    ndc.set((px / size.w) * 2 - 1, -(py / size.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
  }

  function panDeltaFromScreen(cam, dx, dy) {
    const el = THREE.MathUtils.degToRad(clamp(cam.pitch, 8, 89));
    const az = THREE.MathUtils.degToRad(cam.bearing);
    const distance = BASE_DISTANCE / clamp(cam.zoom, 0.3, 4);
    const worldPerPx = (2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / Math.max(size.h, 1);
    const right = { x: Math.cos(az), z: -Math.sin(az) };
    const forward = { x: -Math.sin(az), z: -Math.cos(az) };
    const vertical = worldPerPx / Math.max(Math.sin(el), 0.2);
    const wx = -dx * worldPerPx * right.x + dy * vertical * forward.x;
    const wz = -dx * worldPerPx * right.z + dy * vertical * forward.z;
    return { x: wx / PAN, y: wz / PAN };
  }

  function panForWorld(world) {
    return { panX: world.x / PAN, panY: world.z / PAN };
  }

  function zoomAtScreen(cam, px, py, nextZoom) {
    applyCamera(cam);
    const before = groundPointAtScreen(px, py);
    const next = { ...cam, zoom: nextZoom };
    applyCamera(next);
    const after = groundPointAtScreen(px, py);
    if (before && after) {
      next.panX += (before.x - after.x) / PAN;
      next.panY += (before.z - after.z) / PAN;
    }
    applyCamera(cam);
    return next;
  }

  // ---------------------------------------------------------------- labels
  function ensureLabel(node) {
    if (node.el) return node.el;
    const el = document.createElement('div');
    el.className = 'city-label';
    el.dataset.nodeId = node.id;
    el.innerHTML = `<span class="city-label-glyph">${iconSvg(node.icon, { size: 13, weight: 'bold' })}</span><span class="city-label-text">${escapeHtml(node.shortLabel)}</span><span class="city-label-stage" hidden></span>`;
    labelLayer.append(el);
    node.el = el;
    node.stageEl = el.querySelector('.city-label-stage');
    node.textEl = el.querySelector('.city-label-text');
    node.width = 0;
    return el;
  }

  function syncLabelContent(node, data) {
    ensureLabel(node);
    if (node.shortLabel !== data.shortLabel) {
      node.shortLabel = data.shortLabel;
      node.textEl.textContent = data.shortLabel;
      node.width = 0;
    }
    const stage = data.stage ?? null;
    if (node.stage !== stage) {
      node.stage = stage;
      node.stageEl.hidden = stage === null;
      node.stageEl.textContent = stage === null ? '' : String(stage);
      node.width = 0;
    }
    node.el.classList.toggle('is-selected', Boolean(data.selected));
    node.el.classList.toggle('is-hovered', Boolean(data.hovered));
    node.el.classList.toggle('is-current', Boolean(data.current));
    node.el.classList.toggle('is-chapter', Boolean(data.chapter));
    node.el.classList.toggle('is-dimmed', Boolean(data.dim));
    node.el.classList.toggle('is-stage', stage !== null);
    node.el.classList.toggle('is-active-stage', Boolean(data.activeStage));
    node.el.style.setProperty('--node-color', data.color);
  }

  function ensureDistrictLabel(district) {
    let entry = districtLabels.get(district.key);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'city-district';
      el.innerHTML = `<span class="city-district-swatch"></span><span class="city-district-name"></span><span class="city-district-count"></span>`;
      labelLayer.append(el);
      entry = { el, name: el.querySelector('.city-district-name'), count: el.querySelector('.city-district-count') };
      districtLabels.set(district.key, entry);
    }
    entry.name.textContent = district.label;
    entry.count.textContent = String(district.count);
    entry.el.style.setProperty('--district-color', district.color);
    entry.el.classList.toggle('is-active', Boolean(district.active));
    return entry;
  }

  labelLayer.addEventListener('pointerover', (event) => {
    const id = event.target.closest?.('[data-node-id]')?.dataset.nodeId;
    if (id && id !== hoveredId) onHover?.(id);
  });
  labelLayer.addEventListener('pointerout', (event) => {
    const id = event.target.closest?.('[data-node-id]')?.dataset.nodeId;
    const nextId = event.relatedTarget?.closest?.('[data-node-id]')?.dataset.nodeId ?? null;
    if (id && nextId !== id) onHover?.(nextId);
  });

  // ------------------------------------------------------------------ sync
  function setCamera(cam) {
    framesToSettle = 3;
    applyCamera(cam);
  }

  /**
   * Zoom and pan (keeping bearing and pitch) so world points land inside a
   * viewport rectangle given in CSS pixels. Perspective makes the fit
   * non-linear, so a few refinement passes converge on it. The live camera is
   * left untouched; the caller animates to the result.
   */
  function fitView(cam, points, rect, { minZoom = 0.45, maxZoom = 1.6 } = {}) {
    if (!points.length) return { zoom: cam.zoom, panX: cam.panX, panY: cam.panY };
    const original = { ...cameraState };
    const next = { ...cam };
    const bounds = () => {
      applyCamera(next);
      const screen = points.map((point) => worldToScreen(point.x, point.y, point.z));
      const xs = screen.map((point) => point.x);
      const ys = screen.map((point) => point.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    };
    for (let pass = 0; pass < 5; pass += 1) {
      let box = bounds();
      const scale = Math.min(
        (rect.right - rect.left) / Math.max(1, box.maxX - box.minX),
        (rect.bottom - rect.top) / Math.max(1, box.maxY - box.minY),
      );
      next.zoom = clamp(next.zoom * scale, minZoom, maxZoom);
      box = bounds();
      const delta = panDeltaFromScreen(next, (rect.left + rect.right) / 2 - (box.minX + box.maxX) / 2, (rect.top + rect.bottom) / 2 - (box.minY + box.maxY) / 2);
      next.panX += delta.x;
      next.panY += delta.y;
    }
    applyCamera(original);
    return { zoom: next.zoom, panX: next.panX, panY: next.panY };
  }

  function rebuildEdges(edges) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const styles = [];
    const indices = [];
    edgeRanges = [];
    let base = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const mid = new THREE.Vector3();
    edges.forEach((edge) => {
      a.set(edge.from.x, edge.from.y, edge.from.z);
      b.set(edge.to.x, edge.to.y, edge.to.z);
      const length = a.distanceTo(b);
      mid.copy(a).add(b).multiplyScalar(0.5);
      mid.y = Math.max(a.y, b.y) + 0.28 + Math.min(length * 0.10, 1.8);
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid.clone(), b.clone());
      const tube = new THREE.TubeGeometry(curve, 30, 0.026, 6, false);
      const p = tube.attributes.position.array;
      const n = tube.attributes.normal.array;
      const u = tube.attributes.uv.array;
      const idx = tube.index.array;
      const count = p.length / 3;
      colorScratch.set(edge.color);
      for (let index = 0; index < count; index += 1) {
        positions.push(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
        normals.push(n[index * 3], n[index * 3 + 1], n[index * 3 + 2]);
        uvs.push(u[index * 2], u[index * 2 + 1]);
        colors.push(colorScratch.r, colorScratch.g, colorScratch.b);
        styles.push(edge.style ?? 0);
      }
      for (let index = 0; index < idx.length; index += 1) indices.push(idx[index] + base);
      edgeRanges.push({ start: base, count });
      base += count;
      tube.dispose();
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aStyle', new THREE.Float32BufferAttribute(styles, 1));
    const state = new THREE.Float32BufferAttribute(new Float32Array(base * 4), 4);
    state.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aState', state);
    geometry.setIndex(indices);
    edgeMesh.geometry.dispose();
    edgeMesh.geometry = geometry;
    edgeStateKey = '';
  }

  function writeEdgeState(edges) {
    const attribute = edgeMesh.geometry.getAttribute('aState');
    if (!attribute) return;
    const array = attribute.array;
    edges.forEach((edge, edgeIndex) => {
      const range = edgeRanges[edgeIndex];
      if (!range) return;
      for (let index = range.start; index < range.start + range.count; index += 1) {
        array[index * 4] = edge.emphasis;
        array[index * 4 + 1] = edge.dim;
        array[index * 4 + 2] = edge.current ? 1 : 0;
        array[index * 4 + 3] = edge.hidden ? 1 : 0;
      }
    });
    attribute.needsUpdate = true;
  }

  function syncDistricts(districts) {
    const seen = new Set();
    districts.forEach((district) => {
      seen.add(district.key);
      const a = atlasToWorld({ x: district.minX, y: district.minY, z: 0 });
      const b = atlasToWorld({ x: district.maxX, y: district.maxY, z: 0 });
      const width = Math.max(Math.abs(b.x - a.x), 1.5);
      const depth = Math.max(Math.abs(b.z - a.z), 1.5);
      let entry = districtMeshes.get(district.key);
      if (!entry) {
        const material = new THREE.ShaderMaterial({
          vertexShader: DISTRICT_VERT,
          fragmentShader: DISTRICT_FRAG,
          uniforms: {
            uColor: { value: new THREE.Color(district.color) },
            uSize: { value: new THREE.Vector2(width, depth) },
            uRadius: { value: 1 },
            uActive: { value: 0 },
            uReveal: { value: 0 },
            ...shared,
          },
          transparent: true,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2), material);
        mesh.renderOrder = 0;
        districtGroup.add(mesh);
        entry = { mesh, material, reveal: 0, active: 0, width, depth, center: new THREE.Vector3() };
        districtMeshes.set(district.key, entry);
      }
      entry.width = width;
      entry.depth = depth;
      entry.center.set((a.x + b.x) / 2, 0.012, (a.z + b.z) / 2);
      entry.mesh.position.copy(entry.center);
      entry.mesh.scale.set(width, 1, depth);
      entry.material.uniforms.uColor.value.set(district.color);
      entry.material.uniforms.uSize.value.set(width, depth);
      entry.material.uniforms.uRadius.value = appearance === 'architectural'
        ? Math.min(0.32, Math.min(width, depth) * 0.05)
        : Math.min(width, depth) * 0.16;
      entry.targetActive = district.active ? 1 : 0;
      entry.label = ensureDistrictLabel(district);
      entry.bounds = { minX: a.x, maxX: b.x, minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
    });
    districtMeshes.forEach((entry, key) => {
      if (seen.has(key)) return;
      districtGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      districtMeshes.delete(key);
      const label = districtLabels.get(key);
      label?.el.remove();
      districtLabels.delete(key);
    });
  }

  function sync(data, cam) {
    if (disposed) return;
    framesToSettle = 3;
    applyCamera(cam);
    labelsVisible = data.labelsVisible !== false;
    hoveredId = data.hoveredNodeId ?? null;
    selectedId = data.selectedNodeId ?? null;
    journeyLens = Boolean(data.journey);

    const seen = new Set();
    nodeOrder = [];
    // Instance buffers are allocated once; never ask them to draw more than they hold.
    data.nodes.slice(0, MAX_NODES).forEach((entry, index) => {
      seen.add(entry.id);
      let node = nodes.get(entry.id);
      const world = atlasToWorld(entry.position);
      if (!node) {
        node = {
          id: entry.id,
          icon: entry.icon,
          shortLabel: '',
          stage: undefined,
          h: 0,
          emph: 0,
          dim: 0,
          reveal: intro ? 0 : 1,
          introDelay: 0,
          color: new THREE.Color(entry.color),
          colorHex: entry.color,
          el: null,
        };
        nodes.set(entry.id, node);
      }
      node.index = index;
      node.x = world.x;
      node.z = world.z;
      node.hTarget = Number.isFinite(entry.height) ? entry.height : buildingHeight(entry.position, { journey: journeyLens });
      node.footprint = footprintFor(entry.footprint ?? 1, journeyLens);
      node.emphTarget = entry.selected ? 1 : entry.hovered ? 0.72 : entry.current ? 0.9 : entry.chapter ? 0.45 : 0;
      node.dimTarget = entry.dim ? 1 : 0;
      node.priority = (entry.selected ? 8 : 0) + (entry.hovered ? 6 : 0) + (entry.current ? 4 : 0) + (entry.stage ? 3 : 0) + (entry.chapter ? 1 : 0);
      node.selected = Boolean(entry.selected);
      node.colorHex = entry.color;
      node.color.set(entry.color);
      node.icon = entry.icon;
      syncLabelContent(node, entry);
      nodeOrder.push(node);
    });
    nodes.forEach((node, id) => {
      if (seen.has(id)) return;
      node.el?.remove();
      nodes.delete(id);
    });
    buildings.count = nodeOrder.length;
    crowns.count = nodeOrder.length;
    plinths.count = nodeOrder.length;
    shadows.count = nodeOrder.length;
    glows.count = nodeOrder.length;
    nodeOrder.forEach((node, index) => {
      buildings.setColorAt(index, node.color);
      crowns.setColorAt(index, node.color);
      plinths.setColorAt(index, node.color);
      shadows.setColorAt(index, node.color);
      glows.setColorAt(index, node.color);
    });
    buildings.instanceColor.needsUpdate = true;
    crowns.instanceColor.needsUpdate = true;
    plinths.instanceColor.needsUpdate = true;
    shadows.instanceColor.needsUpdate = true;
    glows.instanceColor.needsUpdate = true;

    // Edges: rebuild geometry only when the topology or endpoints move.
    const edges = data.edges.map((edge) => {
      const fromNode = nodes.get(edge.fromId);
      const toNode = nodes.get(edge.toId);
      const from = atlasToWorld(edge.from);
      const to = atlasToWorld(edge.to);
      return {
        ...edge,
        from: { x: from.x, y: (fromNode?.hTarget ?? buildingHeight(edge.from)) * 0.92, z: from.z },
        to: { x: to.x, y: (toNode?.hTarget ?? buildingHeight(edge.to)) * 0.92, z: to.z },
      };
    });
    const topologyKey = edges.map((edge) => `${edge.id}:${edge.from.x.toFixed(2)},${edge.from.z.toFixed(2)},${edge.from.y.toFixed(2)}>${edge.to.x.toFixed(2)},${edge.to.z.toFixed(2)},${edge.to.y.toFixed(2)}:${edge.color}:${edge.style ?? 0}`).join('|');
    if (topologyKey !== edgeTopologyKey) {
      edgeTopologyKey = topologyKey;
      rebuildEdges(edges);
    }
    const stateKey = edges.map((edge) => `${edge.emphasis.toFixed(2)}${edge.dim}${edge.current ? 1 : 0}${edge.hidden ? 1 : 0}`).join('');
    if (stateKey !== edgeStateKey) {
      edgeStateKey = stateKey;
      writeEdgeState(edges);
    }

    syncDistricts(data.districts ?? []);

    // Selection ring
    const selectedNode = selectedId ? nodes.get(selectedId) : null;
    ring.visible = Boolean(selectedNode);
    if (selectedNode) {
      ring.position.set(selectedNode.x, 0.09, selectedNode.z);
      const ringSize = selectedNode.footprint * 2.0;
      ring.scale.set(ringSize, 1, ringSize);
      ringUniforms.uColor.value.copy(selectedNode.color);
    }
  }

  // --------------------------------------------------------------- frames
  let introSpeed = 1;

  function introProgress(now) {
    if (!intro) return null;
    const t = ((now - intro.start) / 1000) * introSpeed;
    if (t > 3.4 || motionPreference.matches) {
      intro = null;
      groundUniforms.uReveal.value = 1;
      edgeUniforms.uDraw.value = 1;
      nodes.forEach((node) => { node.reveal = 1; });
      districtMeshes.forEach((entry) => { entry.reveal = 1; });
      return null;
    }
    return t;
  }

  function updateNodes(dt, now) {
    const t = introProgress(now);
    const k = motionPreference.matches ? 1 : 1 - Math.exp(-dt * 7.5);
    const kFast = motionPreference.matches ? 1 : 1 - Math.exp(-dt * 11);
    const buildingArray = buildingState.array;
    const shadowArray = shadowPad.attribute.array;
    const glowArray = glowPad.attribute.array;
    if (t !== null) {
      groundUniforms.uReveal.value = easeOutCubic(clamp(t / 1.5, 0, 1));
      edgeUniforms.uDraw.value = clamp((t - 1.15) / 1.35, 0, 1);
    }
    nodeOrder.forEach((node, index) => {
      node.h += (node.hTarget - node.h) * k;
      node.emph += (node.emphTarget - node.emph) * kFast;
      node.dim += (node.dimTarget - node.dim) * k;
      if (t !== null) {
        if (!node.introDelay) {
          const radial = Math.hypot(node.x, node.z) / 24;
          node.introDelay = 0.28 + radial * 0.85 + hashString(node.id) * 0.28;
        }
        node.reveal = clamp(easeOutBack(clamp((t - node.introDelay) / 0.95, 0, 1)), 0, 1.12);
      } else if (node.reveal < 1) {
        node.reveal = 1;
      }
      const rev = node.reveal;
      const height = Math.max(0.02, node.h * rev);
      const foot = node.footprint * (0.55 + 0.45 * Math.min(rev, 1)) * (1 + node.emph * 0.06);
      const profile = towerProfile(node.id, height, foot);
      const architectural = appearance === 'architectural';
      position.set(node.x, architectural ? profile.plinthHeight : 0, node.z);
      scale.set(architectural ? profile.bodyWidth : foot, architectural ? profile.bodyHeight : height, architectural ? profile.bodyWidth : foot);
      matrix.compose(position, quaternion, scale);
      buildings.setMatrixAt(index, matrix);
      position.set(node.x, profile.crownY, node.z);
      scale.set(profile.crownWidth, profile.crownHeight, profile.crownDepth);
      matrix.compose(position, quaternion, scale);
      crowns.setMatrixAt(index, matrix);
      position.set(node.x, 0, node.z);
      scale.set(foot, profile.plinthHeight, foot);
      matrix.compose(position, quaternion, scale);
      plinths.setMatrixAt(index, matrix);
      const padSize = node.footprint * 1.9 * (0.6 + 0.4 * Math.min(rev, 1));
      position.set(node.x + foot * 0.07, 0.02, node.z - foot * 0.06);
      scale.set(padSize, 1, padSize);
      matrix.compose(position, quaternion, scale);
      shadows.setMatrixAt(index, matrix);
      const glowSize = node.footprint * (appearance === 'architectural' ? 2.0 : 2.8);
      position.set(node.x, 0.05, node.z);
      scale.set(glowSize, 1, glowSize);
      matrix.compose(position, quaternion, scale);
      glows.setMatrixAt(index, matrix);
      const revealClamped = Math.min(rev, 1);
      buildingArray[index * 3] = node.emph;
      buildingArray[index * 3 + 1] = node.dim;
      buildingArray[index * 3 + 2] = revealClamped;
      shadowArray[index * 3] = node.emph;
      shadowArray[index * 3 + 1] = node.dim;
      shadowArray[index * 3 + 2] = revealClamped;
      glowArray[index * 3] = node.emph;
      glowArray[index * 3 + 1] = node.dim;
      glowArray[index * 3 + 2] = revealClamped;
    });
    buildings.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    plinths.instanceMatrix.needsUpdate = true;
    shadows.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
    buildingState.needsUpdate = true;
    shadowPad.attribute.needsUpdate = true;
    glowPad.attribute.needsUpdate = true;

    districtMeshes.forEach((entry) => {
      const revealTarget = t === null ? 1 : clamp((t - 0.35) / 1.1, 0, 1);
      entry.reveal = t === null ? entry.reveal + (1 - entry.reveal) * k : easeOutCubic(revealTarget);
      entry.active += ((entry.targetActive ?? 0) - entry.active) * k;
      entry.material.uniforms.uReveal.value = entry.reveal;
      entry.material.uniforms.uActive.value = entry.active;
    });

    const selectedNode = selectedId ? nodes.get(selectedId) : null;
    const ringTarget = selectedNode ? 1 : 0;
    ringUniforms.uStrength.value += (ringTarget - ringUniforms.uStrength.value) * kFast;
    ring.visible = ringUniforms.uStrength.value > 0.01 && Boolean(selectedNode);
    return t;
  }

  let shieldRects = [];
  let shieldTick = 0;
  function refreshShields() {
    shieldTick = (shieldTick + 1) % 30;
    if (shieldTick !== 1 && !motionPreference.matches) return;
    const viewportRect = viewport.getBoundingClientRect();
    shieldRects = [...document.querySelectorAll('[data-label-shield]')]
      .filter((element) => !element.hidden && element.getClientRects().length > 0 && getComputedStyle(element).opacity !== '0')
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left - viewportRect.left - 6, y: rect.top - viewportRect.top - 6, width: rect.width + 12, height: rect.height + 12 };
      })
      .filter((rect) => rect.width > 12 && rect.height > 12);
  }

  function overlaps(rect, others) {
    return others.some((other) =>
      !(rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y));
  }

  function updateLabels(t) {
    const distance = BASE_DISTANCE / cameraState.zoom;
    // Names fade as the city recedes. A walkthrough is framed wider, so it fades later.
    const distanceAlpha = journeyLens ? smooth(140, 104, distance) : smooth(102, 74, distance);
    const introAlpha = t === null ? 1 : clamp((t - 1.5) / 0.9, 0, 1);
    const baseAlpha = distanceAlpha * introAlpha * (labelsVisible ? 1 : 0);
    refreshShields();
    const placed = [...shieldRects];
    const nodePlacements = [];
    nodeOrder.forEach((node) => {
      const el = node.el;
      if (!el) return;
      const top = Math.max(0.05, node.h * node.reveal);
      const screen = worldToScreen(node.x, top + 0.42, node.z);
      // Measure the full label; a collapsed chapter badge would under-report it.
      if (!node.width && !node.compact) {
        node.width = el.offsetWidth || 96;
        node.labelHeight = el.offsetHeight || 32;
      }
      const width = (node.width || 96) + 8;
      const height = (node.labelHeight || 32) + 6;
      const offscreen = screen.behind || (size.w < 700
        ? screen.x - width / 2 < 6 || screen.x + width / 2 > size.w - 6 || screen.y - height < 74 || screen.y > size.h - 80
        : screen.x < -80 || screen.x > size.w + 80 || screen.y < -40 || screen.y > size.h + 60);
      nodePlacements.push({
        node,
        el,
        screen,
        offscreen,
        priority: node.priority > 0,
        rect: { x: screen.x - width / 2, y: screen.y - height, width, height },
      });
    });
    nodePlacements.sort((first, second) => second.node.priority - first.node.priority || first.screen.depth - second.screen.depth);

    // Pass 1: priority labels (selected, hovered, current call, walkthrough chapters) win, except under
    // chrome. A label that would collide first steps up a line; a weaker chapter label then collapses to
    // its number (hover restores the name); the current chapter's names always show.
    const priorityPlaced = [];
    const fits = (rect) => !overlaps(rect, priorityPlaced) && !overlaps(rect, shieldRects);
    const spotAt = (placement, [dx, dy], width, compact = false) => ({
      dx,
      dy,
      compact,
      rect: { x: placement.screen.x + dx - width / 2, y: placement.rect.y + dy, width, height: placement.rect.height },
    });
    nodePlacements.forEach((placement) => {
      if (!placement.priority || placement.offscreen) return;
      placement.compact = false;
      placement.offset = [0, 0];
      const strong = placement.node.priority >= 4;
      const isStage = placement.node.stage !== null && placement.node.stage !== undefined;
      const width = placement.rect.width;
      const side = width * 0.55;
      let spot = [[0, 0], [0, -36], [side, 0], [-side, 0], [side, -36], [-side, -36]]
        .map((offset) => spotAt(placement, offset, width))
        .find(({ rect }) => fits(rect));
      if (!spot && isStage && !strong) spot = [[0, 0], [0, -36], [0, -72]].map((offset) => spotAt(placement, offset, 40, true)).find(({ rect }) => fits(rect));
      if (!spot && strong && !overlaps(placement.rect, shieldRects)) spot = spotAt(placement, [0, 0], width);
      if (!spot) {
        placement.alpha = 0;
        return;
      }
      placement.compact = spot.compact;
      placement.offset = [spot.dx, spot.dy];
      placement.rect = spot.rect;
      placement.alpha = Math.max(baseAlpha, introAlpha * (labelsVisible || placement.node.selected ? 1 : 0));
      priorityPlaced.push(placement.rect);
      placed.push(placement.rect);
    });

    // Pass 2: district captions sit at the visually highest edge of their pad and yield to priority labels.
    const districtPlacements = [];
    districtMeshes.forEach((entry) => {
      const label = entry.label;
      if (!label) return;
      const { bounds } = entry;
      const candidates = [
        { x: (bounds.minX + bounds.maxX) / 2, z: bounds.minZ },
        { x: (bounds.minX + bounds.maxX) / 2, z: bounds.maxZ },
        { x: bounds.minX, z: (bounds.minZ + bounds.maxZ) / 2 },
        { x: bounds.maxX, z: (bounds.minZ + bounds.maxZ) / 2 },
      ].map((corner) => worldToScreen(corner.x, 0.02, corner.z));
      const top = candidates.reduce((best, candidate) => (candidate.y < best.y ? candidate : best), candidates[0]);
      // World-space pad width must never double as a CSS-pixel label width.
      if (!entry.labelWidth) {
        entry.labelWidth = label.el.offsetWidth || 120;
        entry.labelHeight = label.el.offsetHeight || 31;
      }
      const rect = { x: top.x - entry.labelWidth / 2 - 4, y: top.y - entry.labelHeight - 10, width: entry.labelWidth + 8, height: entry.labelHeight + 8 };
      let alpha = entry.reveal * smooth(120, 80, distance) * (1 - smooth(20, 8, distance) * 0.7);
      if (top.behind || overlaps(rect, placed) || rect.x < 6 || rect.x + rect.width > size.w - 6 || rect.y < 6 || rect.y + rect.height > size.h - 6) alpha = 0;
      if (alpha > 0.02) placed.push(rect);
      districtPlacements.push({ label, top, alpha });
    });

    // Pass 3: everything else fills the remaining space, nearest first.
    nodePlacements.forEach((placement) => {
      if (placement.priority || placement.offscreen) return;
      let alpha = baseAlpha;
      if (alpha > 0.02 && overlaps(placement.rect, placed)) alpha = 0;
      if (alpha > 0.02) placed.push(placement.rect);
      if (placement.node.dim > 0.5) alpha *= 0.45;
      placement.alpha = alpha;
    });

    nodePlacements.forEach(({ node, el, screen, offscreen, alpha = 0, priority, compact = false, offset: [offsetX, offsetY] = [0, 0] }) => {
      if (node.compact !== compact) {
        node.compact = compact;
        el.classList.toggle('is-compact', compact);
      }
      if (offscreen) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = alpha > 0.02 ? 'visible' : 'hidden';
      el.style.opacity = alpha.toFixed(3);
      el.style.zIndex = String(1000 + Math.round((1 - screen.depth) * 900) + (priority ? 400 : 0));
      el.style.transform = `translate3d(${(screen.x + offsetX).toFixed(1)}px, ${(screen.y + offsetY).toFixed(1)}px, 0) translate(-50%, -100%)`;
    });

    districtPlacements.forEach(({ label, top, alpha }) => {
      label.el.style.opacity = alpha.toFixed(3);
      label.el.style.visibility = alpha > 0.02 ? 'visible' : 'hidden';
      label.el.style.transform = `translate3d(${top.x.toFixed(1)}px, ${(top.y - 6).toFixed(1)}px, 0) translate(-50%, -100%)`;
    });
  }

  function frame(now) {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (!active || paused || document.hidden) {
      lastFrame = now;
      return;
    }
    // Static reduced-motion views only repaint after a change. Idle decorative
    // lighting runs at 30fps, while camera updates still invalidate each frame.
    if (motionPreference.matches && framesToSettle <= 0 && !intro) return;
    if (!intro && framesToSettle <= 0 && now - lastFrame < 1000 / 30) return;
    framesToSettle = Math.max(0, framesToSettle - 1);
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    if (!motionPreference.matches) visualTime += dt;
    shared.uTime.value = visualTime;
    const t = updateNodes(dt, now);
    updateLabels(t);
    composer.render();
  }

  // --------------------------------------------------------------- sizing
  function resize() {
    framesToSettle = 3;
    const rect = viewport.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === size.w && h === size.h) return;
    size.w = w;
    size.h = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyCamera(cameraState);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
    nodes.forEach((node) => { node.width = 0; });
    districtMeshes.forEach((entry) => { entry.labelWidth = 0; });
  }
  resize();
  const observer = new ResizeObserver(() => resize());
  observer.observe(viewport);
  document.fonts?.ready.then(() => {
    nodes.forEach((node) => { node.width = 0; });
    districtMeshes.forEach((entry) => { entry.labelWidth = 0; });
    framesToSettle = 3;
  });

  applyCamera(cameraState);
  setAppearance(document.body.dataset.appearance);
  requestAnimationFrame(frame);
  // Debug handle for browser QA and console inspection; nothing in the app reads it.
  window.__atlasCity = { scene, camera, renderer, composer, bloomPass, nodes, districtMeshes, edgeMesh, buildings, crowns, plinths, glows, shadows, ring, ground, api: null };

  const city = {
    ready: true,
    renderer,
    atlasToWorld,
    buildingHeight,
    worldToViewBox,
    hitPolygon,
    groundPolygon,
    panDeltaFromScreen,
    panForWorld,
    zoomAtScreen,
    fitView,
    setCamera,
    setAppearance,
    get appearance() { return appearance; },
    sync,
    capture() {
      composer.render();
      return canvas.toDataURL('image/png');
    },
    setIntroSpeed(speed) {
      introSpeed = clamp(Number(speed) || 1, 0.02, 4);
    },
    playIntro() {
      if (motionPreference.matches) return;
      intro = { start: performance.now() };
      groundUniforms.uReveal.value = 0;
      edgeUniforms.uDraw.value = 0;
      nodes.forEach((node) => {
        node.reveal = 0;
        node.introDelay = 0;
      });
      districtMeshes.forEach((entry) => { entry.reveal = 0; });
    },
    pause(next = true) {
      paused = Boolean(next);
      lastFrame = performance.now();
    },
    setActive(next) {
      framesToSettle = 3;
      active = Boolean(next);
      canvas.hidden = !active;
      labelLayer.hidden = !active;
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      composer.dispose?.();
      renderer.dispose();
      nodes.forEach((node) => node.el?.remove());
      districtLabels.forEach((label) => label.el.remove());
    },
  };
  window.__atlasCity.api = city;
  return city;
}
