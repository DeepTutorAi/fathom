import * as THREE from 'three';
import { FOG_FADE } from './glsl.js';
import { damp } from '../utils/math.js';
import { createGlowSprite, toInstanced } from '../utils/resources.js';

const CHAIN = /* glsl */ `
  uniform float uTime;
  uniform float uLength;
  vec3 chain(float t) {
    return vec3(
      -t * uLength,
      sin(uTime * 0.7 - t * 5.0) * 1.2 * t + sin(uTime * 0.31 - t * 2.0) * 0.8 * t,
      cos(uTime * 0.55 - t * 4.0) * t
    );
  }
`;

const VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aScale;
  varying float vT;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vFade;
  ${CHAIN}
  ${FOG_FADE}

  void main() {
    vec3 p = position * vec3(1.25, 0.8, 0.8) * aScale + chain(aT);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vT = aT;
    vec4 mvPosition = viewMatrix * world;
    vFade = fogFade(-mvPosition.z, 0.4);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBase;
  uniform float uExcite;
  uniform float uPulseHead;
  varying float vT;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vFade;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    float fresnel = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.0);
    float pulseDist = (vT - uPulseHead) * 9.0;
    float pulse = exp(-pulseDist * pulseDist);
    float glow = uBase * (0.25 + fresnel) + uExcite * (0.18 + fresnel * 0.5 + pulse * 2.8);
    gl_FragColor = vec4(uColor * (0.35 + fresnel), glow * vFade);
  }
`;

/** Colonial siphonophore: a long chain of glassy zooids. Hover sends a pulse of light down the colony. */
export class Siphonophore {
  constructor({ ocean, glowTexture, position, heading, length, units, color, range, label }) {
    this.range = range;
    this.label = label;
    this.length = length;
    this.home = position.clone();
    this.heading = heading;
    this.excite = 0;
    this.hovered = false;
    this.pulseHead = -0.2;

    const base = new THREE.SphereGeometry(0.5, 14, 10);
    const geometry = toInstanced(base, units);
    const t = new Float32Array(units);
    const scale = new Float32Array(units);
    for (let i = 0; i < units; i++) {
      t[i] = i / (units - 1);
      scale[i] = i === 0 ? 1.5 : i < units * 0.18 ? 1.05 : 0.72 - t[i] * 0.35;
    }
    geometry.setAttribute('aT', new THREE.InstancedBufferAttribute(t, 1));
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));

    this.uniforms = {
      uTime: ocean.uniforms.uTime,
      uFogDensity: ocean.uniforms.uFogDensity,
      uLength: { value: length },
      uColor: { value: new THREE.Color(color).multiplyScalar(2.2) },
      uBase: { value: 0.24 },
      uExcite: { value: 0 },
      uPulseHead: { value: -0.2 },
    };
    const mesh = new THREE.Mesh(
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
    mesh.frustumCulled = false;

    this.object = new THREE.Group();
    this.object.position.copy(position);
    this.object.rotation.y = heading;
    this.object.add(mesh);

    this.halo = createGlowSprite(glowTexture, new THREE.Color(color), 7);
    this.halo.material.opacity = 0;
    this.object.add(this.halo);

    const sampleCount = Math.ceil(length / 2.5) + 1;
    this.samples = Array.from({ length: sampleCount }, (_, i) => ({
      t: i / (sampleCount - 1),
      sphere: new THREE.Sphere(new THREE.Vector3(), 2),
    }));
    this.hitPoint = new THREE.Vector3();
    this.anchorPoint = new THREE.Vector3();
  }

  chainPoint(t, time, out) {
    const L = this.length;
    return out.set(
      -t * L,
      Math.sin(time * 0.7 - t * 5) * 1.2 * t + Math.sin(time * 0.31 - t * 2) * 0.8 * t,
      Math.cos(time * 0.55 - t * 4) * t,
    );
  }

  hitTest(ray) {
    let nearest = null;
    for (const sample of this.samples) {
      if (ray.intersectSphere(sample.sphere, this.hitPoint)) {
        const distance = ray.origin.distanceTo(this.hitPoint);
        if (nearest === null || distance < nearest) nearest = distance;
      }
    }
    return nearest;
  }

  setHovered(hovered) {
    this.hovered = hovered;
    if (hovered && this.pulseHead > 1.1) this.pulseHead = -0.15;
  }

  anchor() {
    return this.anchorPoint;
  }

  update({ dt, time }) {
    this.object.position.copy(this.home);
    this.object.position.x += Math.sin(time * 0.03) * 5;
    this.object.rotation.y = this.heading + Math.sin(time * 0.05) * 0.25;
    this.object.updateMatrixWorld();

    for (const sample of this.samples) {
      this.object.localToWorld(this.chainPoint(sample.t, time, sample.sphere.center));
    }
    this.object.localToWorld(this.chainPoint(0.1, time, this.anchorPoint));

    this.excite = damp(this.excite, this.hovered ? 1 : 0, this.hovered ? 3 : 0.7, dt);
    if (this.excite > 0.05 || this.pulseHead < 1.2) {
      this.pulseHead += dt * 0.65;
      if (this.pulseHead > 1.25 && this.hovered) this.pulseHead = -0.15;
    }
    this.uniforms.uExcite.value = this.excite;
    this.uniforms.uPulseHead.value = this.pulseHead;
    this.halo.position.copy(this.chainPoint(Math.max(0, this.pulseHead), time, this.halo.position));
    this.halo.material.opacity = this.excite * 0.45;
  }
}
