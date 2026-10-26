const { test } = require('node:test');
const assert = require('node:assert/strict');
const { File } = require('node:buffer');
const { loadTs } = require('./helpers/upload-fixtures.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function clientFixture({ saved = [0], chunks = 1, complete, resumed = false, checksums = {}, forget = false } = {}) {
  const updates = [], calls = [], fetchCalls = [], stored = new Set(saved);
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
      if (!forget) stored.add(index);
      checksums[String(index)] = new URL(url, 'http://localhost').searchParams.get('checksum');
      return { data: { ok: true } };
    },
  };
  const uploader = loadTs('src/lib/upload.ts', { axios }, {
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith('/init') ? { fileId: 'test-file', resumed }
        : { status: 'FAILED', totalChunks: chunks, uploadedChunks: [...stored], checksums }));
    },
    requestAnimationFrame: (callback) => setImmediate(callback),
    cancelAnimationFrame: clearImmediate,
  }).createUploader((update) => updates.push(update));
  return { uploader, updates, calls, fetchCalls, file };
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
  assert.match(f.calls[0], /chunk\?chunkIndex=1&checksum=[a-f0-9]{64}&deferCompletion=1$/);
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
  const resumed = f.uploader.resume();
  gate.resolve();
  await resumed;
  assert.equal(f.updates.at(-1).status, 'completed');
  const updateCount = f.updates.length;
  gate.resolve(); await firstRun;
  assert.equal(f.updates.length, updateCount);
});

test('reselected uploads verify saved checksums before skipping pieces', async () => {
  const { createHash } = require('node:crypto');
  const checksum = createHash('sha256').update(Buffer.alloc(4 * 1024 * 1024)).digest('hex');
  for (const matched of [true, false]) {
    const f = clientFixture({ chunks: 2, resumed: true, checksums: { '0': matched ? checksum : 'different-content' } });
    await f.uploader.start(f.file);
    const sent = f.calls.filter(url => url.includes('/chunk?')).map(url => Number(new URL(url, 'http://local').searchParams.get('chunkIndex'))).sort();
    assert.deepEqual(sent, matched ? [1] : [0, 1]);
    assert.equal(f.updates.at(-1).status, 'completed');
    assert.ok(f.updates.some(update => update.fileId === 'test-file' && update.status === 'init'));
  }
});

test('missing server pieces after the pool produce a Retry error instead of completing', async () => {
  const f = clientFixture({ saved: [], forget: true });
  await f.uploader.start(f.file);
  assert.equal(f.updates.at(-1).status, 'error');
  assert.match(f.updates.at(-1).error, /missing pieces.*Retry/);
  assert.ok(!f.calls.some(url => url.endsWith('/complete')));
});

test('abort(false) preserves saved pieces; Cancel uses keepalive DELETE', async () => {
  for (const discard of [true, false]) {
    const f = clientFixture(); await f.uploader.start(f.file);
    f.uploader.abort(discard);
    await new Promise(resolve => setImmediate(resolve));
    const deletes = f.fetchCalls.filter(call => call.init?.method === 'DELETE');
    assert.equal(deletes.length, discard ? 1 : 0);
    if (discard) { assert.equal(deletes[0].url, '/api/upload/test-file'); assert.equal(deletes[0].init.keepalive, true); }
  }
});

