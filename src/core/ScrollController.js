import { SmoothDamp, clamp } from '../utils/math.js';

/**
 * Maps native document scroll to a 0..1 dive progress, then smooths it with a
 * critically damped spring so the camera carries momentum. Native scrolling is kept
 * so keyboard, scrollbar and assistive technology continue to work.
 */
export class ScrollController {
  constructor({ motion }) {
    this.motion = motion;
    this.target = 0;
    this.spring = new SmoothDamp(0, 0.6, 0.32);
    this.hasScrolled = false;
    this.listeners = new Set();

    this.measure = () => {
      this.max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      this.read();
    };
    this.read = () => {
      this.target = clamp(window.scrollY / this.max);
      if (!this.hasScrolled && window.scrollY > 4) {
        this.hasScrolled = true;
        this.listeners.forEach((listener) => listener());
      }
    };

    this.applyMotion(motion.reduced);
    this.unsubscribeMotion = motion.subscribe((reduced) => this.applyMotion(reduced));

    window.addEventListener('scroll', this.read, { passive: true });
    window.addEventListener('resize', this.measure);
    this.measure();
  }

  applyMotion(reduced) {
    // Reduced motion follows the scrollbar almost directly instead of gliding.
    this.spring.smoothTime = reduced ? 0.08 : 0.6;
    this.spring.maxSpeed = reduced ? Infinity : 0.32;
  }

  onFirstScroll(listener) {
    this.listeners.add(listener);
  }

  get progress() {
    return this.spring.value;
  }

  /** Signed progress per second, used for camera banking and plankton turbulence. */
  get velocity() {
    return this.spring.velocity;
  }

  update(dt) {
    return this.spring.update(this.target, dt);
  }

  /** Returns to the surface; the spring turns the jump into a paced ascent. */
  ascend() {
    this.spring.maxSpeed = this.motion.reduced ? Infinity : 0.45;
    window.scrollTo({ top: 0, behavior: 'instant' });
    this.read();
    clearTimeout(this.ascendTimer);
    this.ascendTimer = setTimeout(() => this.applyMotion(this.motion.reduced), 4000);
  }

  reset() {
    window.scrollTo({ top: 0, behavior: 'instant' });
    this.read();
    this.spring.jump(this.target);
  }

  dispose() {
    clearTimeout(this.ascendTimer);
    this.unsubscribeMotion();
    this.listeners.clear();
    window.removeEventListener('scroll', this.read);
    window.removeEventListener('resize', this.measure);
  }
}
