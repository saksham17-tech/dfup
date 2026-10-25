// ── Types and reproducible randomness ──
export const FIXED_STEP = 1 / 120;
export const GRAVITY = 9.81;
export type Ball = {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  ax: number;
  ay: number;
  az: number;
  pax: number;
  pay: number;
  paz: number;
  radius: number;
  mass: number;
  restitution: number;
  sleeping: boolean;
  rest: number;
  wakeIn: number;
};
export type World = {
  balls: Ball[];
  random: () => number;
  nudges: boolean;
  count: number;
  accumulator: number;
};

export function seededRandom(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value += 0x6d2b79f5;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(count = 28, seed = 123, nudges = true): World {
  const random = seededRandom(seed);
  const balls: Ball[] = [];
  for (let i = 0; i < count; i++) {
    const radius = 0.27 + random() * 0.54;
    const x = (random() - 0.5) * 26,
      z = random() * 25 - 10,
      y = radius + random() * 6;
    balls.push({
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      vx: (random() - 0.5) * 5,
      vy: random() * 2,
      vz: (random() - 0.5) * 4,
      wx: random() * 5,
      wy: random() * 5,
      wz: random() * 5,
      ax: 0,
      ay: 0,
      az: 0,
      pax: 0,
      pay: 0,
      paz: 0,
      radius,
      mass: radius ** 3 * 8,
      restitution: 0.78 * (0.92 + random() * 0.16),
      sleeping: false,
      rest: 0,
      wakeIn: 2 + random() * 4,
    });
  }
  return { balls, random, nudges, count, accumulator: 0 };
}

// ── Sphere impulses: no energy is introduced by collision response ──
export function collide(a: Ball, b: Ball): void {
  let nx = b.x - a.x,
    ny = b.y - a.y,
    nz = b.z - a.z;
  const distanceSquared = nx * nx + ny * ny + nz * nz;
  const radius = a.radius + b.radius;
  if (distanceSquared >= radius * radius) return;
  const distance = Math.sqrt(distanceSquared);
  if (distance < 1e-8) {
    nx = 1;
    ny = 0;
    nz = 0;
  } else {
    nx /= distance;
    ny /= distance;
    nz /= distance;
  }
  const inverseA = 1 / a.mass,
    inverseB = 1 / b.mass,
    inverseSum = inverseA + inverseB;
  const correction =
    (Math.max(0, radius - distance - 0.001) * 0.65) / inverseSum;
  a.x -= nx * correction * inverseA;
  a.y -= ny * correction * inverseA;
  a.z -= nz * correction * inverseA;
  b.x += nx * correction * inverseB;
  b.y += ny * correction * inverseB;
  b.z += nz * correction * inverseB;
  const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
  if (approach >= 0) return;
  const impulse =
    (-(1 + Math.min(a.restitution, b.restitution)) * approach) / inverseSum;
  a.vx -= impulse * nx * inverseA;
  a.vy -= impulse * ny * inverseA;
  a.vz -= impulse * nz * inverseA;
  b.vx += impulse * nx * inverseB;
  b.vy += impulse * ny * inverseB;
  b.vz += impulse * nz * inverseB;
  if (Math.abs(approach) > 0.12) {
    a.sleeping = false;
    b.sleeping = false;
    a.rest = 0;
    b.rest = 0;
  }
}

// ── Fixed-step integration, floor friction, sleep and soft walls ──
export function stepWorld(world: World, dt = FIXED_STEP): void {
  const balls = world.balls;
  for (let i = 0; i < world.count; i++) {
    const b = balls[i];
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    b.pax = b.ax;
    b.pay = b.ay;
    b.paz = b.az;
    if (b.sleeping) {
      if (!world.nudges || (b.wakeIn -= dt) > 0) continue;
      b.sleeping = false;
      b.rest = 0;
      b.vx = (world.random() - 0.5) * 2.2;
      b.vz = (world.random() - 0.5) * 2.2;
      b.vy = 1 + world.random() * 3;
      b.wakeIn = 2 + world.random() * 4;
    }
    b.vy -= GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (b.y < b.radius) {
      b.y = b.radius;
      if (b.vy < -0.35) b.vy = -b.vy * b.restitution;
      else b.vy = 0;
      const speed = Math.hypot(b.vx, b.vz);
      const slip = Math.hypot(b.vx + b.wz * b.radius, b.vz - b.wx * b.radius);
      const friction = slip < 0.2 ? 0.035 : 0.19;
      const scale =
        speed > 0 ? Math.max(0, 1 - (friction * GRAVITY * dt) / speed) : 0;
      b.vx *= scale;
      b.vz *= scale;
      // Approach the no-slip rolling constraint without adding linear energy.
      b.wz += (-b.vx / b.radius - b.wz) * Math.min(1, dt * 18);
      b.wx += (b.vz / b.radius - b.wx) * Math.min(1, dt * 18);
      if (Math.hypot(b.vx, b.vy, b.vz) < 0.12) b.rest += dt;
      else b.rest = 0;
      if (b.rest > 0.65) {
        b.sleeping = true;
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        b.wx = 0;
        b.wy = 0;
        b.wz = 0;
      }
    }
    const left = -14 + b.radius,
      right = 14 - b.radius;
    if (b.x < left) {
      b.vx = Math.max(0, -b.vx * 0.6) + (left - b.x) * dt * 20;
      b.x += (left - b.x) * 0.15;
    }
    if (b.x > right) {
      b.vx = Math.min(0, -b.vx * 0.6) - (b.x - right) * dt * 20;
      b.x -= (b.x - right) * 0.15;
    }
    if (b.z < -12 + b.radius) {
      b.vz = Math.abs(b.vz) * 0.6;
      b.z += (-12 + b.radius - b.z) * 0.2;
    }
    if (b.z > 17 - b.radius) {
      b.vz = -Math.abs(b.vz) * 0.6;
      b.z -= (b.z - 17 + b.radius) * 0.2;
    }
    const damping = Math.exp(-0.28 * dt);
    b.wx *= damping;
    b.wy *= damping;
    b.wz *= damping;
    b.ax += b.wx * dt;
    b.ay += b.wy * dt;
    b.az += b.wz * dt;
  }
  for (let i = 0; i < world.count; i++)
    for (let j = i + 1; j < world.count; j++) collide(balls[i], balls[j]);
  for (let i = 0; i < world.count; i++)
    balls[i].y = Math.max(balls[i].radius, balls[i].y);
}

export function advanceWorld(world: World, elapsed: number): number {
  world.accumulator += Math.max(0, Math.min(elapsed, FIXED_STEP * 5));
  let steps = 0;
  while (world.accumulator >= FIXED_STEP && steps < 5) {
    stepWorld(world);
    world.accumulator -= FIXED_STEP;
    steps++;
  }
  return world.accumulator / FIXED_STEP;
}
