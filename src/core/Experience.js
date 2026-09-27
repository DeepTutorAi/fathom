import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { CameraRig } from './CameraRig.js';
import { ScrollController } from './ScrollController.js';
import { Pointer } from './Pointer.js';
import { HoverSystem } from '../interaction/HoverSystem.js';
import { SoundEngine } from '../audio/SoundEngine.js';
import { Ocean } from '../world/Ocean.js';
import { Surface } from '../world/Surface.js';
import { LightShafts } from '../world/LightShafts.js';
import { MarineSnow } from '../world/MarineSnow.js';
import { Bubbles } from '../world/Bubbles.js';
import { DepthMarkers } from '../world/DepthMarkers.js';
import { FishSchool, createFishGeometry } from '../world/FishSchool.js';
import { Jellyfish, disposeJellyGeometry } from '../world/Jellyfish.js';
import { Siphonophore } from '../world/Siphonophore.js';
import { CombJelly } from '../world/CombJelly.js';
import { Plankton } from '../world/Plankton.js';
import { Structure } from '../world/Structure.js';
import { Narrative } from '../ui/Narrative.js';
import { Hud } from '../ui/Hud.js';
import { Cursor } from '../ui/Cursor.js';
import { Emitter } from '../utils/Emitter.js';
import { bump, clamp, lerp, smoothstep } from '../utils/math.js';
import { createGlowTexture, disposeObject } from '../utils/resources.js';

/** Yields so the loader can paint; the timeout keeps building in background tabs where rAF is paused. */
const nextFrame = () =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 60);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

const LABELS = {
  atolla: { title: 'Atolla jellyfish', meta: 'Atolla wyvillei · 1,000–4,000 m · Alarm display', pitch: 740 },
  siphonophore: { title: 'Siphonophore', meta: 'A colony acting as one animal · Physonectae', pitch: 523 },
  ctenophore: { title: 'Comb jelly', meta: 'Ctenophora · Rainbow from cilia, blue light from within', pitch: 880 },
};

/**
 * Orchestrates the piece: builds the world in measurable steps, then runs one frame loop that
 * feeds scroll, pointer and time into the camera, creatures, typography, HUD and sound.
 */
export class Experience {
  constructor({ canvas, quality, motion, dom, onFatal }) {
    this.quality = quality;
    this.motion = motion;
    this.dom = dom;
    this.bus = new Emitter();
    this.scene = new THREE.Scene();
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.animTime = 0;
    this.started = false;
    this.introStart = 0;
    this.components = [];
    this.schools = [];
    this.jellies = [];
    this.size = null;
    this.projected = new THREE.Vector3();
    this.anchorScreen = { x: 0, y: 0 };
    this.tapPoint = new THREE.Vector3();

    this.renderer = new Renderer({
      canvas,
      quality,
      onContextLost: () => {
        this.dispose();
        onFatal('The display was interrupted. Reload to continue the descent.');
      },
    });
    this.rig = new CameraRig({ motion });
    this.scroll = new ScrollController({ motion });
    this.pointer = new Pointer();
    this.hover = new HoverSystem({ bus: this.bus });
    this.sound = new SoundEngine(this.bus);
    this.narrative = new Narrative({ root: dom.story, motion });
    this.hud = new Hud(dom.hud);
    this.cursor = new Cursor(dom.cursor, { isTouch: quality.isTouch });
    this.glowTexture = createGlowTexture();

    this.renderer.onResize((size) => {
      this.size = size;
      this.rig.resize(size);
      this.components.forEach((component) => component.resize?.(size, this.rig.camera));
    });

    this.frame = this.frame.bind(this);
    this.bindInteractions();
  }

  async init(onProgress) {
    const steps = [
      ['Setting type', () => this.loadFonts()],
      ['Filling the water column', () => this.buildWater()],
      ['Releasing the shoals', () => this.buildFish()],
      ['Growing jellyfish', () => this.buildJellies()],
      ['Kindling the deep', () => this.buildDeepLife()],
      ['Raising the structure', () => this.buildStructure()],
      ['Compiling shaders', () => this.warmUp()],
    ];
    for (let i = 0; i < steps.length; i++) {
      const [label, run] = steps[i];
      onProgress(i / steps.length, label);
      await nextFrame();
      await run();
    }
    onProgress(1, 'Ready');
  }

