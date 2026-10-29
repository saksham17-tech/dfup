# Database contract and setup gap

[Back to README](../README.md) · [ER diagram](architecture.md#database-er-diagram)

## What the checked-in SQL actually defines

| File | Definition |
| --- | --- |
| [bin-soft-delete.sql](../supabase/bin-soft-delete.sql) | Adds files.deleted_at TIMESTAMPTZ DEFAULT NULL; creates files_deleted_at_idx on deleted_at. The comment mentions an optional five-day purge; no purge job/function is installed. |
| [upload-ownership.sql](../supabase/upload-ownership.sql) | Adds public.files.user_id UUID referencing auth.users(id); creates files_unfinished_owner_idx on (user_id, created_at DESC), filtered to UPLOADING/FAILED with deleted_at IS NULL. |

Neither file creates the base `files` or `file_chunks` table. There is no checked-in
base schema, enum definition, ID default, RLS policy or Storage bucket/policy
migration. The extension statements are idempotent additions to an **existing**
schema, not a complete fresh-project bootstrap.

A fresh Supabase project needs a verified base schema before these extensions
can be applied. Obtain the original DDL or review the inferred reference below;
it does not establish what exists in any deployed project. Local frontend/demo
checks and mocked tests do not require live tables.

## Reference SQL — verify against your own Supabase project

**Reference, verify against your own Supabase project.** This is a proposed base
schema derived from the columns read/written by the route handlers and
`src/lib/chunkStorage.ts`, not a recovered migration or verified live schema.
It has not been executed against Supabase. Review it before running any SQL;
do not use it to replace or alter existing tables without inspecting their DDL.

UUID IDs with generated defaults, text status plus a check, bigint byte counts,
timestamp defaults, NOT NULL constraints and cascading deletion are proposed
choices, not facts established by the checked-in extensions. Init omits `id` and
`created_at`, so a usable schema must supply those values. Chunk upsert requires
uniqueness on `(file_id, chunk_index)`; that pair is the proposed primary key.

```sql
-- REFERENCE ONLY: verify against your own Supabase project.
-- For reviewed fresh-project setup, before the two existing extensions.
-- Verify gen_random_uuid() availability and your project's intended ID type.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  total_size bigint not null check (total_size > 0),
  total_chunks integer not null check (total_chunks > 0),
  mime_type text not null default 'application/octet-stream',
  status text not null default 'UPLOADING'
    check (status in ('UPLOADING', 'COMPLETED', 'FAILED')),
  storage_path text,
  created_at timestamptz not null default now()
);

create table public.file_chunks (
  file_id uuid not null references public.files(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_size bigint not null check (chunk_size > 0),
  checksum text not null,
  primary key (file_id, chunk_index)
);
```

After review, apply [bin-soft-delete.sql](../supabase/bin-soft-delete.sql) and then
[upload-ownership.sql](../supabase/upload-ownership.sql) to add `deleted_at`,
`user_id` and their indexes. The ownership index depends on `deleted_at` already
existing. Reference byte counts must stay within JavaScript's safe-integer range
for this app even though Postgres bigint can hold larger values.

This example installs **no RLS policies, grants, Storage bucket or auth settings**.
Decide and verify those separately. RLS alone cannot fix the current unauthenticated
route handlers because they use a privileged service-role client; the
[API auth boundary](api.md#authentication) must also be addressed before public
multi-user deployment. No migration or application code is changed by this example.

## Columns the current code reads or writes

| Table.column | Code contract | SQL evidence/type |
| --- | --- | --- |
| files.id | Returned from init, used as file identifier and object prefix | Base SQL type/default/key not supplied |
| files.filename | File display/download name; init trims it | Base SQL type not supplied |
| files.total_size | Positive safe-integer byte count | Base SQL type not supplied |
| files.total_chunks | Positive piece count; init checks ceil(bytes / 4194304) | Base SQL type not supplied |
| files.mime_type | Stored MIME string; octet-stream fallback | Base SQL type not supplied |
| files.status | UPLOADING, COMPLETED, FAILED are recognized | Base SQL type/enum/check not supplied |
| files.storage_path | Null while unfinished; chunks/fileId for new completed files, legacy merged path for old records | Base SQL type/nullability not supplied |
| files.created_at | Used for sorting, newest reuse, cleanup age | Base SQL type/default not supplied |
| files.deleted_at | Null means active; timestamp means Bin or claimed cancellation | TIMESTAMPTZ DEFAULT NULL in checked-in SQL |
| files.user_id | Verified owner on new init; filter for reuse/cancel | UUID references auth.users(id) in checked-in SQL; no NOT NULL declaration |
| file_chunks.file_id | Identifies parent upload | Base SQL type/physical foreign key not supplied |
| file_chunks.chunk_index | Zero-based piece index | Base SQL type not supplied |
| file_chunks.chunk_size | Piece bytes, summed during completion | Base SQL type not supplied |
| file_chunks.checksum | SHA-256 hex string from verified chunk bytes | Base SQL type not supplied |

Chunk upsert uses `onConflict: 'file_id,chunk_index'`: the live schema is expected
to have a compatible unique constraint/index. The fallback deletes and inserts a
piece row if upsert fails; it does not establish the missing constraint. Verify the
base schema rather than treating test fixtures as a migration.

## Status and lifecycle

- Init inserts UPLOADING. FAILED rows from legacy/external failures are eligible
  for reuse; current route handlers do not mark rows FAILED when the browser errors.
- Completion checks indices, metadata/object sizes and availability before setting
  COMPLETED and storage_path. It is idempotent for an already completed record
  with a storage path.
- Soft delete sets deleted_at and keeps object/metadata rows. Restore clears it.
  Both the normal file list and Bin list filter to COMPLETED records.
- Cancellation conditionally marks an owned UPLOADING/FAILED row deleted before
  removing its objects, piece rows and file row. Legacy unowned rows require
  operator cleanup; they are not claimed by another user through filename matching.
- Quota sums total_size for non-deleted COMPLETED records. It is an informational
  total, not measured physical Storage bytes, not per-user, and not an enforced cap.
- Unfinished cleanup uses created_at age (not last activity), defaults to 24 hours,
  and can include previously marked/deleted unfinished records on retry.

## Storage layout

New pieces use `chunks/<fileId>/<zeroBasedIndex>` inside the configured bucket
(default `dfup`). Storage objects are upserted; completion does not merge them.
Deleting all of `chunks/` would destroy completed downloads as well as unfinished
attempts. Older records can point at `merged/...`; the downloader supports these.

The code does not create the bucket or inspect its visibility/size limits. A private
bucket is compatible with the server service-role access and signed legacy URLs;
choose its policies/limits explicitly. Do not expose the service-role key in a
browser. Storage size/type restrictions can still reject a piece independently of
client slicing.

For abandoned rows and orphan objects, see [cleanup instructions](api.md#operator-cleanup).
