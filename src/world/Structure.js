import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { STRUCTURE_CENTER } from '../config.js';
import { TAU, createNoise2D, createRandom, damp, easeOutCubic, smoothstep } from '../utils/math.js';
import { createGlowSprite } from '../utils/resources.js';

const LIT_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;
  varying vec3 vLocalNormal;
  varying float vIndex;
  varying float vSeed;
  #ifdef USE_INSTANCING
    attribute float aIndex;
    attribute float aSeed;
  #endif
  #include <fog_pars_vertex>

  void main() {
    #ifdef USE_INSTANCING
      mat4 model = modelMatrix * instanceMatrix;
      vIndex = aIndex;
      vSeed = aSeed;
    #else
      mat4 model = modelMatrix;
      vIndex = 0.0;
      vSeed = 0.0;
    #endif
    vec4 world = model * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(model) * normal);
    vLocalNormal = normal;
    vUv = uv;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const CORE_LIGHT = /* glsl */ `
  uniform vec3 uCorePos;
  uniform float uCoreIntensity;
  uniform vec3 uCoreColor;
  uniform vec3 uAmbientBottom;
  vec3 coreLight(vec3 n, vec3 world) {
    vec3 toCore = uCorePos - world;
    float d = length(toCore);
    float atten = uCoreIntensity / (1.0 + d * d * 0.0035);
    return uCoreColor * max(dot(n, toCore / d), 0.0) * atten + uAmbientBottom * 1.5;
  }
`;

const MONOLITH_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uAwaken;
  uniform float uHover;
  uniform vec3 uGlyphColor;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;
  varying vec3 vLocalNormal;
  varying float vIndex;
  varying float vSeed;
  #include <fog_pars_fragment>
  ${NOISE}
  ${CORE_LIGHT}

  float stroke(float dist, float width) {
    float aa = fwidth(dist) * 0.75;
    return 1.0 - smoothstep(width - aa, width + aa, dist);
  }

  // A grid of procedural marks: bars, hooks, rings and dots. Not a real script.
  float glyph(vec2 uv, float seed) {
    vec2 g = uv * vec2(3.0, 16.0);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id + seed * 37.0);
    float w = 0.055;
    float v = 0.0;
    if (h < 0.3) v = 0.0;
    else if (h < 0.5) v = stroke(abs(f.x), w) * step(abs(f.y), 0.36);
    else if (h < 0.64) v = stroke(abs(f.y), w) * step(abs(f.x), 0.32);
    else if (h < 0.8) v = max(stroke(abs(f.x + 0.18), w) * step(abs(f.y), 0.3), stroke(abs(f.y - 0.3), w) * step(abs(f.x), 0.2));
    else if (h < 0.9) v = stroke(abs(length(f) - 0.2), w);
    else v = stroke(length(f), 0.08);
    return v * step(0.1, uv.x) * step(uv.x, 0.9) * step(0.05, uv.y) * step(uv.y, 0.94);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    float grain = vnoise(vUv * vec2(5.0, 28.0) + vSeed * 13.0);
    vec3 albedo = vec3(0.07, 0.072, 0.08) * (0.65 + grain * 0.7);
    vec3 col = albedo * (coreLight(n, vWorld) * 1.3 + 0.012);

    float side = 1.0 - abs(vLocalNormal.y);
    float awake = smoothstep(0.0, 0.12, uAwaken * 1.3 - vIndex);
    float scan = smoothstep(0.9, 1.0, fract(vUv.y * 0.6 - uTime * 0.12 + vSeed));
    float flicker = 0.75 + 0.25 * sin(uTime * 3.0 + vSeed * 20.0 + floor(vUv.y * 16.0));
    float marks = glyph(vUv, vSeed) * side;
    col += uGlyphColor * marks * (0.05 + awake * (1.3 + scan * 3.0) * flicker + uHover * 0.9);

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

const SEABED_FRAGMENT = /* glsl */ `
  uniform vec3 uWaveOrigin;
  uniform float uWaveRadius;
  uniform float uWaveStrength;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  #include <fog_pars_fragment>
  ${NOISE}
  ${CORE_LIGHT}

  void main() {
    vec3 n = normalize(vNormalW);
    float grain = vnoise(vWorld.xz * 1.6) * 0.5 + vnoise(vWorld.xz * 0.25) * 0.5;
    vec3 albedo = mix(vec3(0.05, 0.052, 0.056), vec3(0.12, 0.11, 0.1), grain);
    vec3 col = albedo * coreLight(n, vWorld);

    float r = length(vWorld.xz - uWaveOrigin.xz);
    float ringDist = (r - uWaveRadius) * 0.3;
    float ring = exp(-ringDist * ringDist) * uWaveStrength;
    col += uCoreColor * ring * 0.5;

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

const COLUMN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const COLUMN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  ${NOISE}
  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(cameraPosition - vWorld)));
    float body = pow(facing, 3.0);
    float fall = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.4);
    float streak = vnoise(vec2(vUv.x * 28.0, vUv.y * 4.0 - uTime * 0.35));
    gl_FragColor = vec4(uColor, body * fall * (0.55 + 0.45 * streak) * uIntensity);
  }
`;

