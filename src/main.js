import './styles.css';
import { MotionPreference, detectQuality, supportsWebGL2 } from './core/Quality.js';
import { Experience } from './core/Experience.js';
import { Loader } from './ui/Loader.js';

const root = document.documentElement;

function showNotice(message) {
  const notice = document.querySelector('.notice');
  notice.querySelector('.notice__text').textContent = message;
  notice.hidden = false;
  notice.querySelector('[data-reload]').addEventListener('click', () => window.location.reload(), { once: true });
}

/** Without WebGL2 the story still reads as a plain scrolling page over a depth gradient. */
function useFallback() {
  root.classList.remove('is-webgl', 'has-cursor');
  root.classList.add('no-webgl');
}

async function boot() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  if (!supportsWebGL2()) {
    useFallback();
    return;
  }

  root.classList.add('is-webgl');
  const quality = detectQuality();
  const motion = new MotionPreference();
  const loader = new Loader(document.querySelector('.loader'));

  let experience;
  try {
    experience = new Experience({
      canvas: document.querySelector('.stage'),
      quality,
      motion,
      dom: {
        story: document.querySelector('.story'),
        hud: document.querySelector('.hud'),
        cursor: document.querySelector('.cursor'),
        soundToggle: document.querySelector('.sound-toggle'),
        ascend: document.querySelector('[data-ascend]'),
      },
      onFatal: showNotice,
    });
    await experience.init((value, label) => loader.setProgress(value, label));
  } catch (error) {
    console.error('Fathom failed to initialise:', error);
    experience?.dispose();
    loader.dispose();
    useFallback();
    return;
  }

  const choice = await loader.waitForEntry();
  // The click is the user gesture that allows audio to start; the overlay leaves in parallel.
  experience.start({ sound: choice === 'sound' });
  await loader.leave();
  loader.dispose();
}

boot();
