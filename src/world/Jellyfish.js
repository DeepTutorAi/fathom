import * as THREE from 'three';
import { FOG_FADE, JELLY, WATER_LIGHT } from './glsl.js';
import { TAU, clamp, createRandom, damp } from '../utils/math.js';
import { createGlowSprite } from '../utils/resources.js';

const BELL_VERTEX = /* glsl */ `
  ${JELLY}
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  #include <fog_pars_vertex>

  void main() {
    float c = contraction(uPulse);
    vec3 p = bellShape(position, c);
    vLocal = position;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * (normal * vec3(1.0, 1.0 / uBellHeight, 1.0)));
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const BELL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlowColor;
  uniform float uOpacity;
  uniform float uGlow;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  #include <fog_pars_fragment>
  ${WATER_LIGHT}

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    float fresnel = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.2);
    float rim = 1.0 - clamp(vLocal.y, 0.0, 1.0);
    float angle = atan(vLocal.z, vLocal.x);
    float canals = pow(abs(cos(angle * 8.0)), 36.0) * smoothstep(0.1, 0.9, rim) * 0.4;
    float gonads = smoothstep(0.6, 0.95, abs(cos(angle * 2.0))) * smoothstep(0.18, 0.4, rim) * (1.0 - smoothstep(0.55, 0.75, rim));
    float margin = smoothstep(0.9, 1.0, rim);

    vec3 light = waterLight(n) + 0.04;
    vec3 col = uColor * light * (0.5 + fresnel * 1.6) + uColor * gonads * light * 1.2;
    col += uGlowColor * uGlow * (0.25 + fresnel * 1.2 + gonads * 0.8 + margin);
    float alpha = uOpacity * (0.1 + fresnel * 0.7 + gonads * 0.35 + canals + margin * 0.3) + uGlow * 0.1;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <fog_fragment>
  }
`;

const TENTACLE_VERTEX = /* glsl */ `
  ${JELLY}
  attribute float aT;
  attribute float aAngle;
  attribute float aKind;
  uniform float uLength;
  varying float vT;
  varying float vKind;
  #include <fog_pars_vertex>

  void main() {
    // Tentacles lag behind the bell, so the pulse travels down their length.
    float lagged = contraction(uPulse - aT * 0.35);
    float spread = mix(1.0, 0.35, aKind);
    vec3 base = bellShape(vec3(cos(aAngle) * spread, 0.0, sin(aAngle) * spread), lagged);
    float len = uLength * mix(1.0, 0.45, aKind);
    float sway = uTime * mix(0.9, 0.6, aKind);
    vec3 p = base;
    p.y -= aT * len * (1.0 - lagged * 0.12);
    p.x += sin(sway - aT * 5.0 + aAngle * 3.0) * aT * len * 0.1 + cos(aAngle) * aT * (1.0 - lagged) * 0.4;
    p.z += cos(sway * 0.8 - aT * 4.0 + aAngle * 2.0) * aT * len * 0.1 + sin(aAngle) * aT * (1.0 - lagged) * 0.4;
    vT = aT;
    vKind = aKind;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const TENTACLE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlowColor;
  uniform float uOpacity;
  uniform float uGlow;
  uniform vec3 uAmbientTop;
  varying float vT;
  varying float vKind;
  #include <fog_pars_fragment>

  void main() {
    float fade = pow(clamp(1.0 - vT, 0.0, 1.0), 1.3);
    vec3 col = uColor * (uAmbientTop * 1.4 + 0.08) + uGlowColor * uGlow * 0.6;
    gl_FragColor = vec4(col, fade * uOpacity * mix(0.55, 0.9, vKind));
    #include <fog_fragment>
  }
`;

const LIGHTS_VERTEX = /* glsl */ `
  ${JELLY}
  attribute float aAngle;
  uniform float uScale;
  uniform float uSpin;
  uniform float uExcite;
  varying float vBright;
  varying float vFade;
  ${FOG_FADE}

  void main() {
    vec3 p = bellShape(vec3(cos(aAngle), 0.04, sin(aAngle)), contraction(uPulse));
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Atolla's "burglar alarm": a pinwheel of light racing around the bell margin.
    float wheel = pow(max(0.5 + 0.5 * sin(aAngle * 3.0 - uSpin), 0.0), 6.0);
    vBright = 0.4 + uExcite * (0.3 + wheel * 2.6) + wheel * 0.25;
    vFade = fogFade(-mvPosition.z, 0.3);
    gl_PointSize = max((0.16 + uExcite * 0.22) * uScale / -mvPosition.z * (0.6 + wheel * uExcite), 1.0);
  }
`;

