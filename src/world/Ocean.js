import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { smoothstep } from '../utils/math.js';

const BACKDROP_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;

const BACKDROP_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform float uSunIntensity;
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;
    vec3 col = mix(uBottom, uHorizon, smoothstep(-0.75, 0.02, h));
    col = mix(col, uTop, smoothstep(0.08, 0.9, h));
    // Overhead glow only: near the horizon it would not match the fogged surface plane.
    float sun = max(dot(dir, uSunDir), 0.0);
    col += vec3(0.75, 0.9, 1.0) * pow(sun, 10.0) * 0.55 * uSunIntensity * smoothstep(0.12, 0.45, h);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * The water itself: backdrop gradient, fog and the lighting uniforms every creature shares.
 * All values are driven by dive progress through the PALETTE keyframes.
 */
export class Ocean {
  constructor(scene) {
    this.scene = scene;
    this.keys = PALETTE.map((key) => ({
      ...key,
      top: new THREE.Color(key.top),
      horizon: new THREE.Color(key.horizon),
      bottom: new THREE.Color(key.bottom),
    }));

    this.fog = new THREE.FogExp2(this.keys[0].horizon.clone(), this.keys[0].fog);
    scene.fog = this.fog;

    /** Uniform objects are shared by reference, so one update reaches every material. */
    this.uniforms = {
      uTime: { value: 0 },
      uFogDensity: { value: this.fog.density },
      // Refracted sun: underwater it always sits within Snell's window, here ~48° above the horizon.
      uSunDir: { value: new THREE.Vector3(0.12, 1, -0.88).normalize() },
      uSunIntensity: { value: 1 },
      uAmbientTop: { value: new THREE.Color() },
      uAmbientBottom: { value: new THREE.Color() },
      uCorePos: { value: new THREE.Vector3() },
      uCoreIntensity: { value: 0 },
      uWaveOrigin: { value: new THREE.Vector3() },
      uWaveRadius: { value: 0 },
      uWaveStrength: { value: 0 },
    };

    this.backdropUniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSunDir: this.uniforms.uSunDir,
      uSunIntensity: this.uniforms.uSunIntensity,
    };
    this.backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.backdropUniforms,
        vertexShader: BACKDROP_VERTEX,
        fragmentShader: BACKDROP_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.backdrop.renderOrder = -10;
    this.backdrop.frustumCulled = false;
    scene.add(this.backdrop);

    this.state = { exposure: 1, sun: 1 };
    this.warmWater = new THREE.Color('#1d1209');
  }

  sample(progress) {
    const keys = this.keys;
    let i = 1;
    while (i < keys.length - 1 && progress > keys[i].p) i++;
    const a = keys[i - 1];
    const b = keys[i];
    const t = smoothstep(a.p, b.p, progress);
    return { a, b, t };
  }

  update({ progress, time, camera, coreGlow }) {
    const { a, b, t } = this.sample(progress);
    const u = this.uniforms;
    const bu = this.backdropUniforms;

    bu.uTop.value.lerpColors(a.top, b.top, t);
    bu.uHorizon.value.lerpColors(a.horizon, b.horizon, t);
    bu.uBottom.value.lerpColors(a.bottom, b.bottom, t);
    // Light scattered from the structure warms the whole water volume near the floor.
    const warmth = Math.min(1, coreGlow * 0.7);
    bu.uHorizon.value.lerp(this.warmWater, warmth);
    bu.uBottom.value.lerp(this.warmWater, warmth * 0.6);
    this.fog.color.copy(bu.uHorizon.value);
    this.fog.density = a.fog + (b.fog - a.fog) * t;
    u.uFogDensity.value = this.fog.density;

    const sun = a.sun + (b.sun - a.sun) * t;
    u.uSunIntensity.value = sun;
    u.uAmbientTop.value.copy(bu.uTop.value).multiplyScalar(1.1);
    u.uAmbientBottom.value.copy(bu.uBottom.value).multiplyScalar(1.4);
    u.uTime.value = time;

    this.state.exposure = a.exposure + (b.exposure - a.exposure) * t;
    this.state.sun = sun;

    this.backdrop.position.copy(camera.position);
  }

  dispose() {
    this.scene.remove(this.backdrop);
    this.backdrop.geometry.dispose();
    this.backdrop.material.dispose();
    this.scene.fog = null;
  }
}