const MOTES_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aRadius;
  uniform float uTime;
  uniform float uScale;
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    float t = fract(aSeed * 7.13 + uTime * (0.012 + aSeed * 0.012));
    float angle = aSeed * 6.2831 + uTime * 0.15 + t * 5.0;
    float r = mix(1.2, 9.0, t) * aRadius;
    vec3 p = vec3(cos(angle) * r, t * 120.0, sin(angle) * r);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = sin(t * 3.14159) * uIntensity;
    gl_PointSize = max(0.14 * uScale / -mvPosition.z, 1.0);
  }
`;

const MOTES_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, core * core * vAlpha);
  }
`;

const RING_RADIUS = 21;
const MONOLITHS = 13;

/**
 * The unidentified structure: a ring of inscribed monoliths around a caged light. It wakes as the
 * camera settles above it, sending a pulse through the water, and answers hover and taps on its core.
 */
export class Structure {
  constructor({ ocean, glowTexture, segments, motion }) {
    this.range = [0.72, 1];
    this.ocean = ocean;
    this.motion = motion;
    this.center = new THREE.Vector3(...STRUCTURE_CENTER);
    this.corePosition = this.center.clone().add(new THREE.Vector3(0, 13, 0));
    this.awaken = 0;
    this.awakened = false;
    this.hover = 0;
    this.hovered = false;
    this.flare = 0;
    this.wave = { start: -Infinity, strength: 0 };
    this.waveListeners = new Set();
    this.label = {
      title: 'Unidentified structure',
      meta: 'Origin unknown · 4,800 m · Emitting',
      tone: 'relic',
    };

    ocean.uniforms.uCorePos.value.copy(this.corePosition);
    this.object = new THREE.Group();

    const shared = {
      uCorePos: ocean.uniforms.uCorePos,
      uCoreIntensity: ocean.uniforms.uCoreIntensity,
      uAmbientBottom: ocean.uniforms.uAmbientBottom,
      uCoreColor: { value: new THREE.Color('#ffc58a') },
    };
    this.shared = shared;

    this.buildSeabed(segments, shared);
    this.buildMonoliths(shared);
    this.buildCore(glowTexture);
    this.buildColumn();

    this.hitSphere = new THREE.Sphere(this.corePosition, 6);
    this.hitPoint = new THREE.Vector3();
  }