const LIGHTS_FRAGMENT = /* glsl */ `
  uniform vec3 uGlowColor;
  varying float vBright;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uGlowColor, core * core * vBright * vFade);
  }
`;

let bellGeometry = null;

function getBellGeometry() {
  bellGeometry ??= new THREE.SphereGeometry(1, 44, 18, 0, TAU, 0, Math.PI / 2);
  return bellGeometry;
}

export function disposeJellyGeometry() {
  bellGeometry?.dispose();
  bellGeometry = null;
}

function createTentacles(tentacles, arms, segments) {
  const total = tentacles + arms;
  const vertexCount = total * segments * 2;
  const positions = new Float32Array(vertexCount * 3);
  const t = new Float32Array(vertexCount);
  const angle = new Float32Array(vertexCount);
  const kind = new Float32Array(vertexCount);
  let v = 0;
  for (let k = 0; k < total; k++) {
    const isArm = k >= tentacles;
    const a = isArm ? ((k - tentacles) / arms) * TAU + 0.4 : (k / tentacles) * TAU;
    for (let s = 0; s < segments; s++) {
      for (const offset of [0, 1]) {
        t[v] = (s + offset) / segments;
        angle[v] = a;
        kind[v] = isArm ? 1 : 0;
        v++;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  return geometry;
}

/**
 * A jellyfish with asymmetric pulse (fast contraction, slow relaxation). Thrust is applied on the
 * CPU during contraction so the body motion and the shader deformation stay in sync.
 * With `bioluminescent`, it becomes an Atolla-like animal that answers hover with a pinwheel of light.
 */
export class Jellyfish {
  constructor({ ocean, glowTexture, position, size, color, glowColor, bellHeight = 0.62, opacity = 0.8, tentacleLength = 5, bioluminescent = false, range, seed, segments, label }) {
    this.range = range;
    this.bioluminescent = bioluminescent;
    this.label = label;
    this.size = size;
    this.home = position.clone();
    this.velocity = new THREE.Vector3();
    this.random = createRandom(seed);
    this.frequency = this.random.range(0.32, 0.46);
    this.phase = this.random();
    this.lastContraction = 0;
    this.excite = 0;
    this.hovered = false;
    this.spin = 0;
    this.startle = 0;
    this.tilt = new THREE.Vector2(this.random.range(-0.2, 0.2), this.random.range(-0.2, 0.2));
    this.tiltTarget = this.tilt.clone();

    this.object = new THREE.Group();
    this.object.position.copy(position);
    this.body = new THREE.Group();
    this.body.scale.setScalar(size);
    this.object.add(this.body);

    const shared = {
      uTime: ocean.uniforms.uTime,
      uPulse: { value: this.phase },
      uBellHeight: { value: bellHeight },
      uColor: { value: new THREE.Color(color) },
      uGlowColor: { value: new THREE.Color(glowColor ?? color).multiplyScalar(2.5) },
      uOpacity: { value: opacity },
      uGlow: { value: 0 },
    };
    this.uniforms = shared;
    const fog = THREE.UniformsLib.fog;

    const bell = new THREE.Mesh(
      getBellGeometry(),
      new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(fog),
          ...shared,
          uAmbientTop: ocean.uniforms.uAmbientTop,
          uAmbientBottom: ocean.uniforms.uAmbientBottom,
          uSunDir: ocean.uniforms.uSunDir,
          uSunIntensity: ocean.uniforms.uSunIntensity,
        },
        vertexShader: BELL_VERTEX,
        fragmentShader: BELL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      }),
    );
    bell.frustumCulled = false;
    bell.renderOrder = 2;

    const tentacles = new THREE.LineSegments(
      createTentacles(bioluminescent ? 20 : 26, 4, segments),
      new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(fog),
          ...shared,
          uLength: { value: tentacleLength },
          uAmbientTop: ocean.uniforms.uAmbientTop,
        },
        vertexShader: TENTACLE_VERTEX,
        fragmentShader: TENTACLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        fog: true,
      }),
    );
    tentacles.frustumCulled = false;
    tentacles.renderOrder = 1;
    this.body.add(tentacles, bell);

    if (bioluminescent) {
      const count = 40;
      const angles = new Float32Array(count);
      for (let i = 0; i < count; i++) angles[i] = (i / count) * TAU;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
      this.lightUniforms = {
        ...shared,
        uFogDensity: ocean.uniforms.uFogDensity,
        uScale: { value: 300 },
        uSpin: { value: 0 },
        uExcite: { value: 0 },
      };
      const lights = new THREE.Points(
        geometry,
        new THREE.ShaderMaterial({
          uniforms: this.lightUniforms,
          vertexShader: LIGHTS_VERTEX,
          fragmentShader: LIGHTS_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      lights.frustumCulled = false;
      lights.renderOrder = 3;
      this.body.add(lights);

      this.halo = createGlowSprite(glowTexture, new THREE.Color(glowColor), size * 5);
      this.halo.material.opacity = 0;
      this.object.add(this.halo);
    }

    this.hitSphere = new THREE.Sphere(this.object.position, size * 1.6);
    this.hitPoint = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.axis = new THREE.Vector3();
  }

  resize({ height, pixelRatio }, camera) {
    if (this.lightUniforms) {
      this.lightUniforms.uScale.value = (height * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    }
  }

  /** Hover system contract: distance along the ray, or null. */
  hitTest(ray) {
    if (!this.bioluminescent) return null;
    return ray.intersectSphere(this.hitSphere, this.hitPoint) ? ray.origin.distanceTo(this.hitPoint) : null;
  }

  setHovered(hovered) {
    this.hovered = hovered;
    if (hovered) this.startle = 1;
  }

  anchor() {
    return this.object.position;
  }

  contraction(phase) {
    const p = phase - Math.floor(phase);
    const s = (e0, e1, x) => {
      const t = clamp((x - e0) / (e1 - e0));
      return t * t * (3 - 2 * t);
    };
    return p < 0.3 ? s(0, 0.3, p) : 1 - s(0.3, 1, p);
  }

  /** Nearby cursor startles the animal into a quicker beat. */
  disturb(amount) {
    this.startle = Math.max(this.startle, amount);
  }

  update({ dt, time, timeScale }) {
    this.startle = damp(this.startle, 0, 0.8, dt);
    this.phase += dt * this.frequency * (1 + this.startle * 1.4) * timeScale;
    this.uniforms.uPulse.value = this.phase;

    const c = this.contraction(this.phase);
    const stroke = Math.max(0, c - this.lastContraction);
    this.lastContraction = c;

    // Wander the swimming axis; drift back toward home if the animal strays.
    if (this.random() < dt * 0.25) {
      this.tiltTarget.set(this.random.range(-0.35, 0.35), this.random.range(-0.35, 0.35));
    }
    const offset = this.offset.subVectors(this.object.position, this.home);
    if (offset.length() > this.size * 3) {
      this.tiltTarget.set(clamp(-offset.x * 0.08, -0.45, 0.45), clamp(offset.z * 0.08, -0.45, 0.45));
    }
    this.tilt.x = damp(this.tilt.x, this.tiltTarget.x, 0.4, dt);
    this.tilt.y = damp(this.tilt.y, this.tiltTarget.y, 0.4, dt);
    this.body.rotation.set(this.tilt.y, 0, this.tilt.x);

    const axis = this.axis.set(0, 1, 0).applyEuler(this.body.rotation);
    this.velocity.addScaledVector(axis, stroke * this.size * 1.1);
    this.velocity.y -= dt * 0.12 * this.size;
    // A weak tether keeps each animal inside its composed shot without looking anchored.
    this.velocity.addScaledVector(offset, -0.06 * dt);
    this.velocity.multiplyScalar(Math.exp(-dt * 1.1));
    this.object.position.addScaledVector(this.velocity, dt * timeScale);

    if (this.bioluminescent) {
      this.excite = damp(this.excite, this.hovered ? 1 : 0, this.hovered ? 3.5 : 0.9, dt);
      this.spin += dt * (0.4 + this.excite * 9);
      this.lightUniforms.uSpin.value = this.spin;
      this.lightUniforms.uExcite.value = this.excite;
      this.uniforms.uGlow.value = this.excite * 0.35 + 0.06;
      this.halo.material.opacity = 0.12 + this.excite * 0.5 + Math.sin(time * 2 + this.spin) * 0.03;
    }
  }
}
