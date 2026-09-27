import * as THREE from 'three';
import { CAMERA_PATH } from '../config.js';
import { clamp, easeInOutCubic, lerp } from '../utils/math.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Owns the camera. Position and framing follow two splines sampled by dive progress;
 * pointer look, breathing sway and descent pitch are layered on top as small offsets.
 */
export class CameraRig {
  constructor({ motion }) {
    this.motion = motion;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
    this.positionCurve = new THREE.CatmullRomCurve3(
      CAMERA_PATH.map((key) => new THREE.Vector3(...key.pos)),
      false,
      'centripetal',
    );
    this.lookCurve = new THREE.CatmullRomCurve3(
      CAMERA_PATH.map((key) => new THREE.Vector3(...key.look)),
      false,
      'centripetal',
    );
    this.intro = 0;
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
  }

  /** Path frame at a given progress, used to compose the world around the camera's route. */
  frameAt(progress) {
    const position = this.positionCurve.getPoint(clamp(progress));
    const target = this.lookCurve.getPoint(clamp(progress));
    const forward = target.clone().sub(position).normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    return { position, target, forward, right, up };
  }

  /** Places a point relative to the path: `ahead` along the view, `side` to the right, `rise` upward. */
  placeAt(progress, ahead, side = 0, rise = 0) {
    const frame = this.frameAt(progress);
    const flatForward = frame.forward.clone().setY(0).normalize();
    return frame.position
      .clone()
      .addScaledVector(flatForward, ahead)
      .addScaledVector(frame.right, side)
      .addScaledVector(UP, rise);
  }

  resize({ width, height }) {
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Portrait screens widen the vertical field so the composition keeps its breadth.
    this.camera.fov = aspect >= 1 ? 50 : lerp(52, 72, clamp((1 - aspect) / 0.55));
    this.camera.updateProjectionMatrix();
  }

  update({ progress, time, pointer, scrollVelocity }) {
    const reduced = this.motion.reduced;
    this.positionCurve.getPoint(progress, this.position);
    this.lookCurve.getPoint(progress, this.target);

    this.forward.subVectors(this.target, this.position);
    const distance = this.forward.length();
    this.forward.divideScalar(distance);
    this.right.crossVectors(this.forward, UP).normalize();
    this.up.crossVectors(this.right, this.forward).normalize();

    // Opening shot: the lens starts tilted up toward the sun and settles into the path.
    const intro = 1 - easeInOutCubic(clamp(this.intro));
    this.target.y += intro * distance * 1.35;
    this.position.y += intro * 3.5;

    if (!reduced) {
      const look = pointer.look;
      this.target.addScaledVector(this.right, look.x * distance * 0.1);
      this.target.addScaledVector(this.up, look.y * distance * 0.065);
      this.position.addScaledVector(this.right, look.x * 1.4);
      this.position.addScaledVector(this.up, look.y * 0.7);

      this.position.x += Math.sin(time * 0.31) * 0.35;
      this.position.y += Math.sin(time * 0.47) * 0.28;
      this.target.y -= clamp(scrollVelocity, -0.5, 0.5) * 14;
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
    if (!reduced) {
      this.camera.rotateZ(Math.sin(time * 0.23) * 0.01 - pointer.look.x * 0.018 + intro * 0.05);
    }
    this.camera.updateMatrixWorld();
  }
}
