const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { NextRequest } = require('next/server');
const { fixture, loadTs } = require('./helpers/upload-fixtures.cjs');
const context = () => ({ params: Promise.resolve({ fileId: 'test-file' }) });
const request = (url = 'http://localhost/api/upload/test-file/complete') => new NextRequest(url);

test('a 208 MB upload completes without downloading, merging, or re-uploading any objects', async () => {
  const f = fixture({ count: 52, size: 4 * 1024 * 1024 });
  const route = f.route('src/app/api/upload/[fileId]/complete/route.ts');
  const response = await route.POST(request(), context());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, true);
  assert.equal(f.file.storage_path, 'chunks/test-file');
  assert.equal(f.file.status, 'COMPLETED');
  assert.equal(f.calls.download.length + f.calls.upload.length + f.calls.remove.length, 0);
  assert.equal(f.objects.size, 52);
});

test('completion is idempotent and rescues FAILED records with intact pieces', async () => {
  const f = fixture({ status: 'FAILED' });
  await f.storage.completeChunkUpload(f.client, f.file.id);
  const listCalls = f.calls.list.length;
  await f.storage.completeChunkUpload(f.client, f.file.id);
  assert.equal(f.calls.updates.length, 1);
  assert.equal(f.calls.list.length, listCalls);
  assert.equal(f.file.status, 'COMPLETED');
});

test('metadata count cannot hide a missing index or a missing stored object', async () => {
  const f = fixture({ status: 'FAILED' });
  f.rows[2] = { ...f.rows[0] };
  await assert.rejects(f.storage.completeChunkUpload(f.client, f.file.id), /pieces are missing/);
  assert.equal(f.file.status, 'FAILED');
  const g = fixture({ status: 'FAILED' });
  g.objects.delete('chunks/test-file/1');
  await assert.rejects(g.storage.completeChunkUpload(g.client, g.file.id), /missing or damaged/);
  assert.equal(g.calls.updates.length, 0);
});

test('size mismatch, storage outages and DB outages never produce false completion', async () => {
  for (const failure of ['size', 'list', 'update']) {
    const f = fixture();
    if (failure === 'size') f.objects.set('chunks/test-file/1', 1);
    else f.errors[failure] = true;
    await assert.rejects(f.storage.completeChunkUpload(f.client, f.file.id));
    assert.equal(f.file.status, 'UPLOADING');
  }
});

test('completion and storage lookup paginate beyond 1,000 chunks', async () => {
  const f = fixture({ count: 1002 });
  await f.storage.completeChunkUpload(f.client, f.file.id);
  assert.equal(f.file.status, 'COMPLETED');
  assert.deepEqual(f.calls.ranges, [[0, 999], [1000, 1999]]);
  assert.equal(f.calls.list.length, 2);
});

