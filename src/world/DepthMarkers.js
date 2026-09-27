import * as THREE from 'three';

const WIDTH = 1024;
const HEIGHT = 512;

function drawMarker({ metres, caption, align }) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const x = align === 'right' ? WIDTH - 40 : 40;
  ctx.textAlign = align;
  ctx.fillStyle = '#ffffff';

  ctx.font = '400 30px "IBM Plex Mono", monospace';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '9px';
  ctx.globalAlpha = 0.75;
  ctx.fillText(caption.toUpperCase(), x, 150);

  ctx.globalAlpha = 0.5;
  const ruleStart = align === 'right' ? WIDTH - 40 - 180 : 40;
  ctx.fillRect(ruleStart, 180, 180, 2);

  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;
  ctx.font = '400 250px "Instrument Serif", Georgia, serif';
  ctx.fillText(`${metres.toLocaleString('en-US')} m`, x, 420);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Depth typography placed in the water column at each zone boundary. It is lit only by fog,
 * so each number emerges from the murk and rises past the lens as the camera sinks.
 */
export class DepthMarkers {
  constructor({ camera }) {
    this.range = [0.1, 0.92];
    this.object = new THREE.Group();
    this.items = [
      { p: 0.2, metres: 200, caption: 'Twilight begins', side: -13, align: 'left' },
      { p: 0.5, metres: 1000, caption: 'Last light', side: 12, align: 'right' },
      { p: 0.8, metres: 4000, caption: 'The abyss', side: -12, align: 'left' },
    ].map((item, index) => {
      const material = new THREE.MeshBasicMaterial({
        map: drawMarker(item),
        transparent: true,
        depthWrite: false,
        fog: true,
        color: new THREE.Color('#dcecf2'),
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), material);
      const frame = camera.frameAt(item.p);
      mesh.position.copy(camera.placeAt(item.p, 38, item.side, -2));
      mesh.lookAt(frame.position.x, mesh.position.y, frame.position.z);
      this.object.add(mesh);
      return { mesh, baseY: mesh.position.y, phase: index * 1.7 };
    });
  }

  update({ time }) {
    for (const item of this.items) {
      item.mesh.position.y = item.baseY + Math.sin(time * 0.35 + item.phase) * 0.4;
    }
  }
}
