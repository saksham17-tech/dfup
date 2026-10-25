const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let THREE;
before(async () => { THREE = await import('three'); });
const { loadTs } = require('./helpers/upload-fixtures.cjs');
const physics = loadTs('src/lib/court/physics.ts');
const bridgeModule = loadTs('src/lib/court/uploadBridge.ts');
const shotModule = loadTs('src/lib/court/shots.ts');

// ── Real scene lifecycle with a GPU adapter; no browser or live upload is required ──
function harness() {
  const frames = new Map(),
    windowEvents = new Map(),
    documentEvents = new Map();
  const failures = [],
    observers = [],
    maps = [];
  let id = 0,
    now = 0,
    interval,
    renderer;
  const document = {
    hidden: false,
    addEventListener: (name, fn) => documentEvents.set(name, fn),
    removeEventListener: (name) => documentEvents.delete(name),
  };
  const host = { clientWidth: 1920, clientHeight: 1080, appendChild() {} };
  class Renderer {
    constructor() {
      renderer = this;
      this.shadowMap = {};
      this.renders = 0;
      this.disposals = 0;
      this.losses = 0;
      this.events = new Map();
      this.domElement = {
        setAttribute() {},
        addEventListener: (name, fn) => this.events.set(name, fn),
        removeEventListener: (name) => this.events.delete(name),
        remove() {},
      };
    }
    setPixelRatio(value) {
      this.dpr = value;
    }
    setSize() {}
    render(scene) {
      if (this.shouldThrow) throw new Error('GPU render failed');
      this.renders++;
      this.scene = scene;
    }
    dispose() {
      this.disposals++;
    }
    forceContextLoss() {
      this.losses++;
    }
  }
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const texture = () => {
    const map = new THREE.Texture();
    map.addEventListener('dispose', () => {
      map.wasDisposed = true;
    });
    maps.push(map);
    return map;
  };
  const { mountCourt } = loadTs(
    'src/lib/court/scene.ts',
    {
      three: { ...THREE, WebGLRenderer: Renderer },
      './physics': physics,
      './shots': shotModule,
      './textures': {
        basketballTexture: texture,
        contactTexture: texture,
        hardwoodTexture: texture,
      },
    },
    {
      document,
      window: {
        innerWidth: 1920,
        devicePixelRatio: 2,
        addEventListener: (name, fn) => windowEvents.set(name, fn),
        removeEventListener: (name) => windowEvents.delete(name),
        matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
      },
      getComputedStyle: () => ({ getPropertyValue: () => '#e8651a' }),
      IntersectionObserver: Observer,
      ResizeObserver: Observer,
      performance: { now: () => now },
      requestAnimationFrame: (callback) => {
        frames.set(++id, callback);
        return id;
      },
      cancelAnimationFrame: (key) => frames.delete(key),
      setInterval: (callback) => {
        interval = callback;
        return 1;
      },
      clearInterval: () => {
        interval = null;
      },
    },
  );
  const bridge = bridgeModule.createUploadBridge();
  bridge.reconcile([], 'uploading', 26, 'test-file');
  const dispose = mountCourt(host, bridge, {
    seed: 123,
    perf: false,
    onFailure: (error) => failures.push(error),
  });
  return {
    bridge,
    host,
    document,
    frames,
    failures,
    renderer,
    observers,
    maps,
    dispose,
    windowEvents,
    documentEvents,
    frame(ms = 16) {
      now += ms;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    },
    visibility(hidden) {
      document.hidden = hidden;
      documentEvents.get('visibilitychange')();
    },
    measure(ms) {
      now += ms;
      interval();
    },
  };
}

test('a 30-second visibility gap fast-forwards confirmed pieces without replaying a backlog', () => {
  const h = harness();
  h.frame();
  h.visibility(true);
  const rendered = h.renderer.renders;
  for (let index = 0; index < 26; index++) h.bridge.chunkSaved(index);
  h.frame(30000);
  assert.equal(h.renderer.renders, rendered);
  assert.equal(h.frames.size, 0);
  h.visibility(false);
  h.frame();
  const batches = h.renderer.scene.children.filter(
    (object) => object.isInstancedMesh,
  );
  assert.equal(batches[1].count, 26);
  assert.equal(h.failures.length, 0);
  h.dispose();
});

test('off-screen rendering stops and unmount removes frames, subscriptions, observers and GPU resources', () => {
  const h = harness();
  h.frame();
  h.observers[0].callback([{ isIntersecting: false }]);
  assert.equal(h.frames.size, 0);
  h.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(h.frames.size, 1);
  h.dispose();
  h.dispose();
  assert.equal(h.frames.size, 0);
  assert.equal(h.renderer.disposals, 1);
  assert.equal(h.renderer.losses, 1);
  assert.equal(h.windowEvents.size + h.documentEvents.size, 0);
  assert.ok(h.observers.every((observer) => observer.disconnected));
  assert.ok(h.maps.every((map) => map.wasDisposed));
  assert.doesNotThrow(() => h.bridge.chunkSaved(0));
  assert.equal(h.frames.size, 0);
});

test('context loss and frame errors release the scene and leave upload confirmation available', () => {
  for (const kind of ['context', 'frame']) {
    const h = harness();
    if (kind === 'context')
      h.renderer.events.get('webglcontextlost')({ preventDefault() {} });
    else {
      h.renderer.shouldThrow = true;
      h.frame();
    }
    assert.equal(h.failures.length, 1);
    assert.equal(h.renderer.disposals, 1);
    assert.equal(h.frames.size, 0);
    h.bridge.chunkSaved(0);
    assert.equal(h.bridge.snapshot().saved.size, 1);
    h.dispose();
  }
});

test('quality only steps down and mobile resize uses twelve balls', () => {
  const h = harness();
  h.frame();
  h.measure(2000);
  h.frame();
  let batches = h.renderer.scene.children.filter(
    (object) => object.isInstancedMesh,
  );
  assert.equal(batches[0].count, 12);
  assert.equal(h.renderer.dpr, 1);
  for (let i = 0; i < 150; i++) h.frame(16);
  h.measure(1);
  h.frame();
  assert.equal(batches[0].count, 12);
  assert.equal(h.renderer.dpr, 1);
  h.host.clientWidth = 390;
  h.host.clientHeight = 844;
  h.windowEvents.get('resize')();
  h.frame();
  batches = h.renderer.scene.children.filter(
    (object) => object.isInstancedMesh,
  );
  assert.equal(batches[0].count, 12);
  h.dispose();
});
