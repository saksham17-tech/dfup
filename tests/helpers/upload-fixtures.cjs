const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

// Run the repository's actual TypeScript with isolated service mocks; no live data is touched.
function loadTs(relativePath, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../..', relativePath);
  const localRequire = createRequire(filename);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const requireMock = (name) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name);
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    requireMock, module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}

function fixture({ count = 3, size = 4, status = 'UPLOADING', legacy = false } = {}) {
  const file = { id: 'test-file', filename: 'résumé "final".bin', total_chunks: count,
    user_id: 'user-a', created_at: '2020-01-01T00:00:00.000Z',
    total_size: count * size, status, deleted_at: null, mime_type: 'application/octet-stream',
    storage_path: legacy ? 'merged/test-file/old.bin' : status === 'COMPLETED' ? 'chunks/test-file' : null };
  const rows = Array.from({ length: count }, (_, index) => ({ file_id: file.id, chunk_index: index,
    chunk_size: size, checksum: `checksum-${index}` }));
  const objects = new Map(rows.map((row) => [`chunks/${file.id}/${row.chunk_index}`, size]));
  const calls = { download: [], upload: [], remove: [], signed: [], updates: [], deleted: [], list: [], ranges: [] };
  const errors = {};
  const files = [file];
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select(columns, options) { this.columns = columns; this.options = options; return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    is(key, value) { return this.eq(key, value); }
    not(key, operator, value) { this.filters.push((row) => row[key] !== value); return this; }
    order(key, options = {}) { this.sort = [key, options.ascending !== false]; return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    lt(key, value) { this.filters.push(row => row[key] < value); return this; }
    limit(value) { this.bounds = [0, value - 1]; return this; }
    range(from, to) { this.bounds = [from, to]; calls.ranges.push([from, to]); return this; }
    update(value) { this.action = 'update'; this.value = value; return this; }
    delete() { this.action = 'delete'; return this; }
    upsert(value) { this.action = 'upsert'; this.value = value; return this; }
    insert(value) { this.action = 'upsert'; this.value = value; return this; }
    async single() {
      const result = await this.execute();
      return { ...result, data: result.data?.[0] ?? null };
    }
    async execute() {
      let data = this.table === 'files' ? files : rows;
      data = data.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.action === 'update') {
        if (errors.update) return { data: null, error: new Error('DB unavailable') };
        calls.updates.push(this.value);
        for (const row of data) Object.assign(row, this.value);
      } else if (this.action === 'delete') {
        calls.deleted.push(this.table);
        if (this.table === 'files') { for (let i = files.length - 1; i >= 0; i--) if (data.includes(files[i])) files.splice(i, 1); }
        else for (let i = rows.length - 1; i >= 0; i--) if (data.includes(rows[i])) rows.splice(i, 1);
      } else if (this.action === 'upsert') {
        if (this.table === 'files') {
          const added = { id: `new-${files.length}`, deleted_at: null, created_at: new Date().toISOString(), ...this.value };
          files.push(added); data = [added];
        } else {
          const existing = rows.find((row) => row.chunk_index === this.value.chunk_index);
          if (existing) Object.assign(existing, this.value); else rows.push(this.value);
        }
      }
      if (this.options?.head) return { count: data.length, data: null, error: null };
      if (this.sort) { const [key, ascending] = this.sort; data = [...data].sort((a,b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1)); }
      const [from, to] = this.bounds ?? [0, 999];
      return { data: data.slice(from, to + 1).map((row) => ({ ...row })), error: null };
    }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }
  const bucket = {
    async list(prefix, options) {
      calls.list.push(options);
      if (errors.list) return { data: null, error: new Error('Storage unavailable') };
      const names = [...objects.keys()].filter((key) => key.startsWith(`${prefix}/`)).sort();
      return { data: names.slice(options.offset, options.offset + options.limit).map((key) => ({
        name: key.slice(prefix.length + 1), metadata: { size: objects.get(key) },
      })), error: null };
    },
    async download(objectPath, options, parameters) {
      calls.download.push(objectPath);
      if (!objects.has(objectPath) || errors.download === objectPath) return { data: null, error: new Error('Missing object') };
      const index = Number(objectPath.split('/').at(-1));
      return { data: new Blob([Buffer.alloc(objects.get(objectPath), index % 251)]), error: null };
    },
    async upload(objectPath, buffer) {
      calls.upload.push(objectPath); objects.set(objectPath, buffer.length); return { error: null };
    },
    async remove(paths) {
      calls.remove.push(paths);
      if (errors.remove) return { error: new Error('Storage delete failed') };
      for (const key of paths) objects.delete(key);
      return { error: null };
    },
    async createSignedUrl(objectPath) {
      calls.signed.push(objectPath);
      return { data: { signedUrl: 'https://storage.example.test/signed-legacy' }, error: null };
    },
  };
  const client = { from: (table) => new Query(table), storage: { from: () => bucket } };
  const server = { getSupabaseServer: () => client, STORAGE_BUCKET: 'test-bucket' };
  const storage = loadTs('src/lib/chunkStorage.ts', { './supabaseServer': server });
  const cleanup = loadTs('src/lib/chunkCleanup.ts', { './supabaseServer': server, './chunkStorage': storage });
  const route = (relative, overrides = {}) => loadTs(relative, { '@/lib/supabaseServer': server, '@/lib/chunkStorage': storage,
    '@/lib/chunkCleanup': cleanup, '@/lib/uploadAuth': { uploadUserId: async () => 'user-a', isCleanupOperator: () => true }, ...overrides });
  return { file, files, rows, objects, calls, errors, client, storage, cleanup, route };
}

module.exports = { fixture, loadTs };
