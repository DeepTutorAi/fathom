import * as THREE from 'three';
import { FOG_FADE } from './glsl.js';
import { createRandom } from '../utils/math.js';

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aExcite;
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vExcite;
  varying float vFade;
  ${FOG_FADE}

  void main() {
    vec3 p = position;
    p += vec3(sin(uTime * 0.3 + aSeed * 50.0), sin(uTime * 0.23 + aSeed * 31.0), cos(uTime * 0.27 + aSeed * 17.0)) * 0.35;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = -mvPosition.z;
    vExcite = aExcite;
    vFade = fogFade(dist, 0.35) * smoothstep(0.5, 2.5, dist);
    gl_PointSize = max(aSize * (0.55 + aExcite * 1.7) * uScale / dist, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uCold;
  uniform vec3 uHot;
  varying float vExcite;
  varying float vFade;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    core *= core;
    vec3 col = mix(uCold, uHot, vExcite);
    float alpha = (0.05 + vExcite * 1.2) * core * vFade;
    gl_FragColor = vec4(col, alpha);
  }
`;

const PULSE_SPEED = 26;
const PULSE_LIFE = 2.6;

/**
 * Dinoflagellate-like bioluminescent plankton. Each particle holds an excitation value on the CPU
 * that spikes when the cursor ray, the moving camera or a pulse wave disturbs the water, then decays.
 */
export class Plankton {
  constructor({ ocean, camera, count }) {
    this.range = [0.44, 1];
    this.ocean = ocean;
    this.count = count;
    this.pulses = [];
    const random = createRandom(97);
    this.random = createRandom(5);

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    this.excite = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const point = camera.placeAt(random.range(0.47, 1), random.range(-4, 62), random.range(-38, 38), random.range(-12, 12));
      positions.set([point.x, point.y, point.z], i * 3);
      sizes[i] = random.range(0.08, 0.2);
      seeds[i] = random();
    }
    this.positions = positions;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.exciteAttribute = new THREE.BufferAttribute(this.excite, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aExcite', this.exciteAttribute);

    this.uniforms = {
      uTime: ocean.uniforms.uTime,
      uFogDensity: ocean.uniforms.uFogDensity,
      uScale: { value: 300 },
      uCold: { value: new THREE.Color('#1c5a8a') },
      uHot: { value: new THREE.Color('#7fe8ff').multiplyScalar(3.2) },
    };
    this.object = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.object.frustumCulled = false;
  }

  resize({ height, pixelRatio }, camera) {
    this.uniforms.uScale.value = (height * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  }

  /** Sends an expanding shell of disturbance through the cloud. */
  pulse(origin, time, strength = 1) {
    this.pulses.push({ origin: origin.clone(), start: time, strength });
    if (this.pulses.length > 6) this.pulses.shift();
  }

  update({ dt, time, pointer, camera, scrollVelocity }) {
    const { positions, excite, count } = this;
    const decay = Math.exp(-dt * 1.35);
    const ray = pointer.ray;
    const cursor = pointer.active;
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const rx = ray.direction.x;
    const ry = ray.direction.y;
    const rz = ray.direction.z;
    const cam = camera.position;
    const wake = Math.min(1, Math.abs(scrollVelocity) * 5);

    this.pulses = this.pulses.filter((pulse) => time - pulse.start < PULSE_LIFE);
    const shells = this.pulses.map((pulse) => ({
      origin: pulse.origin,
      radius: (time - pulse.start) * PULSE_SPEED,
      strength: pulse.strength * (1 - (time - pulse.start) / PULSE_LIFE),
    }));
    const wave = this.ocean.uniforms;
    if (wave.uWaveStrength.value > 0.02) {
      shells.push({ origin: wave.uWaveOrigin.value, radius: wave.uWaveRadius.value, strength: wave.uWaveStrength.value });
    }

    const twinkle = dt * 0.055;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      let e = excite[i] * decay;

      if (cursor) {
        const dx = x - ox;
        const dy = y - oy;
        const dz = z - oz;
        const t = dx * rx + dy * ry + dz * rz;
        if (t > 1.5 && t < 90) {
          const radius = 1.4 + t * 0.06;
          const dist2 = dx * dx + dy * dy + dz * dz - t * t;
          if (dist2 < radius * radius) e = Math.max(e, 1 - Math.sqrt(dist2) / radius);
        }
      }

      if (wake > 0.05) {
        const cx = x - cam.x;
        const cy = y - cam.y;
        const cz = z - cam.z;
        const dist2 = cx * cx + cy * cy + cz * cz;
        if (dist2 < 100) e = Math.max(e, wake * (1 - Math.sqrt(dist2) / 10));
      }

      for (const shell of shells) {
        const sx = x - shell.origin.x;
        const sy = y - shell.origin.y;
        const sz = z - shell.origin.z;
        const gap = Math.abs(Math.sqrt(sx * sx + sy * sy + sz * sz) - shell.radius);
        if (gap < 3) e = Math.max(e, shell.strength * (1 - gap / 3));
      }

      if (this.random() < twinkle) e = Math.max(e, 0.35 + this.random() * 0.4);
      excite[i] = e;
    }
    this.exciteAttribute.needsUpdate = true;
  }
}
