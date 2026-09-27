import * as THREE from 'three';
import { NOISE } from './glsl.js';

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// Seen from below, the surface shows the sky only inside Snell's window (~48.6° from vertical);
// outside it, total internal reflection mirrors the darker water beneath.
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform float uSunIntensity;
  uniform vec3 uSky;
  uniform vec3 uDeep;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${NOISE}

  float height(vec2 p, float t) {
    return vnoise(p + vec2(t, t * 0.6)) * 0.55 + vnoise(p * 2.7 - vec2(t * 0.9, -t * 0.5)) * 0.3 + vnoise(p * 6.1 + vec2(t * 1.3, t)) * 0.15;
  }

  void main() {
    vec2 p = vWorld.xz * 0.16;
    float t = uTime * 0.45;
    float h = height(p, t);
    float e = 0.03;
    vec3 n = normalize(vec3(
      (height(p + vec2(e, 0.0), t) - h) / e * 0.06,
      1.0,
      (height(p + vec2(0.0, e), t) - h) / e * 0.06
    ));

    vec3 view = normalize(vWorld - cameraPosition);
    float cosTheta = dot(view, n);
    float window = smoothstep(0.64, 0.68, cosTheta);
    float rim = smoothstep(0.6, 0.66, cosTheta) * (1.0 - smoothstep(0.66, 0.72, cosTheta));

    // Caustic-like network where two wave layers cross; it fades with distance to avoid moiré.
    float a = vnoise(p * 1.7 + vec2(t * 0.7, -t * 0.3));
    float b = vnoise(p * 1.9 - vec2(t * 0.5, t * 0.6) + 7.3);
    float caustic = pow(1.0 - clamp(abs(a - b) * 3.0, 0.0, 1.0), 6.0);
    float near = 1.0 - smoothstep(20.0, 90.0, length(vWorld - cameraPosition));

    vec3 sky = uSky * (0.45 + 0.55 * smoothstep(0.66, 1.0, cosTheta)) * (0.85 + caustic * 0.35);
    vec3 sunDir = normalize(uSunDir + vec3(n.x, 0.0, n.z) * 1.2);
    float sunAlign = max(dot(view, sunDir), 0.0);
    vec3 sun = vec3(1.0, 0.95, 0.85) * (pow(sunAlign, 1400.0) * 14.0 + pow(sunAlign, 60.0) * 1.1 + pow(sunAlign, 12.0) * 0.18) * uSunIntensity;

    vec3 inside = sky + sun;
    vec3 outside = uDeep * (0.8 + 0.12 * caustic * near) + uSky * rim * 0.3;

    gl_FragColor = vec4(mix(outside, inside, window) * mix(0.35, 1.0, uSunIntensity), 1.0);
    #include <fog_fragment>
  }
`;

export class Surface {
  constructor({ ocean }) {
    this.range = [0, 0.34];
    this.uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: ocean.uniforms.uTime,
      uSunDir: ocean.uniforms.uSunDir,
      uSunIntensity: ocean.uniforms.uSunIntensity,
      uSky: { value: new THREE.Color('#bfeeff').multiplyScalar(0.95) },
      uDeep: { value: new THREE.Color('#0b5578') },
    };
    // Large enough that its edge lies past the far plane, so it never meets the backdrop.
    const geometry = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    geometry.rotateX(Math.PI / 2);
    this.object = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        fog: true,
      }),
    );
  }
}
