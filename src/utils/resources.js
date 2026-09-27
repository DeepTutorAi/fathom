import * as THREE from 'three';

/** Releases every GPU resource owned by an object tree. Shared textures must be disposed by their owner. */
export function disposeObject(root, { keepTextures = new Set() } = {}) {
  root.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value?.isTexture && !keepTextures.has(value)) value.dispose();
      }
      if (material.uniforms) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform?.value?.isTexture && !keepTextures.has(uniform.value)) uniform.value.dispose();
        }
      }
      material.dispose();
    }
  });
}

/** Soft radial falloff used for every additive glow sprite. */
export function createGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createGlowSprite(texture, color, scale) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

/** Wraps an indexed geometry so it can be drawn many times with per-instance attributes. */
export function toInstanced(baseGeometry, count) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = baseGeometry.index;
  for (const [name, attribute] of Object.entries(baseGeometry.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = count;
  return geometry;
}