  loadFonts() {
    if (!document.fonts?.load) return Promise.resolve();
    const faces = ['400 250px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '400 30px "IBM Plex Mono"'];
    // Typography is progressive: if the font service is slow or offline, fallbacks are used.
    return withTimeout(Promise.allSettled(faces.map((face) => document.fonts.load(face))), 3500);
  }

  add(component) {
    this.components.push(component);
    this.scene.add(component.object);
    if (this.size) component.resize?.(this.size, this.rig.camera);
    return component;
  }

  buildWater() {
    this.renderer.setup(this.scene, this.rig.camera);
    this.ocean = new Ocean(this.scene);
    const ocean = this.ocean;
    this.add(new Surface({ ocean }));
    this.add(new LightShafts({ ocean, camera: this.rig, count: this.quality.shafts }));
    this.add(new MarineSnow({ ocean, count: this.quality.snow }));
    this.bubbles = this.add(new Bubbles({ count: 180 }));
    this.add(new DepthMarkers({ camera: this.rig }));
  }

  buildFish() {
    const ocean = this.ocean;
    const place = (p, ahead, side, rise) => this.rig.placeAt(p, ahead, side, rise);
    const n = (count) => Math.max(16, Math.round(count * this.quality.fishScale));
    const geometry = createFishGeometry();
    const specs = [
      { count: n(70), center: place(0.045, 30, 7, -2), extents: [12, 3.5, 9], size: [0.5, 0.75], speed: 1.3, back: '#2d5266', belly: '#e1f1f4', silver: 1, range: [0, 0.2] },
      { count: n(50), center: place(0.125, 34, -12, 3), extents: [10, 3, 8], size: [0.6, 0.9], speed: 1.1, back: '#2a4a5e', belly: '#d2e6ea', silver: 1, range: [0.03, 0.27] },
      { count: n(300), center: place(0.285, 4, 0, 0), extents: [15, 10, 15], size: [0.85, 1.25], speed: 1.6, back: '#1b3850', belly: '#b9d3dd', silver: 0.85, range: [0.18, 0.42] },
      { count: n(120), center: place(0.43, 20, 9, 0), extents: [16, 6, 12], size: [0.55, 0.8], speed: 1, back: '#122230', belly: '#5d707c', silver: 0.45, photophores: 1, range: [0.33, 0.6] },
    ];
    specs.forEach((spec, i) => {
      const school = new FishSchool({
        ...spec,
        ocean,
        geometry,
        extents: new THREE.Vector3(...spec.extents),
        seed: i + 1,
      });
      this.schools.push(this.add(school));
    });
    // Each school owns a clone; the template was never uploaded to the GPU.
    geometry.dispose();
  }

  buildJellies() {
    const specs = [
      { p: 0.19, ahead: 24, side: 9, rise: 2, size: 1.6, color: '#cfc2ff' },
      { p: 0.24, ahead: 30, side: -11, rise: -1, size: 2.3, color: '#c7b6ff' },
      { p: 0.3, ahead: 20, side: 12, rise: 3, size: 1.3, color: '#d9c4ff' },
      { p: 0.345, ahead: 26, side: -7, rise: -3, size: 2.8, color: '#e2b3f0' },
      { p: 0.4, ahead: 34, side: 14, rise: 0, size: 2, color: '#f0b0d8' },
      { p: 0.45, ahead: 22, side: -12, rise: 2, size: 1.7, color: '#ffa9c8' },
      { p: 0.49, ahead: 30, side: 6, rise: -2, size: 2.4, color: '#ff9fbf' },
    ];
    specs.forEach((spec, i) => {
      const jelly = new Jellyfish({
        ocean: this.ocean,
        glowTexture: this.glowTexture,
        position: this.rig.placeAt(spec.p, spec.ahead, spec.side, spec.rise),
        size: spec.size,
        color: spec.color,
        opacity: 0.85,
        tentacleLength: 3.4,
        range: [spec.p - 0.13, spec.p + 0.12],
        seed: 100 + i,
        segments: this.quality.tentacleSegments,
      });
      this.jellies.push(this.add(jelly));
    });
  }

  buildDeepLife() {
    const ocean = this.ocean;
    const glowTexture = this.glowTexture;
    const place = (p, ahead, side, rise) => this.rig.placeAt(p, ahead, side, rise);
    const register = (component) => {
      this.add(component);
      this.hover.add(component);
    };

    [
      { p: 0.575, ahead: 18, side: -8, rise: 1, size: 1.8 },
      { p: 0.665, ahead: 22, side: 9, rise: -2, size: 2.2 },
      { p: 0.745, ahead: 16, side: -4, rise: 2, size: 1.6 },
    ].forEach((spec, i) =>
      register(
        new Jellyfish({
          ocean,
          glowTexture,
          position: place(spec.p, spec.ahead, spec.side, spec.rise),
          size: spec.size,
          color: '#5c1020',
          glowColor: '#3f8cff',
          bellHeight: 0.42,
          opacity: 0.6,
          tentacleLength: 2.4,
          bioluminescent: true,
          range: [spec.p - 0.12, spec.p + 0.1],
          seed: 200 + i,
          segments: this.quality.tentacleSegments,
          label: LABELS.atolla,
        }),
      ),
    );

    [
      { p: 0.61, ahead: 30, side: 11, rise: 4, length: 24, units: 42, heading: 0.6, color: '#8fb9ff' },
      { p: 0.72, ahead: 28, side: -13, rise: -3, length: 30, units: 52, heading: -0.4, color: '#b69cff' },
    ].forEach((spec) =>
      register(
        new Siphonophore({
          ocean,
          glowTexture,
          position: place(spec.p, spec.ahead, spec.side, spec.rise),
          heading: spec.heading,
          length: spec.length,
          units: spec.units,
          color: spec.color,
          range: [spec.p - 0.12, spec.p + 0.1],
          label: LABELS.siphonophore,
        }),
      ),
    );

    [
      { p: 0.545, ahead: 14, side: 6, rise: 1, size: 1.1 },
      { p: 0.595, ahead: 20, side: -10, rise: -2, size: 1.4 },
      { p: 0.635, ahead: 12, side: -3, rise: 3, size: 0.9 },
      { p: 0.69, ahead: 18, side: 7, rise: 0, size: 1.3 },
      { p: 0.775, ahead: 20, side: 10, rise: 2, size: 1.2 },
    ].forEach((spec, i) =>
      register(
        new CombJelly({
          ocean,
          glowTexture,
          position: place(spec.p, spec.ahead, spec.side, spec.rise),
          size: spec.size,
          range: [spec.p - 0.11, spec.p + 0.09],
          seed: 400 + i,
          label: LABELS.ctenophore,
        }),
      ),
    );

    this.plankton = this.add(new Plankton({ ocean, camera: this.rig, count: this.quality.plankton }));
  }

  buildStructure() {
    this.structure = new Structure({
      ocean: this.ocean,
      glowTexture: this.glowTexture,
      segments: this.quality.seabedSegments,
      motion: this.motion,
    });
    this.add(this.structure);
    this.hover.add(this.structure);
    this.structure.onWave((strength) => this.bus.emit('awaken', strength));
  }

  async warmUp() {
    this.components.forEach((component) => (component.object.visible = true));
    this.rig.update({ progress: 0, time: 0, pointer: this.pointer, scrollVelocity: 0 });
    await this.renderer.compile();
    this.scroll.reset();
    // One full frame through the post chain compiles the pass shaders before the reveal.
    this.frame(performance.now());
  }

  bindInteractions() {
    this.scroll.onFirstScroll(() => document.documentElement.classList.add('has-scrolled'));
    this.hud.onZoneChange(() => this.bus.emit('zone'));

    this.pointer.onTap(({ x, y, type }) => {
      if (!this.started) return;
      const camera = this.rig.camera;
      this.pointer.raycaster.setFromCamera(this.pointer.ndc, camera);
      const ray = this.pointer.ray;
      const item = this.hover.pick(ray);
      const time = this.animTime;

      if (item && type !== 'mouse') {
        clearTimeout(this.touchTimer);
        this.touchItem?.setHovered(false);
        this.touchItem = item;
        item.setHovered(true);
        this.bus.emit('hover', item);
        this.cursor.showAt(item, x, y, this.timer.getElapsed());
        this.touchTimer = setTimeout(() => {
          item.setHovered(false);
          this.touchItem = null;
        }, 2800);
      }
      if (item === this.structure) this.structure.emitWave(time, 0.7);

      ray.at(18, this.tapPoint);
      this.plankton.pulse(this.tapPoint, time, 1);
      this.schools.forEach((school) => school.scare(time));
      if (this.scroll.progress < 0.38 && !this.motion.reduced) {
        this.bubbles.burst(ray.at(9, this.tapPoint), 14, 0.5);
      }
      this.bus.emit('pulse');
    });

    this.handleAscend = () => this.scroll.ascend();
    this.dom.ascend.addEventListener('click', this.handleAscend);

    this.handleSoundToggle = async () => {
      if (this.sound.enabled) this.sound.disable();
      else await this.enableSound();
      this.syncSoundToggle();
    };
    this.dom.soundToggle.addEventListener('click', this.handleSoundToggle);
  }

  async enableSound() {
    try {
      await this.sound.enable();
    } catch (error) {
      console.warn('Sound could not start:', error);
    }
  }

  syncSoundToggle() {
    const on = this.sound.enabled;
    this.dom.soundToggle.setAttribute('aria-pressed', String(on));
    this.dom.soundToggle.querySelector('.sound-toggle__label').textContent = on ? 'Sound on' : 'Sound off';
  }

  async start({ sound }) {
    this.started = true;
    this.introStart = this.timer.getElapsed();
    this.renderer.armGovernor(6, this.introStart);
    document.documentElement.classList.add('is-ready', 'is-started');
    if (!this.motion.reduced) {
      const origin = this.rig.camera.position.clone().add(new THREE.Vector3(0, -3, -7));
      this.bubbles.burst(origin, 150, 3.5);
    }
    this.renderer.renderer.setAnimationLoop(this.frame);
    if (sound) await this.enableSound();
    this.syncSoundToggle();
  }

  frame(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    const clock = this.timer.getElapsed();
    const reduced = this.motion.reduced;
    const timeScale = this.motion.timeScale;
    this.animTime += dt * timeScale;
    const time = this.animTime;
    const camera = this.rig.camera;
    const pointer = this.pointer;

    const introElapsed = this.started ? clock - this.introStart : 0;
    this.rig.intro = this.started ? clamp(introElapsed / (reduced ? 0.6 : 5.5)) : 0;

    const progress = this.scroll.update(dt);
    pointer.update(dt);
    this.rig.update({ progress, time, pointer, scrollVelocity: this.scroll.velocity });
    pointer.raycaster.setFromCamera(pointer.ndc, camera);

    this.ocean.update({
      progress,
      time,
      camera,
      coreGlow: this.structure.coreGlow * smoothstep(0.7, 0.9, progress) * 0.35,
    });

    const ctx = { dt, time, progress, camera, pointer, timeScale, reduced, scrollVelocity: this.scroll.velocity };
    let panic = 0;
    for (const component of this.components) {
      const [from, to] = component.range;
      const visible = progress >= from - 0.02 && progress <= to + 0.02;
      component.object.visible = visible;
      if (visible) component.update?.(ctx);
    }
    for (const school of this.schools) {
      if (school.object.visible) panic = Math.max(panic, school.panicLevel);
    }
    if (panic > 0.04 && pointer.speed > 250) this.bus.emit('scatter', panic * 8);

    if (pointer.active) {
      for (const jelly of this.jellies) {
        if (!jelly.object.visible) continue;
        if (pointer.ray.distanceSqToPoint(jelly.object.position) < (jelly.size * 2.4) ** 2) jelly.disturb(1);
      }
    }

    const hovered = this.cursor.enabled ? this.hover.update({ pointer, time: clock }) : this.cursor.item;
    if (this.cursor.enabled) this.cursor.setItem(hovered);
    let anchorScreen = null;
    if (hovered) {
      this.projected.copy(hovered.anchor()).project(camera);
      this.anchorScreen.x = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
      this.anchorScreen.y = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;
      anchorScreen = this.anchorScreen;
    }
    this.cursor.update({ dt, now: clock, pointer, anchorScreen });
    this.narrative.update({ progress, pointer, intro: this.rig.intro });
    this.hud.update(progress);
    this.sound.setState({ progress, coreGlow: this.structure.coreGlow, now: clock });

    const finish = this.renderer.finish;
    finish.uTime.value = clock;
    finish.uVignette.value = lerp(0.7, 1, smoothstep(0.1, 0.6, progress));
    finish.uIris.value = bump(progress, 0.482, 0.512, 0.522, 0.565) * (reduced ? 0.55 : 0.94);
    finish.uFlash.value = this.started && !reduced ? Math.max(0, 1 - introElapsed / 2.4) ** 2 * 0.85 : 0;
    this.renderer.renderer.toneMappingExposure = this.ocean.state.exposure;
    // Sunlit water blooms softly; the dark zones get the full glow for bioluminescence.
    this.renderer.bloomPass.strength = lerp(0.3, 0.95, smoothstep(0.3, 0.6, progress));

    this.renderer.render(dt);
    this.renderer.sampleFrame(dt, clock);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.renderer.setAnimationLoop(null);
    clearTimeout(this.touchTimer);
    this.dom.ascend.removeEventListener('click', this.handleAscend);
    this.dom.soundToggle.removeEventListener('click', this.handleSoundToggle);
    const keep = new Set([this.glowTexture]);
    for (const component of this.components) {
      this.scene.remove(component.object);
      component.dispose?.();
      disposeObject(component.object, { keepTextures: keep });
    }
    this.components = [];
    disposeJellyGeometry();
    this.glowTexture.dispose();
    this.ocean?.dispose();
    this.sound.dispose();
    this.pointer.dispose();
    this.scroll.dispose();
    this.hud.dispose();
    this.cursor.dispose();
    this.bus.clear();
    this.timer.dispose();
    this.renderer.dispose();
  }
}
