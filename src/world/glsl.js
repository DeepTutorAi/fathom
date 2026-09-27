/** Shared GLSL helpers injected into the custom shaders. */

export const NOISE = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`;

/** Distance fade for additive materials, which cannot use colour fog without brightening the frame. */
export const FOG_FADE = /* glsl */ `
uniform float uFogDensity;
float fogFade(float dist, float strength) {
  float d = uFogDensity * strength * dist;
  return exp(-d * d);
}
`;

/** Ambient water lighting shared by lit creatures. */
export const WATER_LIGHT = /* glsl */ `
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBottom;
uniform vec3 uSunDir;
uniform float uSunIntensity;

vec3 waterLight(vec3 n) {
  vec3 ambient = mix(uAmbientBottom, uAmbientTop, n.y * 0.5 + 0.5);
  float sun = max(dot(n, uSunDir), 0.0) * uSunIntensity;
  return ambient + vec3(0.95, 0.98, 1.0) * sun;
}
`;

/** Jellyfish bell deformation, shared by the bell, its tentacles and its rim lights so they pulse together. */
export const JELLY = /* glsl */ `
uniform float uPulse;
uniform float uBellHeight;
uniform float uTime;

float contraction(float phase) {
  phase = fract(phase);
  return phase < 0.3 ? smoothstep(0.0, 0.3, phase) : 1.0 - smoothstep(0.3, 1.0, phase);
}

vec3 bellShape(vec3 p, float c) {
  float rim = 1.0 - clamp(p.y, 0.0, 1.0);
  float angle = atan(p.z, p.x);
  float radial = 1.0 - c * 0.24 * pow(rim, 1.3);
  radial *= 1.0 + sin(angle * 8.0 + uTime * 1.3) * 0.022 * rim * rim;
  return vec3(p.x * radial, p.y * uBellHeight * (1.0 + c * 0.2), p.z * radial);
}
`;
