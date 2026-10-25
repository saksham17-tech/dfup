import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseServer,
  STORAGE_BUCKET,
} from '@/lib/supabaseServer';
import { chunkPrefix } from '@/lib/chunkStorage';

/**
 * GET /api/upload/files/list
 * ?bin=1 → soft-deleted files only
 * default → active completed files (deleted_at is null)
 */
export async function GET(req: NextRequest) {
  try {
    const bin = req.nextUrl.searchParams.get('bin') === '1';
    const supabase = getSupabaseServer();

    let query = supabase
      .from('files')
      .select(
        'id, filename, total_size, mime_type, storage_path, status, created_at, deleted_at',
      )
      .eq('status', 'COMPLETED')
      .order(bin ? 'deleted_at' : 'created_at', { ascending: false });

    if (bin) {
      query = query.not('deleted_at', 'is', null);
    } else {
      query = query.is('deleted_at', null);
    }

    const { data: files, error } = await query;

    if (error) {
      console.error('list files failed', error);
      return NextResponse.json(
        { error: error.message || 'Failed to list files' },
        { status: 500 },
      );
    }

    const result = await Promise.all(
      (files ?? []).map(async (file) => {
        let downloadUrl: string | null = null;

        if (file.storage_path === chunkPrefix(file.id) && !bin) {
          downloadUrl = `/api/upload/files/${file.id}/download`;
        } else if (file.storage_path && !bin) {
          const { data: signed, error: signErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(file.storage_path, 3600);

          if (signErr) {
            console.warn(`signed URL failed for ${file.id}:`, signErr.message);
          } else {
            downloadUrl = signed?.signedUrl ?? null;
          }
        }

        return {
          id: file.id,
          filename: file.filename,
          totalSize: Number(file.total_size),
          mimeType: file.mime_type,
          storagePath: file.storage_path,
          createdAt: file.created_at,
          deletedAt: file.deleted_at,
          downloadUrl,
        };
      }),
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error('list error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
