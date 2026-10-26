const assert = require('node:assert/strict');
const { File } = require('node:buffer');
const { createHash } = require('node:crypto');
const axios = require('axios');
const { loadTs } = require('../tests/helpers/upload-fixtures.cjs');

// ── Explicit opt-in integration check; deletes only the record it creates ──
if (!process.argv.includes('--run-live'))
  throw new Error(
    'Use --run-live to create, verify and remove a synthetic 104 MB upload.',
  );
const origin = 'http://127.0.0.1:3001';
const accessToken = process.env.UPLOAD_TEST_ACCESS_TOKEN;
if (!accessToken) throw new Error('Set UPLOAD_TEST_ACCESS_TOKEN to a signed-in Supabase user access token before this live test. Apply supabase/upload-ownership.sql first.');
const { createUploadBridge } = loadTs('src/lib/court/uploadBridge.ts');
const { createShots } = loadTs('src/lib/court/shots.ts');
const bridge = createUploadBridge(),
  shots = createShots(bridge),
  events = [];
bridge.subscribe((event) => {
  shots.accept(event);
  if (event.type === 'saved') events.push(event.index);
});
const transport = axios.create({ baseURL: origin });
let injected = false,
  paused = false,
  fileId = null,
  controls,
  timer;
let resolveDone, rejectDone;
const done = new Promise((resolve, reject) => {
  resolveDone = resolve;
  rejectDone = reject;
});
let state = {
  status: 'idle',
  uploadedChunks: [],
  totalBytes: 0,
  uploadedBytes: 0,
  fileId: null,
};
const realFetch = fetch;
const moduleUnderTest = loadTs(
  'src/lib/upload.ts',
  {
    axios: {
      isCancel: axios.isCancel,
      isAxiosError: axios.isAxiosError,
      post(url, body, config) {
        if (!injected && url.includes('/chunk?chunkIndex=3&')) {
          injected = true;
          console.log(
            'Injected a transient transport failure for piece 3 before any server confirmation.',
          );
          return Promise.reject(
            new axios.AxiosError('Synthetic connection reset', 'ECONNRESET'),
          );
        }
        return transport.post(url, body, config);
      },
    },
  },
  {
    fetch: (url, init) => realFetch(new URL(url, origin), init),
    requestAnimationFrame: (callback) => setTimeout(callback, 16),
    cancelAnimationFrame: clearTimeout,
  },
);

// ── Feed the exact UI bridge mapping from real uploader callbacks ──
controls = moduleUnderTest.createUploader((update) => {
  state = { ...state, ...update };
  if (state.fileId) fileId = state.fileId;
  const finishing =
    state.totalBytes > 0 && state.uploadedBytes >= state.totalBytes;
  const phase =
    state.status === 'processing' || (state.status === 'uploading' && finishing)
      ? 'finishing'
      : state.status === 'init'
        ? 'uploading'
        : state.status;
  bridge.reconcile(
    state.uploadedChunks,
    phase,
    Math.max(1, Math.ceil(state.totalBytes / moduleUnderTest.CHUNK_SIZE)),
    state.fileId,
  );
  if (update.uploadedChunks)
    console.log(
      `Confirmed ${state.uploadedChunks.length}/26 pieces; ${state.status}`,
    );
  if (
    !paused &&
    state.status === 'uploading' &&
    state.uploadedChunks.length >= 5
  ) {
    paused = true;
    queueMicrotask(() => {
      controls.pause();
      console.log('Paused. Resuming after 1.2 seconds.');
      setTimeout(() => controls.resume(), 1200);
    });
  }
  if (state.status === 'error') rejectDone(new Error(state.error));
  if (state.status === 'completed') resolveDone();
}, async () => accessToken);

async function main() {
  const bytes = Buffer.alloc(104 * 1024 * 1024);
  for (let i = 0; i < 26; i++)
    bytes.fill(
      i,
      i * moduleUnderTest.CHUNK_SIZE,
      (i + 1) * moduleUnderTest.CHUNK_SIZE,
    );
  const expected = createHash('sha256').update(bytes).digest('hex');
  const file = new File([bytes], `court-v2-verification-${Date.now()}.bin`, {
    type: 'application/octet-stream',
  });
  timer = setInterval(() => shots.update(1 / 60), 1000 / 60);
  const timeout = setTimeout(
    () => rejectDone(new Error('Live upload verification timed out')),
    240000,
  );
  try {
    void controls.start(file);
    await done;
    clearInterval(timer);
    for (let i = 0; i < 600; i++) shots.update(1 / 120);
    assert.equal(events.length, 26);
    assert.equal(new Set(events).size, 26);
    assert.equal(shots.state.settled, 26);
    assert.ok(injected && paused);
    const response = await realFetch(
      `${origin}/api/upload/files/${fileId}/download`,
    );
    assert.ok(response.ok);
    const hash = createHash('sha256');
    let length = 0;
    for await (const part of response.body) {
      hash.update(part);
      length += part.length;
    }
    assert.equal(length, file.size);
    assert.equal(hash.digest('hex'), expected);
    console.log(
      'PASS: real 104 MB upload, transport retry, pause/resume, 26 unique confirmed shots, 26 settled pieces, and byte-exact streamed download.',
    );
  } finally {
    clearTimeout(timeout);
    clearInterval(timer);
    controls.abort(false);
    assert.equal(shots.state.settled, 0);
    assert.equal(shots.state.queued, 0);
    if (fileId) {
      const response = await realFetch(
        `${origin}/api/upload/files/${fileId}?permanent=true`,
        { method: 'DELETE' },
      );
      if (!response.ok)
        throw new Error(
          `Could not clean up synthetic test upload ${fileId}: ${await response.text()}`,
        );
      console.log('Removed the synthetic test upload and its chunks.');
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
