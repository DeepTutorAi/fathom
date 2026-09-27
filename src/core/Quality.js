import { QUALITY_TIERS } from '../config.js';

export function supportsWebGL2() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const supported = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return supported;
  } catch {
    return false;
  }
}

/**
 * Chooses a quality tier from coarse device signals. Touch-first small screens and
 * low core / memory counts get the reduced budget; everything else gets the full one.
 */
export function detectQuality() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const hover = window.matchMedia('(hover: hover)').matches;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 820;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const low = (coarse && smallScreen) || cores <= 4 || memory <= 4;
  const tier = low ? 'low' : 'high';
  return {
    tier,
    isTouch: coarse && !hover,
    ...QUALITY_TIERS[tier],
  };
}

/** Live view of prefers-reduced-motion; notifies subscribers when the OS setting changes. */
export class MotionPreference {
  constructor() {
    this.query = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.query.matches;
    this.listeners = new Set();
    this.onChange = (event) => {
      this.reduced = event.matches;
      document.documentElement.classList.toggle('reduced-motion', this.reduced);
      this.listeners.forEach((listener) => listener(this.reduced));
    };
    this.query.addEventListener('change', this.onChange);
    document.documentElement.classList.toggle('reduced-motion', this.reduced);
  }

  /** Scales ambient animation speed; interaction feedback stays intact. */
  get timeScale() {
    return this.reduced ? 0.45 : 1;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.query.removeEventListener('change', this.onChange);
    this.listeners.clear();
  }
}
