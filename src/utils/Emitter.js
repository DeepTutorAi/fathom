/** Minimal synchronous event bus used to decouple interaction, UI and sound. */
export class Emitter {
  constructor() {
    this.handlers = new Map();
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.handlers.get(type)?.delete(handler);
  }

  emit(type, payload) {
    this.handlers.get(type)?.forEach((handler) => handler(payload));
  }

  clear() {
    this.handlers.clear();
  }
}
