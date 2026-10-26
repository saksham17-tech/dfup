const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/upload-fixtures.cjs');
const physics = loadTs('src/lib/court/physics.ts');
const { createUploadBridge } = loadTs('src/lib/court/uploadBridge.ts');
const { createShots, ballisticCoordinate, RIM, LAUNCH } = loadTs(
  'src/lib/court/shots.ts',
);

// ── Physics invariants, independent of DOM and Three.js ──
test('sphere collision impulses never increase kinetic energy', () => {
  const random = physics.seededRandom(51);
  const world = physics.createWorld(2, 14, false);
  const [a, b] = world.balls;
  const energy = () =>
    (a.mass * (a.vx ** 2 + a.vy ** 2 + a.vz ** 2) +
      b.mass * (b.vx ** 2 + b.vy ** 2 + b.vz ** 2)) /
    2;
  for (let i = 0; i < 2000; i++) {
    a.x = 0;
    a.y = 2;
    a.z = 0;
    b.x = 1.5;
    b.y = 2;
    b.z = 0;
    a.radius = b.radius = 1;
    a.mass = 0.3 + random() * 3;
    b.mass = 0.3 + random() * 3;
    a.vx = random() * 5;
    b.vx = -random() * 5;
    a.vy = random() * 3;
    b.vy = random() * 3;
    a.vz = random() * 3;
    b.vz = random() * 3;
    const before = energy();
    physics.collide(a, b);
    assert.ok(energy() <= before + 1e-9);
  }
});

test('a dropped ball rebounds to approximately restitution squared times its drop height', () => {
  const world = physics.createWorld(1, 1, false),
    b = world.balls[0];
  Object.assign(b, {
    x: 0,
    y: 5.5,
    z: 0,
    radius: 0.5,
    restitution: 0.78,
    vx: 0,
    vy: 0,
    vz: 0,
  });
  let bounced = false,
    peak = 0;
  for (let i = 0; i < 400; i++) {
    physics.stepWorld(world);
    if (b.vy > 0) bounced = true;
    if (bounced) {
      peak = Math.max(peak, b.y - b.radius);
      if (b.vy <= 0) break;
    }
  }
  assert.ok(
    Math.abs(peak - 5 * 0.78 ** 2) < 0.08,
    `Rebound height was ${peak}`,
  );
});

test('35 colliding, sleeping and nudged balls remain finite after 10,000 steps', () => {
  const world = physics.createWorld(35, 934);
  for (let i = 0; i < 10000; i++) physics.stepWorld(world);
  for (const ball of world.balls) {
    for (const value of Object.values(ball))
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.ok(ball.y >= ball.radius);
    assert.ok(Math.abs(ball.x) < 15 && ball.z > -13 && ball.z < 18);
  }
});

test('fixed seed is reproducible and a hidden-tab catch-up is capped at five steps', () => {
  const a = physics.createWorld(28, 123),
    b = physics.createWorld(28, 123);
  assert.deepEqual(a.balls, b.balls);
  physics.advanceWorld(a, 30);
  for (let i = 0; i < 5; i++) physics.stepWorld(b);
  assert.deepEqual(a.balls, b.balls);
});

// ── Bridge diff: only first-time server confirmations emit shots ──
test('duplicates and invalid indices are ignored across pause, failure and resume', () => {
  const bridge = createUploadBridge(),
    events = [];
  bridge.subscribe((event) => {
    if (event.type === 'saved') events.push(event.index);
  });
  bridge.reconcile([0, 0, -1, 20, 0.5], 'uploading', 10, 'file-a');
  bridge.reconcile([0], 'paused', 10, 'file-a');
  bridge.reconcile([0], 'error', 10, 'file-a');
  bridge.reconcile([0, 1], 'uploading', 10, 'file-a');
  bridge.reconcile([0, 1], 'uploading', 10, 'file-a');
  assert.deepEqual(events, [0, 1]);
});

test('cancel/reset and selecting another file clear deduplication; demo remains isolated', () => {
  const bridge = createUploadBridge(),
    demo = createUploadBridge(true),
    events = [];
  bridge.subscribe((event) => {
    if (event.type === 'saved') events.push(event.index);
  });
  bridge.reconcile([0], 'uploading', 48, 'a');
  bridge.reconcile([], 'idle', 48);
  assert.equal(bridge.snapshot().saved.size, 0);
  bridge.reconcile([0], 'uploading', 48, 'b');
  bridge.reconcile([0], 'uploading', 48, 'c');
  demo.reconcile([0, 1, 2], 'uploading', 48, 'demo');
  assert.deepEqual(events, [0, 0, 0]);
  assert.equal(bridge.snapshot().saved.size, 1);
  assert.equal(demo.snapshot().saved.size, 3);
});

test('a failed animation subscriber cannot interrupt upload progress or other listeners', () => {
  const bridge = createUploadBridge();
  bridge.configure(4);
  let seen = 0;
  bridge.subscribe(() => {
    throw new Error('renderer failure');
  });
  bridge.subscribe(() => seen++);
  assert.doesNotThrow(() => bridge.chunkSaved(0));
  assert.equal(seen, 1);
  assert.equal(bridge.snapshot().saved.size, 1);
});

