export const TAU = Math.PI * 2;

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const lerp = (a, b, t) => a + (b - a) * t;

export const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Rises over [a, b], holds, falls over [c, d]. */
export const bump = (value, a, b, c, d) => smoothstep(a, b, value) * (1 - smoothstep(c, d, value));

/** Frame-rate independent exponential approach. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Critically damped spring (Game Programming Gems 4, ch. 1.10).
 * Gives momentum-like easing that never overshoots, with an optional speed cap.
 */
export class SmoothDamp {
  constructor(value = 0, smoothTime = 0.5, maxSpeed = Infinity) {
    this.value = value;
    this.velocity = 0;
    this.smoothTime = smoothTime;
    this.maxSpeed = maxSpeed;
  }

  update(target, dt) {
    if (dt <= 0) return this.value;
    const smoothTime = Math.max(0.0001, this.smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const maxChange = this.maxSpeed * smoothTime;
    const change = clamp(this.value - target, -maxChange, maxChange);
    const clampedTarget = this.value - change;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * exp;
    let output = clampedTarget + (change + temp) * exp;
    if (target - this.value > 0 === output > target) {
      output = target;
      this.velocity = 0;
    }
    this.value = output;
    return output;
  }

  jump(value) {
    this.value = value;
    this.velocity = 0;
  }
}

/** Deterministic PRNG so layouts are identical on every load. */
export function createRandom(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (min, max) => min + (max - min) * next();
  next.sign = () => (next() < 0.5 ? -1 : 1);
  return next;
}

/** 2D value noise with a smooth fractal sum, used for CPU-side terrain. */
export function createNoise2D(seed = 1) {
  const random = createRandom(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = random();
  const at = (x, y) => table[((y & (size - 1)) * size + (x & (size - 1))) >>> 0];
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = lerp(at(xi, yi), at(xi + 1, yi), u);
    const b = lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u);
    return lerp(a, b, v);
  };
  noise.fbm = (x, y, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      freq *= 2.03;
      amp *= 0.5;
    }
    return sum;
  };
  return noise;
}
