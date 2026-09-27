import * as THREE from 'three';
import { FOG_FADE, NOISE } from './glsl.js';
import { createRandom } from '../utils/math.js';
import { toInstanced } from '../utils/resources.js';

const VERTEX = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec2 aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform vec3 uSunDir;
  varying vec2 vUv;
  varying float vFade;
  varying float vPhase;
  ${FOG_FADE}

  void main() {
    float along = -position.y;
    // Art-directed: steeper than the true refracted sun so the rays read as a cathedral, not a slant.
    vec3 axis = -normalize(uSunDir + vec3(0.0, 1.4, 0.0));
    vec3 origin = aOrigin + vec3(sin(uTime * 0.21 + aPhase) * 3.0, 0.0, cos(uTime * 0.17 + aPhase * 1.3) * 3.0);
    vec3 center = origin + axis * along * aSize.y;
    // Cylindrical billboard: each shaft turns about its own axis to face the lens.
    vec3 toCamera = normalize(cameraPosition - center);
    vec3 side = normalize(cross(axis, toCamera));
    float width = aSize.x * (0.55 + along * 0.9);
    vec3 world = center + side * position.x * width;

    float dist = length(cameraPosition - world);
    vFade = fogFade(dist, 0.55) * smoothstep(6.0, 34.0, dist);
    vUv = vec2(position.x + 0.5, along);
    vPhase = aPhase;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vFade;
  varying float vPhase;
  ${NOISE}

  void main() {
    // Clamp before pow: sin(pi) is slightly negative and pow() of a negative base is NaN.
    float edge = pow(max(sin(vUv.x * 3.14159265), 0.0), 2.5);
    float falloff = smoothstep(0.0, 0.06, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.7);
    float streak = 0.5 + 0.5 * vnoise(vec2(vUv.x * 7.0 + vPhase * 11.0, vUv.y * 1.6 - uTime * 0.04));
    float flicker = 0.7 + 0.3 * sin(uTime * 0.6 + vPhase * 5.0);
    float alpha = edge * falloff * streak * flicker * vFade * uIntensity;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** Volumetric-looking god rays: soft additive billboards streaming down from the surface. */
export class LightShafts {
  constructor({ ocean, camera, count }) {
    this.range = [0, 0.46];
    const random = createRandom(7);
    const base = new THREE.PlaneGeometry(1, 1, 1, 10);
    base.translate(0, -0.5, 0);
    const geometry = toInstanced(base, count);

    const origins = new Float32Array(count * 3);
    const sizes = new Float32Array(count * 2);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const anchor = camera.placeAt(random.range(0.0, 0.12), random.range(10, 70), random.range(-45, 45));
      origins.set([anchor.x, 1, anchor.z], i * 3);
      sizes.set([random.range(5, 15), random.range(130, 230)], i * 2);
      phases[i] = random() * 10;
    }
    geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 2));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    this.uniforms = {
      uTime: ocean.uniforms.uTime,
      uSunDir: ocean.uniforms.uSunDir,
      uFogDensity: ocean.uniforms.uFogDensity,
      uIntensity: { value: 0.3 },
      uColor: { value: new THREE.Color('#dff7ff') },
    };
    this.object = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.object.frustumCulled = false;
    this.ocean = ocean;
  }

  update() {
    this.uniforms.uIntensity.value = 0.34 * this.ocean.state.sun;
  }
}