// ── Shot queue, pause semantics, hidden-tab reconciliation and completion ──
function system(total = 26) {
  const bridge = createUploadBridge();
  bridge.configure(total);
  bridge.resumed();
  const shots = createShots(bridge);
  bridge.subscribe(shots.accept);
  return {
    bridge,
    shots,
    advance(seconds) {
      for (let t = 0; t < seconds; t += 1 / 120) shots.update(1 / 120);
    },
  };
}

test('each ballistic flight passes through the centre of the rim', () => {
  for (const flight of [0.9, 1.1, 1.3]) {
    assert.ok(
      Math.abs(
        ballisticCoordinate(LAUNCH.y, RIM.y, flight, flight, -9.81) - RIM.y,
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(ballisticCoordinate(LAUNCH.x, RIM.x, flight, flight) - RIM.x) <
        1e-10,
    );
  }
});

test('paused queued shots wait while in-flight arcs finish, then resume without repeats', () => {
  const s = system();
  for (let i = 0; i < 8; i++) s.bridge.chunkSaved(i);
  s.advance(0.2);
  s.bridge.paused();
  const waiting = s.shots.state.queued;
  s.advance(3);
  assert.equal(s.shots.state.queued, waiting);
  assert.equal(s.shots.state.settled, 8 - waiting);
  s.bridge.resumed();
  s.advance(4);
  assert.equal(s.shots.state.settled, 8);
  s.bridge.chunkSaved(0);
  s.advance(1);
  assert.equal(s.shots.state.settled, 8);
});

test('backlogs fast-forward every extra piece and hidden-tab return never replays them', () => {
  const s = system(1000);
  for (let i = 0; i < 1000; i++) s.bridge.chunkSaved(i);
  assert.equal(s.shots.state.queued, 20);
  assert.equal(s.shots.state.settled, 20);
  s.shots.fastForward();
  s.advance(30);
  assert.equal(s.shots.state.settled, 40);
  assert.equal(s.shots.state.queued, 0);
});

test('grouped confirmations remove exactly floor(saved * balls / total) floor balls', () => {
  const s = system(52);
  assert.equal(s.shots.state.ballCount, 40);
  for (let i = 0; i < 52; i++) {
    s.bridge.chunkSaved(i);
    assert.equal(s.shots.state.remaining, 40 - Math.floor((i + 1) * 40 / 52));
    s.bridge.chunkSaved(i);
    assert.equal(s.shots.state.remaining, 40 - Math.floor((i + 1) * 40 / 52));
  }
  s.advance(8);
  assert.equal(s.shots.state.settled, 40);
  assert.equal(s.shots.state.saved, 52);
});

test('scoring reuses the selected floor ball origin and radius', () => {
  const bridge = createUploadBridge(); bridge.configure(26); bridge.resumed();
  const rebuilds = [], reserved = [];
  const shots = createShots(bridge, { rebuild: (...args) => rebuilds.push(args), reserve(shot) {
    shot.fromX = 3; shot.fromY = .32; shot.fromZ = 5; shot.radius = .32;
    reserved.push(shot.ordinal);
  } });
  bridge.subscribe(shots.accept);
  bridge.chunkSaved(0); shots.update(.01);
  assert.equal(reserved.length, 1);
  assert.equal(shots.slots[0].fromX, 3); assert.equal(shots.slots[0].radius, .32);
  assert.equal(shots.state.remaining, 25);
  bridge.reset(); assert.equal(shots.state.ballCount, 24);
  bridge.setView('browse'); assert.equal(shots.state.ballCount, 10);
  bridge.setView('upload'); assert.equal(shots.state.ballCount, 24);
});

test('late loading reconciles a large confirmed backlog without double-counting the pile', () => {
  const bridge = createUploadBridge();
  bridge.reconcile(Array.from({ length: 52 }, (_, i) => i), 'completed', 52, 'late');
  const shots = createShots(bridge);
  assert.equal(shots.state.settled, 40);
  assert.equal(shots.state.remaining, 0);
  assert.equal(shots.slots.filter(slot => slot.scored).length, 40);
  shots.update(30);
  assert.equal(shots.state.settled, 40);
});

test('idle physics settles and disabled floor balls never move', () => {
  const world = physics.createWorld(24, 123, false);
  for (let i = 0; i < 10000; i++) physics.stepWorld(world);
  assert.ok(world.balls.every(ball => ball.sleeping));
  const ball = world.balls[0]; ball.enabled = false;
  const before = { ...ball };
  for (let i = 0; i < 120; i++) physics.stepWorld(world);
  assert.deepEqual(ball, before);
});

test('the real compact uploader renders one saved status and replaces it for finishing or error', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const progress = loadTs('src/components/CourtProgress.tsx', {
    './CourtEnvironment': { useCourtAvailable: () => true },
    './ChunkStrip': loadTs('src/components/ChunkStrip.tsx'),
    '@/lib/courtMath': loadTs('src/lib/courtMath.ts'),
  });
  for (const status of ['uploading', 'paused', 'processing', 'error', 'completed']) {
    let hook = 0;
    const uploader = loadTs('src/components/FileUploader.tsx', {
      react: { ...React, useState(initial) {
        const index = hook++;
        return React.useState(index === 0 ? {
          fileId: 'synthetic', status, progress: 15, totalBytes: 208 * 1024 * 1024,
          uploadedBytes: 32 * 1024 * 1024, uploadedChunks: [0,1,2,3,4,5,6,7],
          error: 'A piece failed. Retry to continue.',
        } : index === 1 ? 'large-upload.bin' : initial);
      } },
      '@/lib/upload': { CHUNK_SIZE: 4 * 1024 * 1024, MAX_CONCURRENT_UPLOADS: 4 },
      '@/lib/court/uploadBridge': { uploadBridge: createUploadBridge() },
      '@/lib/ui': loadTs('src/lib/ui.ts'),
      'lucide-react': Object.fromEntries(['Pause', 'Play', 'X', 'RotateCcw', 'Minus', 'Maximize2'].map(name => [name, () => null])),
      './CourtProgress': progress,
    });
    const html = renderToStaticMarkup(React.createElement(uploader.default));
    assert.ok(html.includes('title="large-upload.bin"'));
    assert.ok(html.includes('upload-dock'));
    assert.ok(html.includes('upload-progress-slot'));
    assert.equal((html.match(/8 of 52 saved/g) || []).length,
      status === 'processing' || status === 'error' ? 0 : 1);
    if (status === 'processing') assert.ok(html.includes('Last piece sent. Confirming with the server…'));
    if (status === 'error') assert.ok(html.includes('A piece failed. Retry to continue.'));
    assert.ok(html.includes('aria-label="Minimize upload bar"'));
  }
});

