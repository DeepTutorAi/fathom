import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { NOISE } from '../world/glsl.js';

/** Final display-space grade: lens aberration, vignette, iris transition, flash and film grain. */
const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: 0.85 },
    uIris: { value: 0 },
    uFlash: { value: 0 },
    uGrain: { value: 0.024 },
    uAberration: { value: 0.012 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uVignette;
    uniform float uIris;
    uniform float uFlash;
    uniform float uGrain;
    uniform float uAberration;
    varying vec2 vUv;
    ${NOISE}
    void main() {
      vec2 centered = vUv - 0.5;
      float aspect = uResolution.x / uResolution.y;
      float r = length(centered * vec2(aspect, 1.0));

      vec2 shift = centered * dot(centered, centered) * uAberration;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + shift).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - shift).b
      );

      col *= mix(1.0, smoothstep(1.3, 0.2, r), uVignette);

      float irisRadius = mix(1.5, 0.0, uIris);
      col *= smoothstep(irisRadius, irisRadius - 0.45, r);

      col = mix(col, vec3(0.93, 0.98, 1.0), uFlash);

      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float grain = hash21(floor(vUv * uResolution) + fract(uTime * 7.31) * 113.0) - 0.5;
      col += grain * uGrain * (1.0 - luma * 0.6);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  constructor({ canvas, quality, onContextLost }) {
    this.quality = quality;
    this.canvas = canvas;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
    this.sizeListeners = new Set();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x02070d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.handleContextLost = (event) => {
      event.preventDefault();
      onContextLost?.();
    };
    canvas.addEventListener('webglcontextlost', this.handleContextLost);

    // Governs adaptive resolution: samples frame time and steps quality down when the device struggles.
    this.governor = { samples: 0, total: 0, armedAt: Infinity };
  }

  /** Builds the post-processing chain once the scene and camera exist. */
  setup(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.quality.msaa,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.62, 0.72);
    this.bloomPass.enabled = this.quality.bloom;
    this.outputPass = new OutputPass();
    this.finishPass = new ShaderPass(FinishShader);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.finishPass);

    this.finish = this.finishPass.uniforms;
    this.handleResize = () => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.resize());
    };
    window.addEventListener('resize', this.handleResize);
    this.resize();
  }

  onResize(listener) {
    this.sizeListeners.add(listener);
    return () => this.sizeListeners.delete(listener);
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.finish.uResolution.value.set(width * this.pixelRatio, height * this.pixelRatio);
    this.sizeListeners.forEach((listener) => listener({ width, height, pixelRatio: this.pixelRatio }));
  }

  /** Starts measuring performance after shader warm-up and the intro settle. */
  armGovernor(delaySeconds, now) {
    this.governor.armedAt = now + delaySeconds;
  }

  sampleFrame(dt, now) {
    const g = this.governor;
    if (now < g.armedAt || dt > 0.25) return;
    g.samples += 1;
    g.total += dt;
    if (g.samples < 120) return;
    const average = g.total / g.samples;
    g.samples = 0;
    g.total = 0;
    if (average < 1 / 40) return;
    if (this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.resize();
    } else if (this.bloomPass.enabled) {
      this.bloomPass.enabled = false;
    }
  }

  async compile() {
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    cancelAnimationFrame(this.resizeFrame);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.sizeListeners.clear();
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.finishPass?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
