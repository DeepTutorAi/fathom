import { clamp, lerp, smoothstep } from '../utils/math.js';

/**
 * Procedural sound design on the Web Audio API. Nothing is downloaded: ambience, drones and
 * interaction cues are synthesised. The engine only listens to the event bus, so every cue
 * can later be swapped for recorded assets without touching interaction code.
 */
export class SoundEngine {
  constructor(bus) {
    this.bus = bus;
    this.ctx = null;
    this.enabled = false;
    this.lastParamUpdate = 0;
    this.lastScatter = 0;
    this.unsubscribe = [
      bus.on('hover', (item) => item && this.ping(item.label?.pitch ?? 660)),
      bus.on('scatter', (intensity) => this.swish(intensity)),
      bus.on('pulse', () => this.thump()),
      bus.on('zone', () => this.swell()),
      bus.on('awaken', (strength) => this.chord(strength)),
    ];
  }

  build() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio is not supported');
    const ctx = new AudioContextClass();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    this.master.connect(compressor).connect(ctx.destination);

    // Brown-noise water bed; its low-pass closes as the dive deepens.
    this.noise = this.createNoiseBuffer(4, true);
    const bed = ctx.createBufferSource();
    bed.buffer = this.noise;
    bed.loop = true;
    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'lowpass';
    this.bedFilter.frequency.value = 1200;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0.32;
    bed.connect(this.bedFilter).connect(this.bedGain).connect(this.master);
    bed.start();

    // Pressure drone: an open fifth that swells with depth.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 320;
    this.droneGain.connect(droneFilter).connect(this.master);
    for (const [freq, detune] of [[49, -4], [73.4, 3], [98, 6]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(this.droneGain);
      osc.start();
    }

    // Structure hum with slow tremolo, faded in by the core's glow.
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const hum = ctx.createOscillator();
    hum.type = 'triangle';
    hum.frequency.value = 110;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 420;
    const tremolo = ctx.createGain();
    tremolo.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.22;
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(tremolo.gain);
    hum.connect(humFilter).connect(tremolo).connect(this.humGain).connect(this.master);
    hum.start();
    lfo.start();

    // Shared space for cues: a damped feedback delay.
    this.fxSend = ctx.createGain();
    this.fxSend.gain.value = 0.5;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.37;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const damping = ctx.createBiquadFilter();
    damping.type = 'lowpass';
    damping.frequency.value = 1800;
    this.fxSend.connect(delay).connect(damping).connect(feedback).connect(delay);
    damping.connect(this.master);
  }

  createNoiseBuffer(seconds, brown) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  async enable() {
    if (!this.ctx) this.build();
    await this.ctx.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.8);
  }

  disable() {
    this.enabled = false;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      if (!this.enabled) this.ctx.suspend();
    }, 1200);
  }

  /** Continuous parameters, rate-limited to keep automation events sparse. */
  setState({ progress, coreGlow, now }) {
    if (!this.enabled || now - this.lastParamUpdate < 0.1) return;
    this.lastParamUpdate = now;
    const t = this.ctx.currentTime;
    this.bedFilter.frequency.setTargetAtTime(lerp(1300, 150, smoothstep(0, 0.6, progress)), t, 0.4);
    this.bedGain.gain.setTargetAtTime(lerp(0.34, 0.2, progress), t, 0.4);
    this.droneGain.gain.setTargetAtTime(smoothstep(0.3, 0.75, progress) * 0.09, t, 0.6);
    this.humGain.gain.setTargetAtTime(clamp(coreGlow * smoothstep(0.78, 0.95, progress)) * 0.06, t, 0.5);
  }

  envelope(gain, peak, attack, release) {
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return t + attack + release + 0.05;
  }

  ping(frequency) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.connect(this.master);
    gain.connect(this.fxSend);
    const end = this.envelope(gain, 0.09, 0.012, 2.2);
    for (const [ratio, level] of [[1, 1], [2.01, 0.25], [3.02, 0.08]]) {
      const osc = ctx.createOscillator();
      const partial = ctx.createGain();
      osc.frequency.value = frequency * ratio;
      partial.gain.value = level;
      osc.connect(partial).connect(gain);
      osc.start();
      osc.stop(end);
    }
  }

  swish(intensity) {
    const now = performance.now();
    if (!this.enabled || now - this.lastScatter < 450) return;
    this.lastScatter = now;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 2.5;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    const t = ctx.currentTime;
    band.frequency.setValueAtTime(700, t);
    band.frequency.exponentialRampToValueAtTime(2600, t + 0.28);
    const gain = ctx.createGain();
    source.connect(band).connect(gain).connect(this.master);
    const end = this.envelope(gain, 0.05 + clamp(intensity) * 0.12, 0.04, 0.32);
    source.start(t, Math.random() * 2);
    source.stop(end);
  }

  thump() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.6);
    const gain = ctx.createGain();
    osc.connect(gain).connect(this.master);
    gain.connect(this.fxSend);
    const end = this.envelope(gain, 0.3, 0.01, 0.9);
    osc.start(t);
    osc.stop(end);
  }

  swell() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const gain = ctx.createGain();
    source.connect(filter).connect(gain).connect(this.master);
    const end = this.envelope(gain, 0.28, 0.9, 2.6);
    source.start();
    source.stop(end);
  }

  chord(strength = 1) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.connect(this.master);
    gain.connect(this.fxSend);
    const end = this.envelope(gain, 0.12 * strength, 2.2, 7);
    for (const freq of [110, 164.8, 246.9, 330]) {
      for (const detune of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(gain);
        osc.start();
        osc.stop(end);
      }
    }
  }

  dispose() {
    clearTimeout(this.suspendTimer);
    this.unsubscribe.forEach((off) => off());
    this.ctx?.close();
    this.ctx = null;
    this.enabled = false;
  }
}
