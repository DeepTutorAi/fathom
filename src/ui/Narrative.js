import { smoothstep } from '../utils/math.js';

const FADE = 0.035;

/** Splits a heading into staggered units while keeping one accessible label. */
function splitHeading(heading, byLetter) {
  const text = heading.textContent.trim();
  const units = byLetter ? [...text] : text.split(/\s+/);
  heading.setAttribute('aria-label', text);
  const wrapper = document.createElement('span');
  wrapper.setAttribute('aria-hidden', 'true');
  units.forEach((unit, index) => {
    const span = document.createElement('span');
    span.className = 'word';
    span.style.setProperty('--i', String(index));
    span.textContent = unit;
    wrapper.append(span);
    if (!byLetter && index < units.length - 1) wrapper.append(' ');
  });
  heading.replaceChildren(wrapper);
}

/**
 * Chapters live in the DOM for accessibility but behave like planes in the water:
 * each fades in around its depth, drifts upward as the camera sinks, parallaxes against
 * the pointer and racks focus through a blur as it arrives and leaves.
 */
export class Narrative {
  constructor({ root, motion }) {
    this.motion = motion;
    this.chapters = [...root.querySelectorAll('.chapter')].map((el) => {
      const heading = el.querySelector('.chapter__title');
      if (heading) splitHeading(heading, el.classList.contains('chapter--title'));
      return {
        el,
        at: Number(el.dataset.at),
        span: Number(el.dataset.span),
        layer: Number(el.dataset.layer || 1),
        last: { o: -1, y: 0, x: 0, blur: -1 },
      };
    });
  }

  update({ progress, pointer, intro }) {
    const reduced = this.motion.reduced;
    const height = window.innerHeight;
    for (const chapter of this.chapters) {
      const { el, at, span, layer, last } = chapter;
      let o = smoothstep(at - FADE, at, progress) * (1 - smoothstep(at + span, at + span + FADE, progress));
      if (at === 0) o *= smoothstep(0.3, 0.85, intro);

      const idle = o < 0.002;
      el.classList.toggle('is-idle', idle);
      el.classList.toggle('is-active', o > 0.6);
      if (idle && last.o <= 0.002) continue;

      const center = at + Math.min(span, 0.08) / 2;
      const drift = reduced ? 0 : (center - progress) * height * 0.9 * layer;
      const x = reduced ? 0 : -pointer.look.x * 16 * layer;
      const y = drift - (reduced ? 0 : pointer.look.y * 10 * layer);
      const blur = reduced ? 0 : (1 - o) * 9;

      if (Math.abs(o - last.o) > 0.001 || Math.abs(x - last.x) > 0.1 || Math.abs(y - last.y) > 0.1 || Math.abs(blur - last.blur) > 0.05) {
        el.style.setProperty('--o', o.toFixed(3));
        el.style.setProperty('--reveal', o.toFixed(3));
        el.style.setProperty('--x', `${x.toFixed(1)}px`);
        el.style.setProperty('--y', `${y.toFixed(1)}px`);
        el.style.setProperty('--blur', `${blur.toFixed(2)}px`);
        last.o = o;
        last.x = x;
        last.y = y;
        last.blur = blur;
      }
    }
  }
}
