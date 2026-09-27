import { clamp, damp } from '../utils/math.js';

/**
 * Custom cursor: an exact dot plus a trailing ring with inertia and velocity stretch.
 * When a creature is hovered the ring blooms and a field-guide label appears with a
 * leader line pinned to the animal. On touch devices only the label is used.
 */
export class Cursor {
  constructor(root, { isTouch }) {
    this.root = root;
    this.dot = root.querySelector('.cursor__dot');
    this.ring = root.querySelector('.cursor__ring');
    this.label = root.querySelector('.cursor__label');
    this.title = root.querySelector('.cursor__title');
    this.meta = root.querySelector('.cursor__meta');
    this.line = root.querySelector('.cursor__leader line');
    this.isTouch = isTouch;
    this.enabled = !isTouch && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.ringPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.labelPos = { x: 0, y: 0 };
    this.scale = 1;
    this.item = null;
    this.touchUntil = 0;

    document.documentElement.classList.toggle('has-cursor', this.enabled);
    root.classList.toggle('is-touch', !this.enabled);
  }

  setItem(item) {
    if (item === this.item) return;
    this.item = item;
    this.root.classList.toggle('is-hover', Boolean(item));
    this.root.classList.toggle('is-relic', item?.label?.tone === 'relic');
    if (item) {
      this.title.textContent = item.label.title;
      this.meta.textContent = item.label.meta;
    }
  }

  /** Touch: pins the label near the tap for a few seconds. */
  showAt(item, x, y, now) {
    this.setItem(item);
    this.labelPos.x = x;
    this.labelPos.y = y;
    this.touchUntil = now + 3.2;
  }

  update({ dt, now, pointer, anchorScreen }) {
    const target = pointer.screen;
    const labelled = Boolean(this.item) && (this.enabled ? pointer.active : now < this.touchUntil);
    this.root.classList.toggle('is-labelled', labelled);

    if (!this.enabled) {
      if (!labelled && this.item && now >= this.touchUntil) this.setItem(null);
      if (labelled) this.placeLabel(this.labelPos.x + 16, this.labelPos.y - 64, anchorScreen);
      return;
    }

    this.root.classList.toggle('is-hidden', !pointer.active);
    this.root.classList.toggle('is-ui', pointer.overUI);

    const px = this.ringPos.x;
    const py = this.ringPos.y;
    this.ringPos.x = damp(px, target.x, 14, dt);
    this.ringPos.y = damp(py, target.y, 14, dt);
    const vx = (this.ringPos.x - px) / Math.max(dt, 1e-4);
    const vy = (this.ringPos.y - py) / Math.max(dt, 1e-4);
    const speed = Math.hypot(vx, vy);
    const stretch = 1 + clamp(speed / 2600, 0, 0.35);
    const angle = Math.atan2(vy, vx);

    const goal = this.item ? 1.9 : pointer.overUI ? 1.45 : pointer.pressed ? 0.72 : 1;
    this.scale = damp(this.scale, goal, 10, dt);

    this.dot.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
    this.ring.style.transform =
      `translate3d(${this.ringPos.x}px, ${this.ringPos.y}px, 0) rotate(${angle}rad) ` +
      `scale(${(this.scale * stretch).toFixed(3)}, ${(this.scale / stretch).toFixed(3)})`;

    if (labelled) this.placeLabel(this.ringPos.x + 40, this.ringPos.y - 20, anchorScreen);
  }

  placeLabel(x, y, anchorScreen) {
    const width = this.label.offsetWidth;
    const lx = clamp(x, 16, window.innerWidth - width - 16);
    const ly = clamp(y, 16, window.innerHeight - 80);
    this.label.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
    if (anchorScreen) {
      this.line.setAttribute('x1', String(lx - 6));
      this.line.setAttribute('y1', String(ly + 12));
      this.line.setAttribute('x2', anchorScreen.x.toFixed(1));
      this.line.setAttribute('y2', anchorScreen.y.toFixed(1));
    }
  }

  dispose() {
    document.documentElement.classList.remove('has-cursor');
  }
}
