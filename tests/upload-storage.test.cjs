const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/upload-fixtures.cjs');
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
