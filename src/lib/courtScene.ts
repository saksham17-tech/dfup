import type { CourtProgressProps } from '@/components/CourtProgress';
import {
  arcPosition, ballRadius, clamp, groupedCount, MAX_BALLS, pileSlot,
  rackSlot, SHOT_DURATION, SHOT_STAGGER, validSavedIndices, type Point,
} from './courtMath';

type Shot = { index: number; start: number; swished: boolean };
type Particle = { vx: number; vy: number; rotation: number; color: string };
export type CourtScene = {
  update: (props: CourtProgressProps) => void;
  resize: () => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
};

/** Rendering has its own clock. Pauses never advance it; hidden scenes reconcile immediately. */
export function createCourtScene(canvas: HTMLCanvasElement, initial: CourtProgressProps): CourtScene | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const ctx = context;
  const css = getComputedStyle(canvas);
  const token = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
  const colors = {
    paper: token('paper'), surface: token('surface'), ink: token('ink'),
    muted: token('muted'), line: token('line'), cobalt: token('cobalt'),
    ball: token('ball'), dark: token('ball-dark'), rim: token('rim'), alert: token('alert'),
  };
  let props = initial;
  let seen = validSavedIndices(props.totalPieces, props.savedIndices);
  let settled = seen.size;
  const queue: number[] = [];
  const shots: Shot[] = [];
  const rack: Point[] = [];
  const pile: Point[] = [];
  const point: Point = { x: 0, y: 0 };
  const hoop: Point = { x: 0, y: 0 };
  let width = 1, height = 1, radius = 1;
  let ballFill: CanvasGradient | string = colors.ball;
  let visible = false, destroyed = false;
  let frame = 0, last = 0, time = 0, nextShot = 0;
  let swishAt = -10000, celebrationAt = -10000;
  let celebrated = initial.phase === 'completed';
  const particles: Particle[] = Array.from({ length: 40 }, (_, i) => ({
    vx: Math.cos(i * 2.399) * (45 + (i % 7) * 16),
    vy: -90 - (i % 9) * 17,
    rotation: i * 1.7,
    color: [colors.ball, colors.cobalt, colors.ink][i % 3],
  }));

  function fastForward() {
    settled = seen.size;
    queue.length = 0;
    shots.length = 0;
    nextShot = time;
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  function ball(x: number, y: number, spin = 0, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colors.ink;
    ctx.globalAlpha = alpha * 0.1;
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 1.15, radius * 1.12, radius * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.fillStyle = ballFill;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = Math.max(0.65, radius * 0.12);
    ctx.beginPath();
    ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0);
    ctx.moveTo(0, -radius); ctx.lineTo(0, radius);
    ctx.moveTo(-radius * 0.65, -radius);
    ctx.bezierCurveTo(radius * 0.3, -radius * 0.4, radius * 0.3, radius * 0.4, -radius * 0.65, radius);
    ctx.moveTo(radius * 0.65, -radius);
    ctx.bezierCurveTo(-radius * 0.3, -radius * 0.4, -radius * 0.3, radius * 0.4, radius * 0.65, radius);
    ctx.stroke();
    ctx.restore();
  }

  function court() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    const top = height * 0.25, bottom = height * 0.91;
    ctx.strokeRect(width * 0.035, top, width * 0.93, bottom - top);
    ctx.fillStyle = colors.surface;
    ctx.fillRect(width * 0.59, height * 0.37, width * 0.375, height * 0.36);
    ctx.strokeRect(width * 0.59, height * 0.37, width * 0.375, height * 0.36);
    ctx.beginPath();
    ctx.ellipse(width * 0.59, height * 0.55, width * 0.065, height * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(width * 0.94, height * 0.55, width * 0.52, height * 0.35, 0, Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    // Ball rack and return are quiet, utilitarian wire frames.
    ctx.strokeStyle = colors.muted;
    ctx.globalAlpha = 0.55;
    ctx.strokeRect(width * 0.055, height * 0.84, radius * 17.5, height * 0.055);
    ctx.strokeRect(width * 0.71, height * 0.81, radius * 16.8, height * 0.085);
    ctx.globalAlpha = 1;
  }

  function net() {
    const age = time - swishAt;
    const sway = age < 800 ? Math.sin(age / 70) * Math.exp(-age / 240) * radius : 0;
    const gentle = props.phase === 'finishing' ? Math.sin(time / 280) * radius * 0.35 : 0;
    const squash = age < 500 ? Math.sin(age / 500 * Math.PI) * radius * 0.65 : 0;
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const x = hoop.x - radius * 1.8 + (i / 5) * radius * 3.6;
      ctx.moveTo(x, hoop.y);
      ctx.lineTo(hoop.x + (x - hoop.x) * 0.6 + sway + gentle, hoop.y + radius * 3 - squash);
    }
    for (let i = 1; i <= 3; i++) {
      const y = hoop.y + (radius * 3 - squash) * i / 3;
      const half = radius * (1.8 - i * 0.24);
      ctx.moveTo(hoop.x - half + sway + gentle, y);
      ctx.lineTo(hoop.x + half + sway + gentle, y);
    }
    ctx.stroke();
    ctx.strokeStyle = props.phase === 'error' ? colors.alert : colors.rim;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, radius * 2, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function draw() {
    court();
    const finishing = props.phase === 'finishing';
    const reserved = finishing || props.phase === 'error' ? 1 : 0;
    const pileCount = Math.min(MAX_BALLS - shots.length - reserved,
      groupedCount(Math.max(0, settled - (finishing ? 1 : 0)), props.totalPieces));
    const rackCount = finishing || props.phase === 'completed' ? 0 : Math.min(
      groupedCount(props.totalPieces - seen.size, props.totalPieces),
      MAX_BALLS - pileCount - shots.length - reserved,
    );
    const celebrating = time - celebrationAt;
    const hop = celebrating >= 0 && celebrating < 450
      ? Math.sin(celebrating / 450 * Math.PI) * radius * 1.5 : 0;
    for (let i = 0; i < pileCount; i++) ball(pile[i].x, pile[i].y - hop, i * 0.8);
    const moving = props.phase === 'uploading' || (props.phase === 'idle' && time % 4800 < 1100);
    const dribblers = props.phase === 'idle' ? 1 : Math.min(5, props.inFlightCount ?? 0);
    for (let i = 0; i < rackCount; i++) {
      const bounce = moving && i < dribblers
        ? Math.abs(Math.sin(time / 190 + i * 0.8)) * radius * 2.8 : 0;
      ball(rack[i].x, rack[i].y - bounce, bounce * 0.07);
    }
    // Upright support and glass backboard, behind the airborne balls.
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hoop.x + radius * 3, height * 0.86);
    ctx.lineTo(hoop.x + radius * 3, hoop.y - radius * 6);
    ctx.stroke();
    ctx.fillStyle = colors.surface;
    ctx.fillRect(hoop.x + radius * 2.2, hoop.y - radius * 6, radius * 1.6, radius * 7);
    ctx.strokeRect(hoop.x + radius * 2.2, hoop.y - radius * 6, radius * 1.6, radius * 7);
    if (finishing) {
      ctx.globalAlpha = 0.12 + Math.sin(time / 380) * 0.07;
      ctx.fillStyle = colors.rim;
      ctx.beginPath(); ctx.arc(hoop.x, hoop.y, radius * 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ball(hoop.x, hoop.y - radius * 2.5);
    }
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const elapsed = time - shot.start;
      const flight = 700;
      const rimDelay = shot.index % 8 === 3 ? 150 : 0;
      if (elapsed < flight) {
        arcPosition(rack[0], hoop, elapsed / flight, height * (0.24 + (shot.index % 5) * 0.012), point);
      } else if (elapsed < flight + rimDelay) {
        const bounce = Math.sin((elapsed - flight) / rimDelay * Math.PI);
        point.x = hoop.x + bounce * radius * 1.4;
        point.y = hoop.y - bounce * radius * 2.4;
      } else {
        const t = clamp((elapsed - flight - rimDelay) / (SHOT_DURATION - flight));
        const destination = pile[Math.min(63, groupedCount(settled, props.totalPieces))];
        point.x = hoop.x + (destination.x - hoop.x) * t;
        point.y = hoop.y + (destination.y - hoop.y) * t * t;
      }
      ball(point.x, point.y, elapsed / (95 + shot.index % 23));
    }
    net();
    if (props.phase === 'error') ball(width * 0.5, height * 0.85);
    if (celebrating >= 0 && celebrating < 1200) {
      const t = celebrating / 1000;
      ctx.globalAlpha = 1 - celebrating / 1200;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.save();
        ctx.translate(hoop.x + p.vx * t, hoop.y + p.vy * t + 190 * t * t);
        ctx.rotate(p.rotation + t * 5);
        ctx.fillStyle = p.color;
        ctx.fillRect(-2, -1, 5, 3);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  function tick(now: number) {
    frame = 0;
    if (!visible || destroyed) return;
    if (last) time += Math.min(50, now - last);
    last = now;
    if (queue.length && time >= nextShot && props.phase !== 'finishing') {
      shots.push({ index: queue.shift()!, start: time, swished: false });
      nextShot = time + SHOT_STAGGER;
    }
    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i];
      const rimDelay = shot.index % 8 === 3 ? 150 : 0;
      if (!shot.swished && time - shot.start >= 700 + rimDelay) {
        shot.swished = true;
        swishAt = time;
      }
      if (time - shot.start >= SHOT_DURATION + rimDelay) {
        settled++;
        shots.splice(i, 1);
      }
    }
    if (props.phase === 'completed' && !celebrated && !queue.length && !shots.length) {
      celebrated = true;
      celebrationAt = time;
    }
    draw();
    if (props.phase !== 'paused' && props.phase !== 'error'
      && (props.phase !== 'completed' || !celebrated || time - celebrationAt < 1200)) {
      frame = requestAnimationFrame(tick);
    } else last = 0;
  }

  function wake() {
    if (visible && !frame && props.phase !== 'paused' && props.phase !== 'error' && !destroyed) {
      frame = requestAnimationFrame(tick);
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    radius = ballRadius(width, height);
    hoop.x = width * 0.84; hoop.y = height * 0.39;
    for (let i = 0; i < MAX_BALLS; i++) {
      rack[i] = rackSlot(i, width, height);
      pile[i] = pileSlot(i, width, height);
    }
    const gradient = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, 0, 0, 0, radius);
    gradient.addColorStop(0, colors.surface);
    gradient.addColorStop(0.25, colors.ball);
    gradient.addColorStop(1, colors.dark);
    ballFill = gradient;
    draw();
  }

  resize();
  return {
    resize,
    update(next) {
      const saved = validSavedIndices(next.totalPieces, next.savedIndices);
      const reset = next.totalPieces !== props.totalPieces || Array.from(seen).some((index) => !saved.has(index));
      if (reset) {
        seen = saved;
        fastForward();
        celebrated = next.phase === 'completed';
        celebrationAt = -10000; swishAt = -10000;
      } else {
        for (const index of saved) {
          if (!seen.has(index)) queue.push(index);
        }
        seen = saved;
      }
      props = next;
      // Bound the backlog. Every skipped visual still counts as a scored piece.
      if (!visible || props.phase === 'finishing') fastForward();
      else if (queue.length > 12) {
        settled += queue.length - 12;
        queue.splice(0, queue.length - 12);
      }
      if (!visible && props.phase === 'completed') celebrated = true;
      if (props.phase === 'paused' || props.phase === 'error') stop();
      if (visible) draw();
      wake();
    },
    setVisible(next) {
      if (visible === next) return;
      visible = next;
      stop();
      fastForward();
      celebrationAt = -10000;
      if (props.phase === 'completed') celebrated = true;
      if (visible) { draw(); wake(); }
    },
    destroy() { destroyed = true; stop(); },
  };
}
