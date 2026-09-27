import * as THREE from 'three';
import { FOG_FADE } from './glsl.js';
import { createRandom, smoothstep } from '../utils/math.js';

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform vec3 uBox;
  uniform vec3 uCameraPos;
  uniform float uScale;
  uniform vec3 uCorePos;
  uniform float uCoreIntensity;
  uniform vec3 uWaveOrigin;
  uniform float uWaveRadius;
  uniform float uWaveStrength;
  varying float vAlpha;
  varying float vWarm;
  ${FOG_FADE}

  void main() {
    vec3 p = position * uBox;
    float t = uTime * (0.6 + aSeed * 0.8);
    p += vec3(sin(t * 0.17 + aSeed * 40.0) * 1.8, -uTime * (0.25 + aSeed * 0.35), cos(t * 0.13 + aSeed * 23.0) * 1.8);
    // Wrap the field around the lens so a finite set of flakes reads as an endless column.
    vec3 rel = mod(p - uCameraPos + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCameraPos + rel;

    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vec3 edge = abs(rel) / (uBox * 0.5);
    float edgeFade = 1.0 - smoothstep(0.7, 1.0, max(max(edge.x, edge.y), edge.z));
    float dist = -mvPosition.z;

    float coreDist = length(world - uCorePos) * 0.06;
    float core = uCoreIntensity / (1.0 + coreDist * coreDist);
    float waveDist = (length(world - uWaveOrigin) - uWaveRadius) * 0.18;
    float wave = uWaveStrength * exp(-waveDist * waveDist);
    vWarm = clamp(core * 0.6 + wave, 0.0, 1.0);

    vAlpha = edgeFade * fogFade(dist, 0.8) * smoothstep(0.4, 3.0, dist) * (0.35 + aSeed * 0.65);
    vAlpha *= 1.0 + core * 2.5 + wave * 4.0;
    float size = aSize * uScale / dist * (1.0 + wave * 0.8);
    // Sub-pixel flakes keep a 1px footprint and fade instead of shimmering.
    vAlpha *= clamp(size, 0.0, 1.0);
    gl_PointSize = max(size, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uWarmColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vWarm;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.05, d);
    vec3 col = mix(uColor, uWarmColor, vWarm);
    gl_FragColor = vec4(col, disc * vAlpha * uOpacity);
  }
`;

/**
 * Marine snow: organic particles sinking through the whole water column. The field wraps
 * around the camera, glows near the structure and flares when its pulse wave passes.
 */
export class MarineSnow {
  constructor({ ocean, count }) {
    this.range = [0, 1];
    const random = createRandom(31);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions.set([random(), random(), random()], i * 3);
      sizes[i] = random.range(0.05, 0.19);
      seeds[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.uniforms = {
      uTime: ocean.uniforms.uTime,
      uFogDensity: ocean.uniforms.uFogDensity,
      uCorePos: ocean.uniforms.uCorePos,
      uCoreIntensity: ocean.uniforms.uCoreIntensity,
      uWaveOrigin: ocean.uniforms.uWaveOrigin,
      uWaveRadius: ocean.uniforms.uWaveRadius,
      uWaveStrength: ocean.uniforms.uWaveStrength,
      uBox: { value: new THREE.Vector3(90, 70, 90) },
      uCameraPos: { value: new THREE.Vector3() },
      uScale: { value: 300 },
      uColor: { value: new THREE.Color('#e9f7ff') },
      uWarmColor: { value: new THREE.Color('#ffc98a').multiplyScalar(2.4) },
      uOpacity: { value: 0.5 },
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
    this.ocean = ocean;
  }

  resize({ height, pixelRatio }, camera) {
    // Matches three's size attenuation: world size projected to device pixels.
    this.uniforms.uScale.value = (height * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  }

  update({ camera, progress }) {
    this.uniforms.uCameraPos.value.copy(camera.position);
    // Sunlit dust near the surface, faint pale flakes below.
    const sunlit = this.ocean.state.sun;
    this.uniforms.uOpacity.value = 0.14 + sunlit * 0.26 + smoothstep(0.8, 0.95, progress) * 0.08;
    this.uniforms.uColor.value.setRGB(0.78 + sunlit * 0.2, 0.9 + sunlit * 0.08, 1.0);
  }
}
