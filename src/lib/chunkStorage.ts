import { getSupabaseServer, STORAGE_BUCKET } from './supabaseServer';

type StorageClient = ReturnType<typeof getSupabaseServer>;
const PAGE_SIZE = 1000;

export class UploadCompletionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'UploadCompletionError';
  }
}

export function chunkPrefix(fileId: string): string {
  return `chunks/${fileId}`;
}

/** Storage and PostgREST both paginate; never assume a file has fewer than 1,000 pieces. */
export async function listChunkObjects(client: StorageClient, fileId: string) {
  const objects: { index: number; path: string; size: number | undefined }[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.storage.from(STORAGE_BUCKET).list(chunkPrefix(fileId), {
      limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new UploadCompletionError(`Could not check stored pieces: ${error.message}`, 500);
    for (const object of data ?? []) {
      if (/^\d+$/.test(object.name)) {
        objects.push({
          index: Number(object.name),
          path: `${chunkPrefix(fileId)}/${object.name}`,
          size: typeof object.metadata?.size === 'number' ? object.metadata.size : undefined,
        });
      }
    }
    if (!data || data.length < PAGE_SIZE) return objects;
  }
}

/** Finalize metadata only. Stored pieces remain the source of the downloadable file. */
export async function completeChunkUpload(client: StorageClient, fileId: string) {
  const { data: file, error: fileError } = await client.from('files')
    .select('id, status, total_chunks, total_size, storage_path, deleted_at')
    .eq('id', fileId).single();
  if (fileError || !file) throw new UploadCompletionError('File not found', 404);
  if (file.deleted_at) throw new UploadCompletionError('File is in the bin', 409);
  if (file.status === 'COMPLETED' && file.storage_path) {
    return { completed: true, uploadedChunks: file.total_chunks as number,
      totalChunks: file.total_chunks as number, storagePath: file.storage_path as string };
  }

  const total = Number(file.total_chunks);
  const totalSize = Number(file.total_size);
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(totalSize) || totalSize < 1) {
    throw new UploadCompletionError('File has invalid size or piece count', 500);
  }
  const pieces = new Map<number, { size: number; checksum: string }>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from('file_chunks')
      .select('chunk_index, chunk_size, checksum').eq('file_id', fileId)
      .order('chunk_index', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new UploadCompletionError(`Could not check pieces: ${error.message}`, 500);
    for (const row of data ?? []) {
      const index = Number(row.chunk_index), size = Number(row.chunk_size);
      if (!Number.isInteger(index) || index < 0 || index >= total || !Number.isSafeInteger(size) || size < 1) {
        throw new UploadCompletionError('Upload has invalid piece metadata. Retry the upload.', 409);
      }
      const previous = pieces.get(index);
      if (previous && (previous.size !== size || previous.checksum !== row.checksum)) {
        throw new UploadCompletionError('Upload has conflicting piece metadata. Retry the upload.', 409);
      }
      pieces.set(index, { size, checksum: row.checksum });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  if (pieces.size !== total) {
    throw new UploadCompletionError(
      `Upload is incomplete: ${total - pieces.size} of ${total} pieces are missing. Retry to send the missing pieces.`, 409,
    );
  }
  let savedBytes = 0;
  for (const piece of pieces.values()) savedBytes += piece.size;
  if (savedBytes !== totalSize) {
    throw new UploadCompletionError('Stored piece sizes do not match the file size. Retry the upload.', 409);
  }

  // A failed legacy merge may have removed objects while leaving their rows behind.
  const objects = await listChunkObjects(client, fileId);
  const stored = new Map(objects.map((object) => [object.index, object]));
  for (let index = 0; index < total; index++) {
    const object = stored.get(index);
    if (!object || (object.size !== undefined && object.size !== pieces.get(index)!.size)) {
      throw new UploadCompletionError(`Stored piece ${index + 1} is missing or damaged. Upload the file again.`, 409);
    }
  }
  const storagePath = chunkPrefix(fileId);
  const { data: completedFile, error } = await client.from('files')
    .update({ status: 'COMPLETED', storage_path: storagePath })
    .eq('id', fileId).is('deleted_at', null).select('id').single();
  if (error || !completedFile) {
    throw new UploadCompletionError(`Could not complete upload: ${error?.message ?? 'file is no longer available'}`, 500);
  }
  return { completed: true, uploadedChunks: total, totalChunks: total, storagePath };
}