test('104 MB pause at 40% then immediate Resume waits for the old pool and sends only missing indices', async () => {
  const stored = new Set(), calls = [], statuses = [], updates = [];
  const paused = deferred(), unwind = deferred();
  let controls, resumeTask, didPause = false, firstPool = true, active = 0, maxActive = 0;
  const file = new File([Buffer.alloc(104 * 1024 * 1024)], 'throttled-104MB.bin');
  const axios = {
    isCancel: error => error?.code === 'ERR_CANCELED', isAxiosError: () => false,
    async post(url, body, options) {
      if (url.endsWith('/complete')) return { data: { completed: true } };
      const index = Number(new URL(url, 'http://localhost').searchParams.get('chunkIndex'));
      calls.push({ index, pool: firstPool ? 'first' : 'resumed' });
      active++; maxActive = Math.max(maxActive, active);
      try {
        if (firstPool && index >= 10) await new Promise((resolve, reject) => {
          const abort = () => unwind.promise.then(() => {
            // One request reached Storage even though its response was cancelled.
            if (index === 10) stored.add(index);
            reject(Object.assign(new Error('Upload paused or cancelled'), { code: 'ERR_CANCELED' }));
          });
          if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
        });
        await new Promise(resolve => setImmediate(resolve));
        stored.add(index);
        options.onUploadProgress({ loaded: body.get('chunk').size, total: body.get('chunk').size });
        return { data: { ok: true } };
      } finally { active--; }
    },
  };
  const module = loadTs('src/lib/upload.ts', { axios }, {
    fetch: async (url, options) => {
      if (url.endsWith('/init')) {
        assert.equal(options.headers.Authorization, 'Bearer test-session');
        return Response.json({ fileId: 'large-test' });
      }
      assert.equal(options.cache, 'no-store');
      const indices = [...stored].sort((a,b) => a-b); statuses.push(indices);
      return Response.json({ status: 'UPLOADING', totalChunks: 26, uploadedChunks: indices });
    },
    requestAnimationFrame: callback => setImmediate(callback), cancelAnimationFrame: clearImmediate,
  });
  controls = module.createUploader(update => {
    updates.push(update);
    if (!didPause && update.uploadedChunks?.length >= 10) {
      didPause = true; controls.pause(); resumeTask = controls.resume(); paused.resolve();
    }
  }, async () => 'test-session');
  const initial = controls.start(file);
  await paused.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(statuses.length, 1, 'Resume must not query status before the previous pool drains');
  assert.equal(calls.filter(call => call.pool === 'resumed').length, 0);
  firstPool = false; unwind.resolve();
  await initial; await resumeTask;
  assert.deepEqual(statuses[1], Array.from({ length: 11 }, (_, i) => i));
  assert.deepEqual(calls.filter(call => call.pool === 'resumed').map(call => call.index).sort((a,b)=>a-b), Array.from({length:15},(_,i)=>i+11));
  assert.ok(maxActive <= 5); assert.equal(updates.at(-1).status, 'completed');
  assert.ok(!updates.some(update => update.status === 'error'));
});

test('Cancel during init discards the late-created ID; navigation preserves it', async () => {
  for (const discard of [true, false]) {
    const entered = deferred(), gate = deferred(), calls = [];
    const module = loadTs('src/lib/upload.ts', {axios:{}}, {
      fetch: async (url, options) => {
        calls.push({url,options});
        if (url.endsWith('/init')) { entered.resolve(); await gate.promise; return Response.json({fileId:'late-init'}); }
        assert.equal(options.method, 'DELETE'); return Response.json({ok:true});
      },
    });
    const controls = module.createUploader(()=>{}, async ()=>'signed-in');
    const run = controls.start(new File(['content'],'late.bin'));
    await entered.promise; controls.abort(discard); gate.resolve(); await run;
    await new Promise(resolve=>setImmediate(resolve));
    const deletion = calls.find(call=>call.options.method === 'DELETE');
    assert.equal(Boolean(deletion), discard);
    if (discard) { assert.equal(deletion.url,'/api/upload/late-init'); assert.equal(deletion.options.headers.Authorization,'Bearer signed-in'); }
  }
});