  buildSeabed(segments, shared) {
    const noise = createNoise2D(11);
    const half = 900;
    const geometry = new THREE.PlaneGeometry(2, 2, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    // Grid is remapped so vertices crowd near the ring and thin out toward the fogged edge,
    // which sits far enough away that it never reads as a horizon line.
    const spread = (u) => Math.sign(u) * Math.abs(u) ** 1.9 * half;
    for (let i = 0; i < position.count; i++) {
      const x = spread(position.getX(i));
      const z = spread(position.getZ(i));
      position.setX(i, x);
      position.setZ(i, z);
      const r = Math.hypot(x, z);
      const dunes = noise.fbm(x * 0.018, z * 0.018, 5) * 7 - 3.5;
      const berm = Math.exp(-(((r - RING_RADIUS - 5) / 6) ** 2)) * 1.6;
      const hollow = -Math.exp(-((r / 15) ** 2)) * 1.8;
      position.setY(i, dunes * smoothstep(8, 60, r) + berm + hollow);
    }
    geometry.computeVertexNormals();
    this.seabed = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...shared,
          uWaveOrigin: this.ocean.uniforms.uWaveOrigin,
          uWaveRadius: this.ocean.uniforms.uWaveRadius,
          uWaveStrength: this.ocean.uniforms.uWaveStrength,
        },
        vertexShader: LIT_VERTEX,
        fragmentShader: SEABED_FRAGMENT,
        fog: true,
      }),
    );
    this.seabed.position.copy(this.center);
    this.object.add(this.seabed);
  }

  buildMonoliths(shared) {
    const random = createRandom(23);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    const index = new Float32Array(MONOLITHS);
    const seed = new Float32Array(MONOLITHS);
    this.slabs = [];
    for (let i = 0; i < MONOLITHS; i++) {
      // Sweep order starts from the slab nearest the camera and runs around the ring.
      const angle = (i / MONOLITHS) * TAU + Math.PI * 0.5 + random.range(-0.06, 0.06);
      const broken = random() < 0.2;
      this.slabs.push({
        angle,
        radius: RING_RADIUS + random.range(-1.2, 1.2),
        width: random.range(2.4, 3.4),
        height: broken ? random.range(4, 7) : random.range(10, 17),
        depth: random.range(1.1, 1.6),
        lean: new THREE.Euler(random.range(-0.07, 0.07), 0, random.range(-0.06, 0.06)),
        sink: random.range(1.2, 2.2),
      });
      index[i] = i / MONOLITHS;
      seed[i] = random();
    }
    geometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(index, 1));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));

    this.monolithUniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shared,
      uTime: this.ocean.uniforms.uTime,
      uAwaken: { value: 0 },
      uHover: { value: 0 },
      uGlyphColor: { value: new THREE.Color('#ffcf8f').multiplyScalar(2.2) },
    };
    this.monoliths = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.monolithUniforms,
        vertexShader: LIT_VERTEX,
        fragmentShader: MONOLITH_FRAGMENT,
        fog: true,
      }),
      MONOLITHS,
    );
    this.monoliths.frustumCulled = false;
    this.slabMatrix = new THREE.Matrix4();
    this.slabQuat = new THREE.Quaternion();
    this.slabEuler = new THREE.Euler();
    this.slabPos = new THREE.Vector3();
    this.slabScale = new THREE.Vector3();
    this.layoutMonoliths(0);
    this.object.add(this.monoliths);
  }

  /** Slabs rise out of the sediment as the structure wakes, one after another. */
  layoutMonoliths(awaken) {
    this.slabs.forEach((slab, i) => {
      const rise = this.motion.reduced ? 1 : easeOutCubic(smoothstep(i / MONOLITHS - 0.05, i / MONOLITHS + 0.25, awaken * 1.3));
      this.slabPos.set(
        this.center.x + Math.cos(slab.angle) * slab.radius,
        this.center.y - slab.sink + rise * slab.sink * 0.7,
        this.center.z + Math.sin(slab.angle) * slab.radius,
      );
      this.slabEuler.set(slab.lean.x, -slab.angle + Math.PI / 2, slab.lean.z);
      this.slabQuat.setFromEuler(this.slabEuler);
      this.slabScale.set(slab.width, slab.height, slab.depth);
      this.slabMatrix.compose(this.slabPos, this.slabQuat, this.slabScale);
      this.monoliths.setMatrixAt(i, this.slabMatrix);
    });
    this.monoliths.instanceMatrix.needsUpdate = true;
  }

  buildCore(glowTexture) {
    this.core = new THREE.Group();
    this.core.position.copy(this.corePosition);

    this.heart = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.5, 4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd6a3'), fog: false }),
    );
    const cageMaterial = (opacity) =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color('#ffc58a').multiplyScalar(1.6),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
    const edges = (geometry) => {
      const result = new THREE.EdgesGeometry(geometry);
      geometry.dispose();
      return result;
    };
    this.innerCage = new THREE.LineSegments(edges(new THREE.IcosahedronGeometry(3.4, 0)), cageMaterial(0.55));
    this.outerCage = new THREE.LineSegments(edges(new THREE.OctahedronGeometry(5.6, 0)), cageMaterial(0.3));
    this.innerHalo = createGlowSprite(glowTexture, new THREE.Color('#ffd09a'), 16);
    this.outerHalo = createGlowSprite(glowTexture, new THREE.Color('#ff9f5a'), 80);
    this.core.add(this.heart, this.innerCage, this.outerCage, this.innerHalo, this.outerHalo);
    this.object.add(this.core);

    this.tumble = new THREE.Quaternion();
    this.ordered = new THREE.Quaternion();
    this.tmpEuler = new THREE.Euler();
  }

  buildColumn() {
    const geometry = new THREE.CylinderGeometry(9, 2.2, 240, 48, 1, true);
    geometry.translate(0, 120, 0);
    this.columnUniforms = {
      uTime: this.ocean.uniforms.uTime,
      uIntensity: { value: 0.1 },
      uColor: { value: new THREE.Color('#ffc98f') },
    };
    this.column = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.columnUniforms,
        vertexShader: COLUMN_VERTEX,
        fragmentShader: COLUMN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.column.position.copy(this.corePosition);
    this.object.add(this.column);

    const count = 260;
    const random = createRandom(41);
    const seeds = new Float32Array(count);
    const radii = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seeds[i] = random();
      radii[i] = random.range(0.3, 1);
    }
    const motes = new THREE.BufferGeometry();
    motes.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    motes.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    motes.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    this.moteUniforms = {
      uTime: this.ocean.uniforms.uTime,
      uScale: { value: 300 },
      uIntensity: { value: 0.3 },
      uColor: { value: new THREE.Color('#ffd7a8').multiplyScalar(2.4) },
    };
    this.motes = new THREE.Points(
      motes,
      new THREE.ShaderMaterial({
        uniforms: this.moteUniforms,
        vertexShader: MOTES_VERTEX,
        fragmentShader: MOTES_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.position.copy(this.corePosition);
    this.object.add(this.motes);
  }

  resize({ height, pixelRatio }, camera) {
    this.moteUniforms.uScale.value = (height * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  }

  onWave(listener) {
    this.waveListeners.add(listener);
  }

  /** Sends a spherical pulse of light out from the core. */
  emitWave(time, strength) {
    this.wave = { start: time, strength };
    this.flare = Math.max(this.flare, strength);
    this.waveListeners.forEach((listener) => listener(strength));
  }

  hitTest(ray) {
    if (this.awaken < 0.02 && this.ocean.uniforms.uCoreIntensity.value < 0.2) return null;
    return ray.intersectSphere(this.hitSphere, this.hitPoint) ? ray.origin.distanceTo(this.hitPoint) : null;
  }

  setHovered(hovered) {
    this.hovered = hovered;
  }

  anchor() {
    return this.corePosition;
  }

  get coreGlow() {
    return this.ocean.uniforms.uCoreIntensity.value;
  }

  update({ dt, time, progress }) {
    const target = smoothstep(0.9, 0.975, progress);
    this.awaken = damp(this.awaken, target, target > this.awaken ? 0.55 : 1.4, dt);
    if (!this.awakened && this.awaken > 0.35) {
      this.awakened = true;
      this.emitWave(time, this.motion.reduced ? 0.6 : 1);
    } else if (this.awakened && this.awaken < 0.04) {
      this.awakened = false;
    }

    this.hover = damp(this.hover, this.hovered ? 1 : 0, 3, dt);
    this.flare = damp(this.flare, 0, 1.2, dt);
    const breathing = 1 + Math.sin(time * 0.8) * 0.08;
    const presence = smoothstep(0.76, 0.9, progress);
    const intensity = (0.25 + presence * 0.5 + this.awaken * 1.6 + this.hover * 0.6 + this.flare * 1.5) * breathing;
    this.ocean.uniforms.uCoreIntensity.value = intensity;

    const elapsed = time - this.wave.start;
    const live = elapsed < 5;
    const u = this.ocean.uniforms;
    u.uWaveOrigin.value.copy(this.corePosition);
    u.uWaveRadius.value = live ? elapsed * 34 : 0;
    u.uWaveStrength.value = live ? this.wave.strength * (1 - elapsed / 5) ** 1.5 : 0;

    this.monolithUniforms.uAwaken.value = this.awaken;
    this.monolithUniforms.uHover.value = this.hover;
    if (Math.abs(this.awaken - (this.lastLayout ?? -1)) > 0.002) {
      this.layoutMonoliths(this.awaken);
      this.lastLayout = this.awaken;
    }

    this.heart.material.color.setRGB(1.0, 0.82, 0.62).multiplyScalar(1.2 + intensity * 2.2);
    this.heart.scale.setScalar(0.9 + intensity * 0.12 + this.flare * 0.3);
    this.innerHalo.material.opacity = Math.min(1, 0.25 + intensity * 0.3);
    this.outerHalo.material.opacity = Math.min(0.6, 0.05 + intensity * 0.12);
    this.innerHalo.scale.setScalar(12 + intensity * 6 + this.flare * 10);

    // Before waking the cages tumble loosely; awake, they lock into a steady counter-rotation.
    const t = time;
    this.tumble.setFromEuler(this.tmpEuler.set(t * 0.13, t * 0.21, t * 0.07));
    this.ordered.setFromEuler(this.tmpEuler.set(0.36, t * 0.35, 0));
    this.innerCage.quaternion.slerpQuaternions(this.tumble, this.ordered, this.awaken);
    this.tumble.setFromEuler(this.tmpEuler.set(-t * 0.09, -t * 0.12, t * 0.05));
    this.ordered.setFromEuler(this.tmpEuler.set(0, -t * 0.2, 0));
    this.outerCage.quaternion.slerpQuaternions(this.tumble, this.ordered, this.awaken);
    this.innerCage.material.opacity = 0.25 + this.awaken * 0.45 + this.hover * 0.2;
    this.outerCage.material.opacity = 0.12 + this.awaken * 0.25;

    this.columnUniforms.uIntensity.value = presence * 0.14 + this.awaken * 0.45 + this.flare * 0.4;
    this.moteUniforms.uIntensity.value = 0.2 + this.awaken * 0.8;
  }
}
