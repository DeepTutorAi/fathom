import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_LIGHT } from './glsl.js';
import { TAU, createRandom, lerp } from '../utils/math.js';

const VERTEX = /* glsl */ `
  attribute float aPhase;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  #include <fog_pars_vertex>

  void main() {
    vec3 p = position;
    // Travelling body wave: amplitude grows toward the tail, like carangiform swimming.
    float tail = smoothstep(0.3, -0.7, p.x);
    float wave = sin(aPhase - p.x * 7.0);
    p.z += wave * (0.11 * tail * tail + 0.012);
    vLocal = position;

    mat4 model = modelMatrix * instanceMatrix;
    vec4 world = model * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(model) * normal);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uBack;
  uniform vec3 uBelly;
  uniform float uSilver;
  uniform vec3 uPhotoColor;
  uniform float uPhotophore;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  #include <fog_pars_fragment>
  ${WATER_LIGHT}

  void main() {
    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);

    // Countershading: dark back, bright belly.
    float back = smoothstep(-0.06, 0.1, vLocal.y);
    vec3 albedo = mix(uBelly, uBack, back);
    vec3 col = albedo * waterLight(n);

    vec3 h = normalize(uSunDir + v);
    float spec = pow(max(dot(n, h), 0.0), 38.0) * uSunIntensity * uSilver;
    float fresnel = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.0);
    col += vec3(spec * 1.6) + fresnel * uAmbientTop * 0.7 * uSilver;

    // Lanternfish photophores: two rows of light organs along the lower flank.
    float rows = smoothstep(0.016, 0.0, abs(vLocal.y + 0.075)) + smoothstep(0.014, 0.0, abs(vLocal.y + 0.125)) * step(0.0, vLocal.x);
    float dots = smoothstep(0.3, 0.1, abs(fract(vLocal.x * 18.0) - 0.5)) * step(-0.36, vLocal.x) * step(vLocal.x, 0.36);
    col += uPhotoColor * uPhotophore * rows * dots;

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

/** Procedural fish: tapered, laterally compressed body with forked tail and dorsal fin. Local +x is forward. */
export function createFishGeometry() {
  const body = new THREE.SphereGeometry(0.5, 18, 12);
  const position = body.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const taper = x < 0 ? lerp(1, 0.14, Math.pow(-x / 0.5, 1.25)) : lerp(1, 0.72, Math.pow(x / 0.5, 2));
    position.setXYZ(i, x, position.getY(i) * 0.4 * taper, position.getZ(i) * 0.15 * taper);
  }
  body.computeVertexNormals();

  const fin = (points, indices) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(points.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((points.length / 3) * 2).fill(0), 2));
    geometry.setIndex(indices);
    return geometry;
  };
  const tail = fin(
    [-0.43, 0.035, 0, -0.43, -0.035, 0, -0.74, 0.22, 0, -0.63, 0, 0, -0.74, -0.22, 0],
    [0, 2, 3, 0, 3, 1, 1, 3, 4],
  );
  const dorsal = fin([0.08, 0.17, 0, -0.2, 0.3, 0, -0.24, 0.13, 0], [0, 1, 2]);

  const merged = mergeGeometries([body, tail, dorsal]);
  body.dispose();
  tail.dispose();
  dorsal.dispose();
  return merged;
}

/**
 * A school that mills around a drifting centre. Each fish is a damped spring toward its orbit slot,
 * with repulsion from the cursor ray and the camera; startled fish beat their tails faster.
 */
export class FishSchool {
  constructor({ ocean, geometry, count, center, extents, size, speed, back, belly, silver = 1, photophores = 0, range, seed }) {
    this.range = range;
    this.count = count;
    this.center = center.clone();
    this.extents = extents.clone();
    this.speed = speed;
    this.scareUntil = 0;
    this.panicLevel = 0;
    this.tmp = new THREE.Vector3();
    this.drift = this.center.clone();

    const random = createRandom(seed);
    this.slots = [];
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.headings = new Float32Array(count * 3);
    this.panic = new Float32Array(count);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const slot = {
        angle: random() * TAU,
        radius: Math.sqrt(random.range(0.08, 1)),
        height: random.range(-1, 1),
        speed: random.range(0.8, 1.2),
        bob: random() * TAU,
        size: random.range(size[0], size[1]),
        beat: random.range(0.85, 1.15),
      };
      this.slots.push(slot);
      const start = this.slotPosition(slot, 0, new THREE.Vector3());
      this.positions.set([start.x, start.y, start.z], i * 3);
      this.headings.set([1, 0, 0], i * 3);
      this.phase[i] = random() * TAU;
    }

    this.phaseAttribute = new THREE.InstancedBufferAttribute(this.phase, 1).setUsage(THREE.DynamicDrawUsage);
    const instanced = geometry.clone();
    instanced.setAttribute('aPhase', this.phaseAttribute);

    this.uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAmbientTop: ocean.uniforms.uAmbientTop,
      uAmbientBottom: ocean.uniforms.uAmbientBottom,
      uSunDir: ocean.uniforms.uSunDir,
      uSunIntensity: ocean.uniforms.uSunIntensity,
      uBack: { value: new THREE.Color(back) },
      uBelly: { value: new THREE.Color(belly) },
      uSilver: { value: silver },
      uPhotoColor: { value: new THREE.Color('#7fdcff').multiplyScalar(5) },
      uPhotophore: { value: photophores },
    };
    this.object = new THREE.InstancedMesh(
      instanced,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.DoubleSide,
        fog: true,
      }),
      count,
    );
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.object.frustumCulled = false;
    this.matrices = this.object.instanceMatrix.array;
  }

  slotPosition(slot, time, out) {
    const angle = slot.angle + time * this.speed * slot.speed * 0.12;
    return out.set(
      this.drift.x + Math.cos(angle) * slot.radius * this.extents.x,
      this.drift.y + slot.height * this.extents.y + Math.sin(time * 0.6 + slot.bob) * 0.6,
      this.drift.z + Math.sin(angle) * slot.radius * this.extents.z,
    );
  }

  /** Startle response for a tap: wider, stronger avoidance for half a second. */
  scare(time) {
    this.scareUntil = time + 0.55;
  }

  update({ dt, time, pointer, camera }) {
    const { count, positions: pos, velocities: vel, headings: head, panic, phase, slots, matrices } = this;
    this.drift.set(
      this.center.x + Math.sin(time * 0.05) * this.extents.x * 0.35,
      this.center.y + Math.sin(time * 0.07) * 2,
      this.center.z + Math.cos(time * 0.04) * this.extents.z * 0.35,
    );

    const scared = time < this.scareUntil;
    const reach = scared ? 2.6 : 1;
    const push = scared ? 2.2 : 1;
    const ray = pointer.ray;
    const cursor = pointer.active;
    const cam = camera.position;
    const decay = Math.exp(-dt * 1.6);
    const turn = 1 - Math.exp(-dt * 7);
    const target = this.tmp;
    let panicSum = 0;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const slot = slots[i];
      this.slotPosition(slot, time, target);
      let px = pos[i3];
      let py = pos[i3 + 1];
      let pz = pos[i3 + 2];

      let ax = (target.x - px) * 1.3 - vel[i3] * 0.9;
      let ay = (target.y - py) * 1.3 - vel[i3 + 1] * 0.9;
      let az = (target.z - pz) * 1.3 - vel[i3 + 2] * 0.9;
      let fear = 0;

      if (cursor) {
        const dx = px - ray.origin.x;
        const dy = py - ray.origin.y;
        const dz = pz - ray.origin.z;
        const t = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z;
        if (t > 0) {
          const cx = dx - ray.direction.x * t;
          const cy = dy - ray.direction.y * t;
          const cz = dz - ray.direction.z * t;
          const d = Math.sqrt(cx * cx + cy * cy + cz * cz) + 1e-4;
          const radius = (2.4 + t * 0.06) * reach;
          if (d < radius) {
            const f = 1 - d / radius;
            const strength = f * f * 60 * push;
            ax += (cx / d) * strength;
            ay += (cy / d) * strength;
            az += (cz / d) * strength;
            fear = Math.max(fear, f);
          }
        }
      }

      const kx = px - cam.x;
      const ky = py - cam.y;
      const kz = pz - cam.z;
      const kd = Math.sqrt(kx * kx + ky * ky + kz * kz) + 1e-4;
      if (kd < 7) {
        const f = 1 - kd / 7;
        ax += (kx / kd) * f * 45;
        ay += (ky / kd) * f * 45;
        az += (kz / kd) * f * 45;
        fear = Math.max(fear, f * 0.7);
      }

      vel[i3] += ax * dt;
      vel[i3 + 1] += ay * dt;
      vel[i3 + 2] += az * dt;
      px += vel[i3] * dt;
      py += vel[i3 + 1] * dt;
      pz += vel[i3 + 2] * dt;
      pos[i3] = px;
      pos[i3 + 1] = py;
      pos[i3 + 2] = pz;

      panic[i] = Math.max(panic[i] * decay, fear);
      panicSum += fear;
      const speed = Math.hypot(vel[i3], vel[i3 + 1], vel[i3 + 2]);
      phase[i] += dt * (7 + speed * 1.4 + panic[i] * 16) * slot.beat;

      // Smoothed heading keeps orientation calm when velocity jitters.
      if (speed > 0.05) {
        head[i3] += (vel[i3] / speed - head[i3]) * turn;
        head[i3 + 1] += ((vel[i3 + 1] / speed) * 0.6 - head[i3 + 1]) * turn;
        head[i3 + 2] += (vel[i3 + 2] / speed - head[i3 + 2]) * turn;
      }
      let fx = head[i3];
      let fy = head[i3 + 1];
      let fz = head[i3 + 2];
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;

      // Basis: X forward, Z = X × worldUp, Y = Z × X.
      let zx = -fz;
      let zz = fx;
      const zl = Math.hypot(zx, zz) || 1;
      zx /= zl;
      zz /= zl;
      const yx = -zz * fy;
      const yy = zz * fx - zx * fz;
      const yz = zx * fy;

      const s = slot.size;
      const m = i * 16;
      matrices[m] = fx * s;
      matrices[m + 1] = fy * s;
      matrices[m + 2] = fz * s;
      matrices[m + 3] = 0;
      matrices[m + 4] = yx * s;
      matrices[m + 5] = yy * s;
      matrices[m + 6] = yz * s;
      matrices[m + 7] = 0;
      matrices[m + 8] = zx * s;
      matrices[m + 9] = 0;
      matrices[m + 10] = zz * s;
      matrices[m + 11] = 0;
      matrices[m + 12] = px;
      matrices[m + 13] = py;
      matrices[m + 14] = pz;
      matrices[m + 15] = 1;
    }

    this.panicLevel = panicSum / count;
    this.object.instanceMatrix.needsUpdate = true;
    this.phaseAttribute.needsUpdate = true;
  }

  dispose() {
    this.object.dispose();
  }
}
