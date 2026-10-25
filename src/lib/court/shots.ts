import type { CourtPhase, UploadBridge, UploadEvent } from './uploadBridge';

// ── Ballistic shots, separate from decorative physics ──
export const RIM = { x: 5.2, y: 3.55, z: -6.3 };
export const LAUNCH = { x: -7, y: 0.5, z: 4 };
export type Shot = {
  active: boolean;
  index: number;
  age: number;
  flight: number;
  swished: boolean;
  ordinal: number;
};
export function ballisticCoordinate(
  start: number,
  end: number,
  time: number,
  flight: number,
  gravity = 0,
): number {
  const velocity = (end - start - 0.5 * gravity * flight * flight) / flight;
  return start + velocity * time + 0.5 * gravity * time * time;
}
export function pilePosition(
  index: number,
  out: { x: number; y: number; z: number },
) {
  out.x = RIM.x - 1.25 + (index % 8) * 0.36;
  out.y = 0.25 + Math.floor(index / 16) * 0.39;
  out.z = RIM.z - 0.45 + (Math.floor(index / 8) % 2) * 0.4;
}
export function createShots(bridge: UploadBridge) {
  const snapshot = bridge.snapshot();
  const seen = new Set(snapshot.saved);
  const queue: number[] = [];
  const slots: Shot[] = Array.from({ length: 20 }, () => ({
    active: false,
    index: 0,
    age: 0,
    flight: 1,
    swished: false,
    ordinal: 0,
  }));
  let phase: CourtPhase = snapshot.phase,
    settled = seen.size,
    clock = 0,
    next = 0;
  let celebration = -1,
    celebrated = phase === 'completed',
    netImpulse = 0;

  // ── Event bookkeeping: duplicates never become shots ──
  function accept(event: UploadEvent) {
    if (event.type === 'reset') {
      seen.clear();
      queue.length = 0;
      settled = 0;
      phase = 'idle';
      celebration = -1;
      celebrated = false;
      netImpulse = 0;
      next = clock;
      for (const slot of slots) slot.active = false;
    } else if (event.type === 'phase') phase = event.phase;
    else if (!seen.has(event.index)) {
      seen.add(event.index);
      queue.push(event.index);
      if (queue.length > 20) {
        settled += queue.length - 20;
        queue.splice(0, queue.length - 20);
      }
    }
  }
  function fastForward() {
    settled = seen.size;
    queue.length = 0;
    for (const slot of slots) slot.active = false;
    if (phase === 'completed') celebrated = true;
    celebration = -1;
    next = clock;
  }
  function update(dt: number) {
    if (phase === 'error') return;
    clock += dt;
    netImpulse *= Math.exp(-dt * 5);
    if (celebration >= 0) celebration += dt;
    if (phase !== 'paused' && queue.length && clock >= next) {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.active) continue;
        slot.active = true;
        slot.index = queue.shift()!;
        slot.age = 0;
        slot.swished = false;
        slot.flight = 0.9 + ((slot.index * 17) % 41) / 100;
        slot.ordinal = seen.size - queue.length - 1;
        next = clock + 0.15;
        break;
      }
    }
    let active = false;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.active) continue;
      slot.age += dt;
      const rimDelay = slot.index % 8 === 3 ? 0.16 : 0;
      if (!slot.swished && slot.age >= slot.flight + rimDelay) {
        slot.swished = true;
        netImpulse = 0.25;
      }
      if (slot.age >= slot.flight + rimDelay + 0.55) {
        slot.active = false;
        settled++;
      } else active = true;
    }
    if (phase === 'completed' && !celebrated && !queue.length && !active) {
      celebrated = true;
      celebration = 0;
    }
  }
  return {
    accept,
    update,
    fastForward,
    slots,
    state: {
      get phase() {
        return phase;
      },
      get settled() {
        return settled;
      },
      get saved() {
        return seen.size;
      },
      get queued() {
        return queue.length;
      },
      get celebration() {
        return celebration;
      },
      get netImpulse() {
        return netImpulse;
      },
    },
  };
}

// ── Reusable output avoids allocating a vector per animated ball ──
export function shotPosition(
  shot: Shot,
  out: { x: number; y: number; z: number },
) {
  if (shot.age <= shot.flight) {
    out.x = ballisticCoordinate(LAUNCH.x, RIM.x, shot.age, shot.flight);
    out.y = ballisticCoordinate(LAUNCH.y, RIM.y, shot.age, shot.flight, -9.81);
    out.z = ballisticCoordinate(LAUNCH.z, RIM.z, shot.age, shot.flight);
  } else {
    const delay = shot.index % 8 === 3 ? 0.16 : 0;
    if (shot.age < shot.flight + delay) {
      const bounce = Math.sin(((shot.age - shot.flight) / delay) * Math.PI);
      out.x = RIM.x + bounce * 0.3;
      out.y = RIM.y + bounce * 0.55;
      out.z = RIM.z;
    } else {
      pilePosition(shot.ordinal % 64, out);
      const t = Math.min(1, (shot.age - shot.flight - delay) / 0.55);
      out.x = RIM.x + (out.x - RIM.x) * t;
      out.y = RIM.y + (out.y - RIM.y) * t * t;
      out.z = RIM.z + (out.z - RIM.z) * t;
    }
  }
}
