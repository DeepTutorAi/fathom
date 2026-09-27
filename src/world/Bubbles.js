import * as THREE from 'three';
import { createRandom } from '../utils/math.js';

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = aAlpha;
    gl_PointSize = max(aSize * uScale / -mvPosition.z, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc);
    float shell = smoothstep(0.5, 0.42, d) * smoothstep(0.22, 0.44, d);
    float glint = smoothstep(0.13, 0.0, length(pc - vec2(-0.16, -0.16)));
    float alpha = (shell * 0.75 + glint + 0.04 * step(d, 0.5)) * vAlpha;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** A pooled stream of rising bubbles for the entry plunge and taps near the surface. */
export class Bubbles {
  constructor({ count }) {
    this.range = [0, 0.42];
    this.count = count;
    this.random = createRandom(3);
    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.state = Array.from({ length: count }, () => ({ life: 0, age: 0, vy: 0, phase: 0, wobble: 0 }));
    this.cursor = 0;

    const geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttribute = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttribute = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('aAlpha', this.alphaAttribute);
    geometry.setAttribute('aSize', this.sizeAttribute);

    this.uniforms = {
      uScale: { value: 300 },
      uColor: { value: new THREE.Color('#e8fbff').multiplyScalar(1.4) },
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
    this.active = 0;
  }

  resize({ height, pixelRatio }, camera) {
    this.uniforms.uScale.value = (height * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  }

  burst(origin, amount, spread) {
    const random = this.random;
    for (let n = 0; n < amount; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const s = this.state[i];
      s.life = random.range(2.5, 5);
      s.age = 0;
      s.vy = random.range(0.5, 2.5);
      s.phase = random() * 6.28;
      s.wobble = random.range(0.4, 1.4);
      this.positions[i * 3] = origin.x + random.range(-spread, spread);
      this.positions[i * 3 + 1] = origin.y + random.range(-spread, spread) * 0.6;
      this.positions[i * 3 + 2] = origin.z + random.range(-spread, spread);
      this.sizes[i] = random.range(0.04, 0.28) * (random() < 0.08 ? 2.2 : 1);
    }
    this.active = this.count;
  }

  update({ dt }) {
    if (!this.active) return;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.state[i];
      if (s.life <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      alive++;
      s.life -= dt;
      s.age += dt;
      // Buoyancy accelerates toward a terminal velocity scaled by bubble size.
      s.vy = Math.min(s.vy + dt * 5, 2 + this.sizes[i] * 22);
      const i3 = i * 3;
      this.positions[i3] += Math.sin(s.age * 7 * s.wobble + s.phase) * dt * 0.6;
      this.positions[i3 + 1] += s.vy * dt;
      this.positions[i3 + 2] += Math.cos(s.age * 6 * s.wobble + s.phase) * dt * 0.6;
      if (this.positions[i3 + 1] > -0.3) s.life = 0;
      this.alphas[i] = Math.max(0, Math.min(1, s.life * 1.5)) * Math.min(1, s.age * 8);
    }
    this.active = alive;
    this.positionAttribute.needsUpdate = true;
    this.alphaAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
  }
}
