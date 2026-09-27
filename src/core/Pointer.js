import * as THREE from 'three';
import { damp } from '../utils/math.js';

const TAP_DISTANCE = 12;
const TAP_TIME = 450;

/**
 * Normalised pointer state shared by the camera, cursor, hover system and creatures.
 * Tracks a raw position, a damped position for camera look, speed, and taps.
 */
export class Pointer {
  constructor() {
    this.screen = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
    this.ndc = new THREE.Vector2();
    this.look = new THREE.Vector2();
    this.speed = 0;
    this.active = false;
    this.pressed = false;
    this.type = 'mouse';
    this.overUI = false;
    this.raycaster = new THREE.Raycaster();
    this.ray = this.raycaster.ray;
    this.tapListeners = new Set();

    this.lastMove = { x: this.screen.x, y: this.screen.y, t: performance.now() };
    this.rawSpeed = 0;

    this.handleMove = (event) => {
      this.type = event.pointerType || 'mouse';
      this.setPosition(event.clientX, event.clientY);
      this.overUI = Boolean(event.target.closest?.('button, a, [role="button"]'));
      this.active = true;
      clearTimeout(this.touchTimer);
    };
    this.handleDown = (event) => {
      this.handleMove(event);
      this.pressed = true;
      this.down = { x: event.clientX, y: event.clientY, t: performance.now() };
    };
    this.handleUp = (event) => {
      this.pressed = false;
      const down = this.down;
      this.down = null;
      if (event.pointerType === 'touch') {
        this.touchTimer = setTimeout(() => (this.active = false), 900);
      }
      if (!down || this.overUI) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved < TAP_DISTANCE && performance.now() - down.t < TAP_TIME) {
        this.tapListeners.forEach((listener) => listener({ x: event.clientX, y: event.clientY, type: event.pointerType }));
      }
    };
    this.handleCancel = () => {
      this.pressed = false;
      this.down = null;
      if (this.type === 'touch') this.active = false;
    };
    this.handleLeave = () => {
      this.active = false;
      this.pressed = false;
    };

    window.addEventListener('pointermove', this.handleMove, { passive: true });
    window.addEventListener('pointerdown', this.handleDown, { passive: true });
    window.addEventListener('pointerup', this.handleUp, { passive: true });
    window.addEventListener('pointercancel', this.handleCancel, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.handleLeave);
    window.addEventListener('blur', this.handleLeave);
  }

  setPosition(x, y) {
    const now = performance.now();
    const elapsed = Math.max(1, now - this.lastMove.t);
    const distance = Math.hypot(x - this.lastMove.x, y - this.lastMove.y);
    this.rawSpeed = Math.max(this.rawSpeed, (distance / elapsed) * 1000);
    this.lastMove = { x, y, t: now };
    this.screen.set(x, y);
    this.ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  }

  onTap(listener) {
    this.tapListeners.add(listener);
    return () => this.tapListeners.delete(listener);
  }

  /** Smooths look direction and speed; call once per frame before the camera update. */
  update(dt) {
    // Only a hovering mouse steers the view; touch and idle pointers ease back to centre.
    const steering = this.active && this.type === 'mouse';
    this.look.x = damp(this.look.x, steering ? this.ndc.x : 0, 2.2, dt);
    this.look.y = damp(this.look.y, steering ? this.ndc.y : 0, 2.2, dt);
    this.speed = damp(this.speed, this.rawSpeed, 6, dt);
    this.rawSpeed = damp(this.rawSpeed, 0, 10, dt);
  }

  dispose() {
    clearTimeout(this.touchTimer);
    this.tapListeners.clear();
    window.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerdown', this.handleDown);
    window.removeEventListener('pointerup', this.handleUp);
    window.removeEventListener('pointercancel', this.handleCancel);
    document.documentElement.removeEventListener('pointerleave', this.handleLeave);
    window.removeEventListener('blur', this.handleLeave);
  }
}