test('resume status includes every saved piece beyond the default database page limit', async () => {
  const f = fixture({ count: 1002 });
  const response = await f.route('src/app/api/upload/[fileId]/status/route.ts').GET(request(), context());
  const result = await response.json();
  assert.equal(result.uploadedChunks.length, 1002);
  assert.equal(result.uploadedChunks[1001], 1001);
  assert.equal(result.checksums['1001'], 'checksum-1001');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('downloads read one piece per pull, preserve numeric order and original bytes', async () => {
  const f = fixture({ count: 12, status: 'COMPLETED' });
  const route = f.route('src/app/api/upload/files/[fileId]/download/route.ts');
  const response = await route.GET(request(), context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '48');
  assert.match(response.headers.get('Content-Disposition'), /filename\*=UTF-8''r%C3%A9sum%C3%A9/);
  assert.equal(f.calls.download.length, 1);
  const reader = response.body.getReader();
  const output = [];
  for (let i = 0; i < 12; i++) {
    const result = await reader.read();
    assert.equal(f.calls.download.length, i + 1);
    assert.equal(f.calls.download[i], `chunks/test-file/${i}`);
    output.push(Buffer.from(result.value));
  }
  assert.equal((await reader.read()).done, true);
  assert.deepEqual(Buffer.concat(output), Buffer.concat(Array.from({ length: 12 }, (_, i) => Buffer.alloc(4, i))));
});

test('cancelling a download stops further piece requests', async () => {
  const f = fixture({ status: 'COMPLETED' });
  const response = await f.route('src/app/api/upload/files/[fileId]/download/route.ts').GET(request(), context());
  const reader = response.body.getReader();
  await reader.read(); await reader.cancel();
  assert.equal(f.calls.download.length, 1);
});

test('missing download objects fail rather than silently returning a truncated file', async () => {
  const f = fixture({ status: 'COMPLETED' });
  f.objects.delete('chunks/test-file/0');
  assert.equal((await f.route('src/app/api/upload/files/[fileId]/download/route.ts').GET(request(), context())).status, 500);
  const g = fixture({ status: 'COMPLETED' });
  g.objects.delete('chunks/test-file/1');
  const response = await g.route('src/app/api/upload/files/[fileId]/download/route.ts').GET(request(), context());
  await assert.rejects(response.arrayBuffer(), /Could not read piece 2/);
});

test('legacy merged downloads retain signed URL redirects', async () => {
  const f = fixture({ status: 'COMPLETED', legacy: true });
  const response = await f.route('src/app/api/upload/files/[fileId]/download/route.ts').GET(request(), context());
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://storage.example.test/signed-legacy');
  assert.equal(f.calls.download.length, 0);
});

test('late parallel chunk requests are successful and cannot rewrite a completed file', async () => {
  const f = fixture({ status: 'COMPLETED' });
  const blob = new Blob(['same piece']);
  const checksum = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
  const form = new FormData(); form.set('chunk', blob);
  const req = new NextRequest(`http://localhost/api/upload/test-file/chunk?chunkIndex=2&checksum=${checksum}`, { method: 'POST', body: form });
  const response = await f.route('src/app/api/upload/[fileId]/chunk/route.ts').POST(req, context());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, true);
  assert.equal(f.calls.upload.length, 0);
});

test('the final piece completes a FAILED upload without creating a merged object', async () => {
  const f = fixture({ status: 'FAILED' });
  f.rows.pop(); f.objects.delete('chunks/test-file/2');
  const buffer = Buffer.from('last');
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const form = new FormData(); form.set('chunk', new Blob([buffer]));
  const req = new NextRequest(`http://localhost/api/upload/test-file/chunk?chunkIndex=2&checksum=${checksum}`, { method: 'POST', body: form });
  const response = await f.route('src/app/api/upload/[fileId]/chunk/route.ts').POST(req, context());
  assert.equal(response.status, 201);
  assert.equal((await response.json()).completed, true);
  assert.equal(f.file.status, 'COMPLETED');
  assert.deepEqual(f.calls.upload, ['chunks/test-file/2']);
  assert.equal(f.calls.download.length + f.calls.remove.length, 0);
});

test('permanent deletion removes all paginated pieces and both metadata tables', async () => {
  const f = fixture({ count: 1002, status: 'COMPLETED' });
  const response = await f.route('src/app/api/upload/files/[fileId]/route.ts')
    .DELETE(request('http://localhost/api/upload/files/test-file?permanent=true'), context());
  assert.equal(response.status, 200);
  assert.equal(f.objects.size, 0);
  assert.deepEqual(f.calls.deleted, ['file_chunks', 'files']);
  assert.ok(f.calls.remove.every((paths) => paths.length <= 100));
});

test('storage deletion failures retain database records for retry; soft delete retains objects', async () => {
  const f = fixture({ status: 'COMPLETED' }); f.errors.remove = true;
  const route = f.route('src/app/api/upload/files/[fileId]/route.ts');
  assert.equal((await route.DELETE(request('http://localhost/api/upload/files/test-file?permanent=true'), context())).status, 500);
  assert.equal(f.calls.deleted.length, 0);
  f.errors.remove = false;
  assert.equal((await route.DELETE(request('http://localhost/api/upload/files/test-file'), context())).status, 200);
  assert.ok(f.file.deleted_at);
  assert.equal(f.objects.size, 3);
});

test('legacy permanent deletion removes the merged object and leftover pieces', async () => {
  const f = fixture({ status: 'COMPLETED', legacy: true });
  f.objects.set(f.file.storage_path, f.file.total_size);
  const response = await f.route('src/app/api/upload/files/[fileId]/route.ts')
    .DELETE(request('http://localhost/api/upload/files/test-file?permanent=true'), context());
  assert.equal(response.status, 200);
  assert.equal(f.objects.size, 0);
});

test('file list links chunk-backed files through the streaming route', async () => {
  const f = fixture({ status: 'COMPLETED' });
  const response = await f.route('src/app/api/upload/files/list/route.ts').GET(request('http://localhost/api/upload/files/list'));
  assert.equal((await response.json())[0].downloadUrl, '/api/upload/files/test-file/download');
  assert.equal(f.calls.signed.length, 0);
});

const initRequest = (f, changes = {}) => new NextRequest('http://localhost/api/upload/init', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filename: f.file.filename, totalSize: f.file.total_size,
    totalChunks: f.file.total_chunks, mimeType: f.file.mime_type, ...changes }),
});

