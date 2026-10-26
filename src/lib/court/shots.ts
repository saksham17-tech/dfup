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
  queued: boolean;
  scored: boolean;
  hovering: boolean; hoverAge: number; lane: number; floorIndex: number;
  originX: number; originY: number; originZ: number;
  fromX: number; fromY: number; fromZ: number; radius: number;
  rotationX: number; rotationY: number; rotationZ: number;
};
export type FloorInventory = {
  rebuild: (count: number, drop: boolean) => void;
  reserve: (shot: Shot) => void;
  restore?: (shot: Shot) => void;
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
  out.x = RIM.x - 1.2 + (index % 5) * 0.6;
  out.y = 0.3 + Math.floor(index / 10) * 0.48;
  out.z = RIM.z - 0.3 + (Math.floor(index / 5) % 2) * 0.58;
}
export function createShots(bridge: UploadBridge, inventory?: FloorInventory) {
  const snapshot = bridge.snapshot();
  const seen = new Set(snapshot.saved);
  const queue: number[] = [];
  const slots: Shot[] = Array.from({ length: 40 }, () => ({
    active: false,
    index: -1,
    age: 0,
    flight: 1,
    swished: false,
    ordinal: 0,
    queued: false, scored: false, fromX: LAUNCH.x, fromY: LAUNCH.y, fromZ: LAUNCH.z,
    radius: 0.27, rotationX: 0, rotationY: 0, rotationZ: 0,
    hovering: false, hoverAge: 0, lane: 0, floorIndex: -1,
    originX: LAUNCH.x, originY: LAUNCH.y, originZ: LAUNCH.z,
  }));
  let count = snapshot.view === 'browse' ? 10 : snapshot.phase === 'idle' ? 24 : Math.min(40, snapshot.total);
  let issued = 0, fired = 0;
  let phase: CourtPhase = snapshot.phase,
    settled = Math.floor(seen.size * count / snapshot.total),
    clock = 0,
    next = 0;
  let celebration = -1,
    celebrated = phase === 'completed',
    netImpulse = 0;
  inventory?.rebuild(count, phase === 'idle' && snapshot.view === 'upload');

  const freeSlot = () => slots.slice(0, count).find(slot => !slot.scored && !slot.active && !slot.queued && !slot.hovering && slot.index < 0)
    ?? slots.slice(0, count).find(slot => !slot.scored && !slot.active && !slot.queued && !slot.hovering);
  function returnToFloor(slot: Shot) {
    slot.hovering = false; slot.hoverAge = 0;
    inventory?.restore?.(slot);
  }
  function reserveOwed(index = -1) {
    if (bridge.snapshot().view === 'browse') return;
    const owed = Math.floor(seen.size * count / bridge.snapshot().total);
    while (issued < owed) {
      const slot = slots.find(candidate => candidate.index === index && !candidate.scored && !candidate.active && !candidate.queued) ?? freeSlot();
      if (!slot) throw new Error('Upload ball inventory exhausted');
      if (slot.hovering) {
        const point = { x: 0, y: 0, z: 0 }; hoverPosition(slot, point);
        slot.fromX = point.x; slot.fromY = point.y; slot.fromZ = point.z;
        slot.hovering = false;
      } else inventory?.reserve(slot);
      slot.index = index < 0 ? issued : index; slot.ordinal = issued; slot.active = false;
      slot.queued = true; slot.age = 0; slot.swished = false;
      queue.push(slots.indexOf(slot)); issued++;
    }
    if (queue.length > 20) {
      const extra = queue.length - 20;
      for (let i = 0; i < extra; i++) { slots[queue[i]].queued = false; slots[queue[i]].scored = true; }
      settled += extra; fired += extra; queue.splice(0, extra);
    }
    // Above 40 pieces, confirmations that do not complete a visual share return
    // their borrowed ball. The next owed share uses its own confirming ball.
    const partial = slots.find(slot => slot.index === index && slot.hovering);
    if (partial) { returnToFloor(partial); partial.index = -1; }
  }
  function syncActivity(indices: readonly number[]) {
    const pending = phase === 'uploading' || phase === 'finishing'
      ? new Set(indices.filter(index => !seen.has(index))) : new Set<number>();
    for (const slot of slots) if (slot.hovering && !pending.has(slot.index)) returnToFloor(slot);
    if (bridge.snapshot().view === 'browse') return;
    for (const index of pending) {
      let slot = slots.find(candidate => candidate.index === index && !candidate.scored && !candidate.active && !candidate.queued);
      if (slot?.hovering) continue;
      slot ??= freeSlot();
      if (!slot) continue;
      slot.index = index;
      slot.lane = 0;
      while (slots.some(other => other !== slot && other.hovering && other.lane === slot.lane)) slot.lane++;
      inventory?.reserve(slot);
      slot.hovering = true; slot.hoverAge = 0;
    }
  }
  // Hydration / late lazy loading reconciles confirmed balls directly into the return.
  reserveOwed();
  for (let i = 0; i < slots.length; i++) { slots[i].queued = false; slots[i].scored = i < issued; }
  queue.length = 0; fired = issued; settled = issued;
  syncActivity([...snapshot.inFlight]);

  // ── Event bookkeeping: duplicates never become shots ──
  function accept(event: UploadEvent) {
    if (event.type === 'reset' || event.type === 'configure' || event.type === 'view') {
      seen.clear();
      queue.length = 0;
      settled = 0;
      phase = event.type === 'configure' ? 'uploading' : 'idle';
      count = bridge.snapshot().view === 'browse' ? 10 : event.type === 'configure' ? Math.min(40, event.total) : 24;
      issued = 0; fired = 0;
      inventory?.rebuild(count, phase === 'idle' && bridge.snapshot().view === 'upload');
      celebration = -1;
      celebrated = false;
      netImpulse = 0;
      next = clock;
      for (const slot of slots) { slot.active = false; slot.queued = false; slot.scored = false; slot.hovering = false; slot.index = -1; slot.floorIndex = -1; }
    } else if (event.type === 'phase') {
      if (phase === 'idle' && event.phase !== 'idle' && bridge.snapshot().view === 'upload') prepareUpload();
      phase = event.phase;
      if (phase !== 'uploading' && phase !== 'finishing') syncActivity([]);
    }
    else if (event.type === 'activity') {
      if (phase === 'idle' && event.indices.length) prepareUpload();
      syncActivity(event.indices);
    }
    else if (!seen.has(event.index)) {
      if (phase === 'idle') prepareUpload();
      seen.add(event.index);
      reserveOwed(event.index);
    }
  }
  function fastForward() {
    reserveOwed();
    settled = issued; fired = issued;
    queue.length = 0;
    for (const slot of slots) {
      if (slot.active || slot.queued) slot.scored = true;
      slot.active = false; slot.queued = false;
    }
    syncActivity([...bridge.snapshot().inFlight]);
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
        const slot = slots[queue.shift()!];
        slot.active = true;
        slot.queued = false; fired++;
        slot.age = 0;
        slot.swished = false;
        slot.flight = Math.max(0.9, Math.min(1.6, 0.9 + Math.hypot(RIM.x - slot.fromX, RIM.z - slot.fromZ) / 40));
        next = clock + 0.15;
    }
    let active = false;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.hovering) slot.hoverAge += dt;
      if (!slot.active) continue;
      slot.age += dt;
      const rimDelay = slot.index % 8 === 3 ? 0.16 : 0;
      if (!slot.swished && slot.age >= slot.flight + rimDelay) {
        slot.swished = true;
        netImpulse = 0.25;
      }
      if (slot.age >= slot.flight + rimDelay + 0.55) {
        slot.active = false;
        slot.scored = true;
        settled++;
      } else active = true;
    }
    if (phase === 'completed' && !celebrated && !queue.length && !active) {
      celebrated = true;
      celebration = 0;
    }
  }
  function prepareUpload() {
    const nextCount = Math.min(40, bridge.snapshot().total);
    if (count !== nextCount || phase === 'idle') {
      count = nextCount; inventory?.rebuild(count, false);
    }
    phase = 'uploading';
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
      get ballCount() { return count; },
      get hovering() { return slots.filter(slot => slot.hovering).length; },
      get confirmed() { return issued; },
      get remaining() { return count - issued - slots.filter(slot => slot.hovering).length; },
      get shotsFired() { return fired; },
    },
  };
}

// ── Reusable output avoids allocating a vector per animated ball ──
export function hoverPosition(shot: Shot, out: { x: number; y: number; z: number }) {
  const t = Math.min(1, shot.hoverAge / 0.5), eased = t * t * (3 - 2 * t);
  out.x = shot.originX + (RIM.x - 2.3 + shot.lane * 1.05 - shot.originX) * eased;
  out.z = shot.originZ + (RIM.z + 4.5 + (shot.lane % 2) * .8 - shot.originZ) * eased;
  out.y = shot.originY + (1.1 + Math.sin(shot.hoverAge * 3 + shot.lane) * .08 - shot.originY) * eased;
}

export function shotPosition(
  shot: Shot,
  out: { x: number; y: number; z: number },
) {
  if (shot.age <= shot.flight) {
    out.x = ballisticCoordinate(shot.fromX, RIM.x, shot.age, shot.flight);
    out.y = ballisticCoordinate(shot.fromY, RIM.y, shot.age, shot.flight, -9.81);
    out.z = ballisticCoordinate(shot.fromZ, RIM.z, shot.age, shot.flight);
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
