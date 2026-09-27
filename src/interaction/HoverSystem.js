const RELEASE_GRACE = 0.14;

/**
 * Finds the nearest hoverable under the pointer ray. Items implement
 * `hitTest(ray) -> distance | null`, `setHovered(bool)`, `anchor() -> Vector3` and `label`.
 * A short grace period prevents flicker at the edge of a hit volume.
 */
export class HoverSystem {
  constructor({ bus }) {
    this.bus = bus;
    this.items = [];
    this.current = null;
    this.lostAt = 0;
  }

  add(item) {
    this.items.push(item);
  }

  pick(ray) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const item of this.items) {
      if (!item.object.visible) continue;
      const distance = item.hitTest(ray);
      if (distance !== null && distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  update({ pointer, time }) {
    const canHover = pointer.active && pointer.type === 'mouse' && !pointer.overUI;
    const hit = canHover ? this.pick(pointer.ray) : null;
    if (hit) {
      this.lostAt = 0;
      this.set(hit);
    } else if (this.current) {
      if (!canHover) this.set(null);
      else if (!this.lostAt) this.lostAt = time;
      else if (time - this.lostAt > RELEASE_GRACE) this.set(null);
    }
    return this.current;
  }

  set(item) {
    if (item === this.current) return;
    this.current?.setHovered(false);
    this.current = item;
    item?.setHovered(true);
    this.lostAt = 0;
    this.bus.emit('hover', item);
  }
}