test('init reuses the newest unfinished fingerprint only for the same owner', async () => {
  const f = fixture({ count: 2, size: 4 * 1024 * 1024 });
  f.files.push({ ...f.file, id: 'newer', status: 'FAILED', created_at: '2025-01-01T00:00:00Z' });
  f.files.push({ ...f.file, id: 'someone-else', user_id: 'user-b', created_at: '2026-01-01T00:00:00Z' });
  const response = await f.route('src/app/api/upload/init/route.ts').POST(initRequest(f));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { fileId: 'newer', resumed: true });
  assert.equal(f.files.length, 3);
});

test('init creates a new upload for changed fingerprints, completed files and bin entries', async () => {
  for (const change of ['filename','totalSize','totalChunks','mimeType','completed','bin','owner']) {
    const f = fixture({ count: 2, size: 4 * 1024 * 1024 });
    const input = {};
    if (change === 'completed') f.file.status = 'COMPLETED';
    else if (change === 'bin') f.file.deleted_at = '2025-01-01';
    else if (change === 'owner') f.file.user_id = 'user-b';
    else if (change === 'filename') input.filename = 'different.bin';
    else if (change === 'mimeType') input.mimeType = 'video/mp4';
    else if (change === 'totalSize') input.totalSize = f.file.total_size - 1;
    else { input.totalChunks = 3; input.totalSize = 3 * 4 * 1024 * 1024; }
    const response = await f.route('src/app/api/upload/init/route.ts').POST(initRequest(f, input));
    assert.equal(response.status, 201, change);
    const added = f.files.at(-1);
    assert.equal(added.user_id, 'user-a');
    assert.notEqual((await response.json()).fileId, f.file.id);
  }
});

test('quota and list agree when abandoned and deleted uploads exist', async () => {
  const f = fixture({ status: 'UPLOADING' });
  f.files.push({ ...f.file, id: 'failed', status: 'FAILED' });
  f.files.push({ ...f.file, id: 'bin', status: 'COMPLETED', deleted_at: '2025-01-01' });
  const quota = f.route('src/app/api/upload/usage/quota/route.ts');
  assert.deepEqual(await (await quota.GET()).json(), { usedBytes: 0, fileCount: 0 });
  assert.deepEqual(await (await f.route('src/app/api/upload/files/list/route.ts').GET(request())).json(), []);
  f.files.push({ ...f.file, id: 'complete', status: 'COMPLETED' });
  assert.deepEqual(await (await quota.GET()).json(), { usedBytes: 12, fileCount: 1 });
});

test('cancel removes every stored object and row, refuses completed and other-owner files', async () => {
  const f = fixture({ count: 1002 });
  f.objects.set('chunks/test-file/leftover.tmp', 4);
  const response = await f.route('src/app/api/upload/[fileId]/route.ts').DELETE(request(), context());
  assert.equal(response.status, 200);
  assert.equal(f.objects.size, 0); assert.equal(f.rows.length, 0); assert.equal(f.files.length, 0);
  assert.ok(f.calls.remove.every(paths => paths.length <= 100));
  for (const kind of ['completed', 'other-owner']) {
    const g = fixture();
    if (kind === 'completed') g.file.status = 'COMPLETED'; else g.file.user_id = 'user-b';
    const denied = await g.route('src/app/api/upload/[fileId]/route.ts').DELETE(request(), context());
    assert.equal(denied.status, kind === 'completed' ? 409 : 404);
    assert.equal(g.objects.size, 3); assert.equal(g.calls.updates.length, 1); // conditional UPDATE matches no row
    assert.equal(g.file.deleted_at, null); assert.equal(g.calls.remove.length, 0);
  }
});

