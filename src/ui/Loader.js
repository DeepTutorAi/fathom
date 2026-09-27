import { damp } from '../utils/math.js';

/**
 * Loading overlay styled as a sounding line: the lead drops as real build steps complete.
 * The displayed percentage eases toward the true value, never ahead of it.
 */
export class Loader {
  constructor(root) {
    this.root = root;
    this.sounding = root.querySelector('.loader__sounding');
    this.label = root.querySelector('.loader__label');
    this.pct = root.querySelector('.loader__pct');
    this.actions = root.querySelector('.loader__actions');
    this.target = 0;
    this.shown = 0;
    this.last = performance.now();
    this.tick = (now) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.shown = damp(this.shown, this.target, 6, dt);
      if (this.target - this.shown < 0.002) this.shown = this.target;
      this.sounding.style.setProperty('--p', this.shown.toFixed(4));
      this.pct.textContent = String(Math.round(this.shown * 100));
      if (this.shown < 1 || this.target < 1) this.frame = requestAnimationFrame(this.tick);
      else this.frame = null;
    };
    this.frame = requestAnimationFrame(this.tick);
  }

  setProgress(value, label) {
    this.target = Math.max(this.target, value);
    if (label) this.label.textContent = label;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  /** Waits for the counter to land, then offers the two ways in. Resolves with 'sound' or 'silent'. */
  waitForEntry() {
    return new Promise((resolve) => {
      const reveal = () => {
        if (this.shown < 1) {
          requestAnimationFrame(reveal);
          return;
        }
        this.root.dataset.state = 'ready';
        this.actions.hidden = false;
        const primary = this.actions.querySelector('[data-enter="sound"]');
        primary.focus({ preventScroll: true });
        this.actions.addEventListener('click', (event) => {
          const button = event.target.closest('[data-enter]');
          if (button) resolve(button.dataset.enter);
        });
      };
      reveal();
    });
  }

  leave() {
    this.root.dataset.state = 'leaving';
    this.actions.querySelectorAll('button').forEach((button) => (button.disabled = true));
    return new Promise((resolve) => {
      setTimeout(() => {
        this.root.remove();
        resolve();
      }, 1700);
    });
  }

  fail(message) {
    this.root.dataset.state = 'error';
    this.label.textContent = message;
    this.pct.hidden = true;
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}
