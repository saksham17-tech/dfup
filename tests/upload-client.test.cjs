const { test } = require('node:test');
const assert = require('node:assert/strict');
const { File } = require('node:buffer');
const { loadTs } = require('./helpers/upload-fixtures.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function clientFixture({ saved = [0], chunks = 1, complete } = {}) {
  const updates = [], calls = [], stored = new Set(saved);
  const file = new File([Buffer.alloc(chunks === 1 ? 12 : 4 * 1024 * 1024 + 12)], 'sample.bin');
  const axios = {
    isCancel: (error) => error?.code === 'ERR_CANCELED',
    isAxiosError: (error) => Boolean(error?.isAxiosError),
    async post(url, body, options) {
      calls.push(url);
      if (url.endsWith('/complete')) return { data: await (complete?.() ?? { completed: true }) };
      const index = Number(new URL(url, 'http://localhost').searchParams.get('chunkIndex'));
      assert.ok(body.get('chunk') instanceof Blob);
      assert.ok(options.signal instanceof AbortSignal);
      options.onUploadProgress({ loaded: body.get('chunk').size, total: body.get('chunk').size });
      stored.add(index);
      return { data: { ok: true } };
    },
  };
  const uploader = loadTs('src/lib/upload.ts', { axios }, {
    fetch: async (url) => new Response(JSON.stringify(url.endsWith('/init') ? { fileId: 'test-file' }
      : { status: 'FAILED', totalChunks: chunks, uploadedChunks: [...stored] })),
    requestAnimationFrame: (callback) => setImmediate(callback),
    cancelAnimationFrame: clearImmediate,
  }).createUploader((update) => updates.push(update));
  return { uploader, updates, calls, file };
}

test('an upload with all saved pieces waits for explicit server confirmation, even after FAILED', async () => {
  const entered = deferred(), gate = deferred();
  const f = clientFixture({ complete: async () => { entered.resolve(); await gate.promise; return { completed: true }; } });
  const upload = f.uploader.start(f.file);
  await entered.promise;
  assert.equal(f.updates.at(-1).status, 'processing');
  assert.ok(!f.updates.some((update) => update.status === 'completed'));
  gate.resolve(); await upload;
  assert.equal(f.updates.at(-1).status, 'completed');
  assert.deepEqual(f.updates.at(-1).uploadedChunks, [0]);
  assert.deepEqual(f.calls, ['/api/upload/test-file/complete']);
});

test('missing-piece completion errors show Retry and a retry can finish without re-sending saved chunks', async () => {
  let attempts = 0;
  const f = clientFixture({ complete() {
    if (++attempts === 1) {
      const error = new Error('Conflict'); error.isAxiosError = true;
      error.response = { data: { error: 'Upload is incomplete: 1 piece is missing. Retry.' } };
      throw error;
    }
    return { completed: true };
  } });
  await f.uploader.start(f.file);
  assert.equal(f.updates.at(-1).status, 'error');
  assert.match(f.updates.at(-1).error, /1 piece is missing/);
  assert.ok(!f.updates.some((update) => update.status === 'completed'));
  await f.uploader.resume();
  assert.equal(f.updates.at(-1).status, 'completed');
  assert.deepEqual(f.calls, ['/api/upload/test-file/complete', '/api/upload/test-file/complete']);
});

test('pending pieces upload before completion and the final saved-piece readout is flushed', async () => {
  const f = clientFixture({ chunks: 2, saved: [0] });
  await f.uploader.start(f.file);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0], /chunk\?chunkIndex=1&checksum=[a-f0-9]{64}$/);
  assert.equal(f.calls[1], '/api/upload/test-file/complete');
  const processing = f.updates.find((update) => update.status === 'processing');
  assert.deepEqual(processing.uploadedChunks, [0, 1]);
  assert.equal(f.updates.at(-1).status, 'completed');
});

test('a successful HTTP response without completed:true cannot announce success', async () => {
  const f = clientFixture({ complete: () => ({ completed: false }) });
  await f.uploader.start(f.file);
  assert.equal(f.updates.at(-1).status, 'error');
  assert.match(f.updates.at(-1).error, /did not confirm/);
});

test('cancelling while confirmation is pending prevents late success from replacing idle', async () => {
  const entered = deferred(), gate = deferred();
  const f = clientFixture({ complete: async () => { entered.resolve(); await gate.promise; return { completed: true }; } });
  const upload = f.uploader.start(f.file);
  await entered.promise;
  f.uploader.abort(); gate.resolve(); await upload;
  assert.equal(f.updates.at(-1).status, 'idle');
  assert.ok(!f.updates.some((update) => update.status === 'completed'));
});

test('resuming cannot let a previous paused confirmation overwrite the new run', async () => {
  const entered = deferred(), gate = deferred();
  let attempts = 0;
  const f = clientFixture({ complete: async () => {
    if (++attempts === 1) { entered.resolve(); await gate.promise; }
    return { completed: true };
  } });
  const firstRun = f.uploader.start(f.file);
  await entered.promise;
  f.uploader.pause();
  assert.equal(f.updates.at(-1).status, 'paused');
  await f.uploader.resume();
  assert.equal(f.updates.at(-1).status, 'completed');
  const updateCount = f.updates.length;
  gate.resolve(); await firstRun;
  assert.equal(f.updates.length, updateCount);
});
