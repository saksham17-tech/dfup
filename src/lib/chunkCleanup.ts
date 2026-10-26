import { getSupabaseServer, STORAGE_BUCKET } from './supabaseServer';
import { chunkPrefix } from './chunkStorage';

type Client = ReturnType<typeof getSupabaseServer>;

/** List before deleting: removing a page while paging would skip later objects. */
export async function removeUploadData(client: Client, fileId: string, storagePath?: string | null) {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(STORAGE_BUCKET).list(chunkPrefix(fileId), {
      limit: 1000, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    for (const object of data ?? []) paths.push(`${chunkPrefix(fileId)}/${object.name}`);
    if (!data || data.length < 1000) break;
  }
  if (storagePath && storagePath !== chunkPrefix(fileId)) paths.push(storagePath);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await client.storage.from(STORAGE_BUCKET).remove(paths.slice(offset, offset + 100));
    if (error) throw error;
  }
  const { error: piecesError } = await client.from('file_chunks').delete().eq('file_id', fileId);
  if (piecesError) throw piecesError;
  const { error } = await client.from('files').delete().eq('id', fileId);
  if (error) throw error;
}

export class DiscardError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** userId=null is reserved for the already authenticated cleanup operator. */
export async function discardUnfinished(client: Client, fileId: string, userId: string | null) {
  let query = client.from('files').update({ deleted_at: new Date().toISOString() })
    .eq('id', fileId).in('status', ['UPLOADING', 'FAILED']);
  if (userId !== null) query = query.eq('user_id', userId);
  const { data, error } = await query.select('id, storage_path');
  if (error) throw error;
  if (!data?.[0]) {
    let lookup = client.from('files').select('status').eq('id', fileId);
    if (userId !== null) lookup = lookup.eq('user_id', userId);
    const { data: file } = await lookup.single();
    if (file?.status === 'COMPLETED') throw new DiscardError('Completed files cannot be cancelled', 409);
    throw new DiscardError('Unfinished upload not found', 404);
  }
  await removeUploadData(client, fileId, data[0].storage_path);
}
