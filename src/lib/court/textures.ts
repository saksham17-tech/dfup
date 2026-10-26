import * as THREE from 'three';
import { seededRandom } from './physics';

// ── Procedural surfaces: no image, model or HDR downloads ──
function surface(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas textures are unavailable');
  return { canvas, ctx };
}
function texture(canvas: HTMLCanvasElement, color = true) {
  const map = new THREE.CanvasTexture(canvas);
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}
export function basketballTexture(orange: string) {
  const { canvas, ctx } = surface(512),
    random = seededRandom(224);
  ctx.fillStyle = orange;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 18000; i++) {
    ctx.fillStyle =
      random() > 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,225,180,0.16)';
    ctx.beginPath();
    ctx.arc(random() * 512, random() * 512, 0.5 + random(), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#25190f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 512);
  for (let side = 0; side < 2; side++) {
    ctx.moveTo(side * 512, 0);
    ctx.bezierCurveTo(256, 150, 256, 362, side * 512, 512);
  }
  ctx.stroke();
  return texture(canvas);
}

export function hardwoodTexture(paintLines = true) {
  const { canvas, ctx } = surface(2048),
    random = seededRandom(157);
  // Narrow maple boards, staggered joints, and long fibre rather than flat stripes.
  for (let row = 0; row < 64; row++) {
    const y = row * 32;
    for (let x = -random() * 340; x < 2048; x += 340) {
      const light = 65 + random() * 13;
      ctx.fillStyle = `hsl(${31 + random() * 6} 48% ${light}%)`;
      ctx.fillRect(x, y, 339, 31);
      ctx.fillStyle = 'rgba(80,44,15,0.12)';
      ctx.fillRect(x, y, 1, 32);
      for (let line = 0; line < 12; line++) {
        ctx.strokeStyle = `rgba(91,49,15,${0.02 + random() * 0.06})`;
        ctx.beginPath();
        const grain = y + random() * 32;
        ctx.moveTo(x, grain);
        ctx.bezierCurveTo(
          x + 80,
          grain + 3,
          x + 220,
          grain - 3,
          x + 340,
          grain,
        );
        ctx.stroke();
      }
    }
  }
  if (!paintLines) return texture(canvas);
  // Coordinates map the painted regulation-inspired half court onto the floor.
  ctx.strokeStyle = 'rgba(248,249,246,0.9)';
  ctx.lineWidth = 8;
  ctx.strokeRect(95, 540, 1858, 1425);
  ctx.strokeRect(1117, 540, 500, 700);
  ctx.beginPath();
  ctx.arc(1367, 1240, 250, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(1367, 608, 840, 0.06, Math.PI - 0.06);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(36,56,230,0.6)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(1024, 1880, 250, Math.PI, Math.PI * 2);
  ctx.stroke();
  return texture(canvas);
}

export function contactTexture() {
  const { canvas, ctx } = surface(64);
  const radial = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  radial.addColorStop(0, 'rgba(0,0,0,0.5)');
  radial.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 64, 64);
  return texture(canvas, false);
}