function activityHarness() {
  let now = 0, tick, request, success, failure;
  const events = [], timings = [], ejected = [];
  const client = { interceptors: {
    request: {use(fn) {request = fn; return 7;}, eject(id) {ejected.push(id);}},
    response: {use(ok, bad) {success = ok; failure = bad; return 8;}, eject(id) {ejected.push(id);}},
  }};
  const { observeUploadActivity } = loadTs('src/lib/uploadActivity.ts', {axios:{isAxiosError:error=>Boolean(error?.isAxiosError),isCancel:error=>error?.code === 'ERR_CANCELED'}}, {
    setInterval(fn) {tick=fn;return 1;},clearInterval() {tick=null;},
  });
  const activity = observeUploadActivity(value=>events.push(value), {client,limit:5,now:()=>now,onTiming:value=>timings.push(value)});
  activity.update({fileId:'activity-file',status:'uploading',uploadedChunks:[]});
  return {activity,events,timings,ejected,
    request(index, id='activity-file') {const config={url:`/api/upload/${id}/chunk?chunkIndex=${index}&checksum=abc`};request(config);return config;},
    success(config) {return success({config,data:{ok:true}});},
    failure(config) {return failure(Object.assign(new Error('retry'),{config,isAxiosError:true}));},
    advance(ms) {now+=ms;tick?.();},
  };
}

test('transport observer tracks actual indices, retains retries and records per-attempt confirmation times', async () => {
  const h = activityHarness();
  const first=h.request(0), second=h.request(1); h.request(2,'another-file');
  assert.deepEqual(h.events.at(-1).indices,[0,1]); assert.equal(h.events.at(-1).uploading,2);
  h.advance(10001); assert.equal(h.events.at(-1).waiting,true);
  await assert.rejects(h.failure(first), /retry/);
  assert.deepEqual(h.events.at(-1).indices,[0,1]);
  const retry=h.request(0); h.advance(250); h.success(retry);
  assert.equal(h.timings.at(-1).elapsedMs,250); assert.equal(h.timings.at(-1).confirmed,true);
  h.activity.update({uploadedChunks:[0]}); assert.deepEqual(h.events.at(-1).indices,[1]);
  h.activity.update({status:'paused'}); assert.deepEqual(h.events.at(-1).indices,[]);
  h.activity.update({status:'uploading'}); h.success(second);
  assert.deepEqual(h.events.at(-1).indices,[],'old responses cannot revive paused activity');
  h.activity.dispose(); assert.deepEqual(h.ejected,[7,8]);
});

test('transport activity stays bounded while an acknowledged ball waits for the real saved diff', () => {
  const h=activityHarness(), configs=[];
  for(let i=0;i<5;i++) configs.push(h.request(i));
  h.success(configs[2]); h.request(5);
  assert.equal(h.events.at(-1).indices.length,5);
  assert.equal(h.events.at(-1).uploading,5);
  h.activity.update({uploadedChunks:[2]});
  assert.deepEqual(h.events.at(-1).indices,[0,1,3,4,5]);
  h.activity.update({status:'error'}); assert.equal(h.events.at(-1).indices.length,0);
  h.activity.dispose();
});

test('the last retry failure returns its ball even while other pool requests are still winding down', async () => {
  const h=activityHarness();
  for(let attempt=0;attempt<3;attempt++) {
    const request=h.request(2); await assert.rejects(h.failure(request),/retry/);
    assert.equal(h.events.at(-1).indices.includes(2), attempt < 2);
  }
  h.activity.dispose();
});

test('a real Axios adapter retains request identity through instrumentation and cleanup', async () => {
  const axios=require('axios'), events=[];
  const client=axios.create({adapter:async config=>({config,data:{ok:true},status:201,statusText:'Created',headers:{}})});
  const {observeUploadActivity}=loadTs('src/lib/uploadActivity.ts');
  const activity=observeUploadActivity(value=>events.push(value),{client,limit:5});
  activity.update({fileId:'adapter',status:'uploading'});
  const result=await client.post('/api/upload/adapter/chunk?chunkIndex=2&checksum=abc',new FormData());
  assert.equal(result.status,201); assert.deepEqual(events.at(-1).indices,[2]);
  assert.equal(events.at(-1).uploading,0);
  activity.update({uploadedChunks:[2]}); assert.deepEqual(events.at(-1).indices,[]);
  activity.dispose();
});
