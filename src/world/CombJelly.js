import * as THREE from 'three';
import { FOG_FADE } from './glsl.js';
import { createRandom, damp } from '../utils/math.js';
import { createGlowSprite } from '../utils/resources.js';

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vFade;
  ${FOG_FADE}

  void main() {
    vec3 p = position;
    // Slow peristaltic squeeze keeps the body from reading as a rigid ellipsoid.
    p.xz *= 1.0 + sin(uTime * 0.9 + p.y * 2.5 + uSeed) * 0.05;
    vLocal = position;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * world;
    vFade = fogFade(-mvPosition.z, 0.45);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uBase;
  uniform float uExcite;
  uniform vec3 uBody;
  uniform vec3 uBio;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vFade;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    float fresnel = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.4);
    float angle = atan(vLocal.z, vLocal.x);

    // Eight comb rows; beating cilia scatter light into travelling rainbow bands.
    float rows = pow(abs(cos(angle * 4.0)), 70.0) * smoothstep(-0.8, -0.45, vLocal.y) * (1.0 - smoothstep(0.55, 0.88, vLocal.y));
    float band = fract(vLocal.y * 2.6 - uTime * (1.1 + uExcite * 2.0));
    float beat = smoothstep(0.0, 0.15, band) * (1.0 - smoothstep(0.15, 0.55, band));
    vec3 iridescence = 0.5 + 0.5 * cos(6.28318 * (band + vec3(0.0, 0.33, 0.67)));

    vec3 col = uBody * fresnel * (0.4 + uExcite);
    col += iridescence * rows * beat * (uBase + uExcite * 1.6);
    col += uBio * uExcite * (rows * 1.4 + fresnel * 0.35);
    float alpha = (fresnel * 0.35 + rows * (0.5 + beat)) * vFade;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Ctenophore: iridescent comb rows at rest, blue-green bioluminescence when disturbed. */
export class CombJelly {
  constructor({ ocean, glowTexture, position, size, range, seed, label }) {
    this.range = range;
    this.label = label;
    this.size = size;
    this.home = position.clone();
    this.random = createRandom(seed);
    this.offset = this.random() * 100;
    this.excite = 0;
    this.hovered = false;

    this.uniforms = {
      uTime: ocean.uniforms.uTime,
      uFogDensity: ocean.uniforms.uFogDensity,
      uSeed: { value: this.offset },
      uBase: { value: 0.35 },
      uExcite: { value: 0 },
      uBody: { value: new THREE.Color('#9fd8ff') },
      uBio: { value: new THREE.Color('#5dffd8').multiplyScalar(2.2) },
    };
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 28),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.scale.set(0.6, 1, 0.6);

    this.object = new THREE.Group();
    this.object.position.copy(position);
    this.object.scale.setScalar(size);
    this.object.add(mesh);
    this.halo = createGlowSprite(glowTexture, new THREE.Color('#5dffd8'), 6);
    this.halo.material.opacity = 0;
    this.object.add(this.halo);

    this.hitSphere = new THREE.Sphere(this.object.position, size * 1.4);
    this.hitPoint = new THREE.Vector3();
  }

  hitTest(ray) {
    return ray.intersectSphere(this.hitSphere, this.hitPoint) ? ray.origin.distanceTo(this.hitPoint) : null;
  }

  setHovered(hovered) {
    this.hovered = hovered;
  }

  anchor() {
    return this.object.position;
  }

  update({ dt, time }) {
    const t = time + this.offset;
    this.object.position.set(
      this.home.x + Math.sin(t * 0.13) * 1.5,
      this.home.y + Math.sin(t * 0.21) * 1.2,
      this.home.z + Math.cos(t * 0.11) * 1.5,
    );
    this.object.rotation.set(Math.sin(t * 0.17) * 0.35, t * 0.08, Math.cos(t * 0.15) * 0.3);
    this.excite = damp(this.excite, this.hovered ? 1 : 0, this.hovered ? 4 : 1, dt);
    this.uniforms.uExcite.value = this.excite;
    this.halo.material.opacity = this.excite * 0.4;
  }
}