test('completion celebrates once; failure freezes shots and reset clears the pile', () => {
  const s = system();
  s.bridge.chunkSaved(0);
  s.advance(0.2);
  s.bridge.failed();
  const age = s.shots.slots[0].age;
  s.advance(1);
  assert.equal(s.shots.slots[0].age, age);
  s.bridge.resumed();
  s.bridge.completed();
  s.advance(3);
  assert.equal(s.shots.state.settled, 1);
  assert.ok(s.shots.state.celebration >= 0);
  s.advance(3);
  const celebration = s.shots.state.celebration;
  s.bridge.completed();
  s.advance(1);
  assert.ok(s.shots.state.celebration > celebration);
  s.bridge.reset();
  assert.equal(s.shots.state.settled, 0);
  assert.equal(s.shots.state.queued, 0);
});

// ── Accessibility preference and renderer-independent initial markup ──
test('reduced-motion hook reacts to native media changes and removes its listener', () => {
  const React = require('react');
  let state,
    effect,
    listener,
    removed = false;
  const media = {
    matches: false,
    addEventListener(event, callback) {
      assert.equal(event, 'change');
      listener = callback;
    },
    removeEventListener(event, callback) {
      assert.equal(callback, listener);
      removed = true;
    },
  };
  const environment = loadTs(
    'src/components/CourtEnvironment.tsx',
    {
      react: {
        ...React,
        useState(initial) {
          state = initial;
          return [
            state,
            (next) => {
              state = next;
            },
          ];
        },
        useEffect(callback) {
          effect = callback;
        },
      },
      'next/dynamic': () => () => null,
      '@/lib/court/fallback': { warnCourtFailure() {} },
    },
    { window: { matchMedia: () => media } },
  );
  assert.equal(environment.useReducedCourtMotion(), true);
  const cleanup = effect();
  assert.equal(state, false);
  media.matches = true;
  listener();
  assert.equal(state, true);
  media.matches = false;
  listener();
  assert.equal(state, false);
  cleanup();
  assert.equal(removed, true);
});

test('the static fallback renders accessible saved progress without constructing WebGL', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const environment = loadTs('src/components/CourtEnvironment.tsx', {
    'next/dynamic': () => () => {
      throw new Error('WebGL must not load during SSR');
    },
    '@/lib/court/fallback': { warnCourtFailure() {} },
  });
  const progress = loadTs('src/components/CourtProgress.tsx', {
    './CourtEnvironment': environment,
    './ChunkStrip': loadTs('src/components/ChunkStrip.tsx'),
    '@/lib/courtMath': loadTs('src/lib/courtMath.ts'),
  });
  const html = renderToStaticMarkup(
    React.createElement(
      environment.default,
      { bridge: createUploadBridge() },
      React.createElement(progress.default, {
        totalPieces: 26,
        savedIndices: [0, 1, 2],
        phase: 'paused',
        label: 'Upload progress',
        progress: 12,
      }),
    ),
  );
  assert.ok(!html.includes('<canvas'));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(html.includes('aria-label="Upload progress"'));
  assert.ok(html.includes('aria-valuenow="12"'));
  assert.equal((html.match(/class="chunk-fill"/g) || []).length, 26);
});