test('new destructive routes and init reject missing credentials before database changes', async () => {
  const f = fixture();
  const denied = { '@/lib/uploadAuth': { uploadUserId: async () => null, isCleanupOperator: () => false } };
  assert.equal((await f.route('src/app/api/upload/[fileId]/route.ts', denied).DELETE(request(), context())).status, 401);
  assert.equal((await f.route('src/app/api/upload/cleanup/route.ts', denied).POST(request())).status, 401);
  assert.equal((await f.route('src/app/api/upload/init/route.ts', denied).POST(initRequest(f))).status, 401);
  assert.equal(f.calls.remove.length + f.calls.deleted.length + f.calls.updates.length, 0);
});

test('operator cleanup removes only old unfinished uploads; hours=0 includes recent ones', async () => {
  const f = fixture();
  f.files.push({ ...f.file, id: 'recent', created_at: new Date().toISOString() });
  f.files.push({ ...f.file, id: 'complete', status: 'COMPLETED' });
  const route = f.route('src/app/api/upload/cleanup/route.ts');
  const first = await route.POST(request('http://localhost/api/upload/cleanup'));
  assert.deepEqual(await first.json(), { ok: true, removed: 1 });
  assert.deepEqual(f.files.map(file => file.id), ['recent', 'complete']);
  assert.deepEqual(await (await route.POST(request('http://localhost/api/upload/cleanup?hours=0'))).json(), { ok: true, removed: 1 });
  assert.deepEqual(f.files.map(file => file.id), ['complete']);
  assert.equal((await route.POST(request('http://localhost/api/upload/cleanup?hours=-1'))).status, 400);
});

test('deferred replacement chunks cannot auto-complete a reused fingerprint prematurely', async () => {
  const f = fixture({ status: 'FAILED' });
  const body = Buffer.from('new!'), checksum = createHash('sha256').update(body).digest('hex');
  const form = new FormData(); form.set('chunk', new Blob([body]));
  const req = new NextRequest(`http://localhost/api/upload/test-file/chunk?chunkIndex=0&checksum=${checksum}&deferCompletion=1`, {method:'POST',body:form});
  const response = await f.route('src/app/api/upload/[fileId]/chunk/route.ts').POST(req, context());
  assert.equal(response.status, 201); assert.equal((await response.json()).completed, false);
  assert.equal(f.file.status, 'FAILED'); assert.equal(f.rows[0].checksum, checksum);
});

test('upload auth validates Supabase identity; cleanup requires the server operator secret', async () => {
  const secret = 'a'.repeat(32), tokens = [];
  const auth = loadTs('src/lib/uploadAuth.ts', { './supabaseServer': { getSupabaseServer: () => ({auth:{async getUser(token) {
    tokens.push(token); return {data:{user:token === 'session' ? {id:'owner'} : null},error:null};
  }}})} }, {process:{env:{UPLOAD_CLEANUP_TOKEN:secret}}});
  assert.equal(await auth.uploadUserId(request()), null);
  assert.equal(tokens.length, 0);
  assert.equal(await auth.uploadUserId(new Request('http://localhost',{headers:{Authorization:'Bearer session'}})), 'owner');
  assert.equal(await auth.uploadUserId(new Request('http://localhost',{headers:{Authorization:'Bearer invalid'}})), null);
  assert.equal(auth.isCleanupOperator(new Request('http://localhost',{headers:{Authorization:'Bearer '+secret}})), true);
  assert.equal(auth.isCleanupOperator(new Request('http://localhost',{headers:{Authorization:'Bearer session'}})), false);
});
