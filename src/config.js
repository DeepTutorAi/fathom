import { clamp, lerp } from './utils/math.js';

/** Real oceanic depth zones mapped onto scroll progress. */
export const ZONES = [
  { index: 'I', name: 'Epipelagic', start: 0, end: 0.2, metres: [0, 200] },
  { index: 'II', name: 'Mesopelagic', start: 0.2, end: 0.5, metres: [200, 1000] },
  { index: 'III', name: 'Bathypelagic', start: 0.5, end: 0.8, metres: [1000, 4000] },
  { index: 'IV', name: 'Abyssopelagic', start: 0.8, end: 1.0001, metres: [4000, 4800] },
];

export function zoneAt(progress) {
  return ZONES.find((zone) => progress >= zone.start && progress < zone.end) ?? ZONES[ZONES.length - 1];
}

export function progressToMetres(progress) {
  const zone = zoneAt(progress);
  const t = clamp((progress - zone.start) / (Math.min(zone.end, 1) - zone.start));
  return lerp(zone.metres[0], zone.metres[1], t);
}

/** Typical open-ocean temperature profile (°C), used for the telemetry readout. */
const TEMPERATURE_PROFILE = [
  [0, 26],
  [100, 21],
  [200, 15],
  [500, 8],
  [1000, 4.5],
  [2000, 3],
  [4000, 2],
  [4800, 1.6],
];

export function temperatureAt(metres) {
  for (let i = 1; i < TEMPERATURE_PROFILE.length; i++) {
    const [d1, t1] = TEMPERATURE_PROFILE[i];
    const [d0, t0] = TEMPERATURE_PROFILE[i - 1];
    if (metres <= d1) return lerp(t0, t1, (metres - d0) / (d1 - d0));
  }
  return TEMPERATURE_PROFILE[TEMPERATURE_PROFILE.length - 1][1];
}

/** Absolute pressure in atmospheres: 1 atm at the surface plus ~1 atm per 10 m of seawater. */
export const pressureAt = (metres) => 1 + metres / 10.06;

/**
 * Look of the water column. Colours are sRGB hex; values between keys are smoothly interpolated.
 * top/horizon/bottom colour the backdrop, fog uses the horizon colour.
 */
export const PALETTE = [
  { p: 0.0, top: '#9fdff0', horizon: '#1d7ea6', bottom: '#0a3656', fog: 0.0105, sun: 1.0, exposure: 1.0 },
  { p: 0.12, top: '#57bcd8', horizon: '#15668f', bottom: '#072c49', fog: 0.0125, sun: 0.8, exposure: 1.0 },
  { p: 0.24, top: '#1d7aa5', horizon: '#0b456d', bottom: '#041c33', fog: 0.0155, sun: 0.48, exposure: 1.0 },
  { p: 0.36, top: '#0d4c78', horizon: '#073050', bottom: '#021324', fog: 0.018, sun: 0.26, exposure: 1.05 },
  { p: 0.47, top: '#062a47', horizon: '#041b30', bottom: '#010913', fog: 0.021, sun: 0.1, exposure: 1.1 },
  { p: 0.55, top: '#020b16', horizon: '#01060d', bottom: '#000306', fog: 0.024, sun: 0.0, exposure: 1.2 },
  { p: 0.8, top: '#01050b', horizon: '#010409', bottom: '#000204', fog: 0.02, sun: 0.0, exposure: 1.2 },
  { p: 1.0, top: '#030a12', horizon: '#03080e', bottom: '#050504', fog: 0.0125, sun: 0.0, exposure: 1.15 },
];

/** World units the camera travels from the surface to the sea floor. */
export const SEABED_Y = -540;
export const STRUCTURE_CENTER = [0, SEABED_Y, -64];

/**
 * Camera keyframes, evenly spaced in progress (0, 0.1, ... 1).
 * pos is where the lens sits, look is what it frames.
 */
export const CAMERA_PATH = [
  { pos: [0, -11, 30], look: [2, 18, -32] },
  { pos: [5, -52, 22], look: [-2, -56, -40] },
  { pos: [-3, -104, 16], look: [-5, -110, -40] },
  { pos: [-6, -156, 10], look: [1, -162, -40] },
  { pos: [0, -208, 6], look: [5, -213, -40] },
  { pos: [6, -260, 4], look: [0, -266, -40] },
  { pos: [2, -312, 2], look: [-4, -317, -40] },
  { pos: [-4, -364, 0], look: [0, -370, -40] },
  { pos: [-2, -416, -2], look: [0, -432, -48] },
  { pos: [7, -466, -4], look: [0, -500, -58] },
  { pos: [12, -509, -2], look: [0, -529, -62] },
];

/** Per-device budgets. `high` assumes a discrete or recent integrated GPU. */
export const QUALITY_TIERS = {
  high: {
    maxPixelRatio: 1.75,
    msaa: 4,
    bloom: true,
    snow: 2600,
    plankton: 1400,
    fishScale: 1,
    shafts: 10,
    tentacleSegments: 22,
    seabedSegments: 150,
  },
  low: {
    maxPixelRatio: 1.5,
    msaa: 0,
    bloom: false,
    snow: 1100,
    plankton: 650,
    fishScale: 0.45,
    shafts: 6,
    tentacleSegments: 14,
    seabedSegments: 90,
  },
};
