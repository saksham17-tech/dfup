import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseServer,
  STORAGE_BUCKET,
} from '@/lib/supabaseServer';
import { chunkPrefix } from '@/lib/chunkStorage';

/**
 * GET /api/upload/files/:fileId/download
 * Streams chunk-backed files in numeric order, or redirects older merged files to Storage.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await context.params;
    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    const { data: file, error } = await supabase
      .from('files')
      .select('id, storage_path, filename, status, total_chunks, total_size, mime_type, deleted_at')
      .eq('id', fileId)
      .single();

    if (error || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (file.status !== 'COMPLETED' || !file.storage_path || file.deleted_at) {
      return NextResponse.json(
        { error: 'File is not available for download' },
        { status: 409 },
      );
    }

    if (file.storage_path === chunkPrefix(fileId)) {
      const totalChunks = Number(file.total_chunks);
      const totalSize = Number(file.total_size);
      if (!Number.isSafeInteger(totalChunks) || totalChunks < 1 || !Number.isSafeInteger(totalSize) || totalSize < 1) {
        return NextResponse.json({ error: 'File has invalid size or piece count' }, { status: 500 });
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      req.signal.addEventListener('abort', abort, { once: true });
      if (req.signal.aborted) abort();
      const cleanup = () => req.signal.removeEventListener('abort', abort);
      const readPiece = async (index: number) => {
        const { data, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET)
          .download(`${chunkPrefix(fileId)}/${index}`, {}, { signal: controller.signal });
        if (downloadError || !data) throw new Error(`Could not read piece ${index + 1}: ${downloadError?.message ?? 'missing object'}`);
        return new Uint8Array(await data.arrayBuffer());
      };
      // Fail before sending headers if the first object cannot be read.
      let first: Uint8Array | null;
      try {
        first = await readPiece(0);
      } catch (error) {
        cleanup();
        throw error;
      }
      let index = 0, sent = 0, cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const bytes = first ?? await readPiece(index);
            first = null;
            if (cancelled || controller.signal.aborted) {
              if (!cancelled) output.error(new Error('Download cancelled'));
              cleanup();
              return;
            }
            sent += bytes.byteLength;
            index++;
            if (sent > totalSize || (index === totalChunks && sent !== totalSize)) {
              throw new Error('Downloaded pieces do not match the file size');
            }
            output.enqueue(bytes);
            if (index === totalChunks) { output.close(); cleanup(); }
          } catch (error) {
            if (!cancelled) output.error(error);
            cleanup();
          }
        },
        cancel() { cancelled = true; first = null; controller.abort(); cleanup(); },
      }, { highWaterMark: 0 });
      const filename = (file.filename || 'download').replace(/[\r\n]/g, '_');
      const fallbackName = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
      const encodedName = encodeURIComponent(filename).replace(/['()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(stream, { headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Length': String(totalSize),
        'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'none',
        'X-Content-Type-Options': 'nosniff',
      } });
    }

    const { data, error: signErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(file.storage_path, 60, {
        download: file.filename || true,
      });

    if (signErr || !data?.signedUrl) {
      console.error('signed url failed', signErr);
      return NextResponse.json(
        { error: signErr?.message || 'Could not create download URL' },
        { status: 500 },
      );
    }

    return NextResponse.redirect(data.signedUrl);
  } catch (err) {
    console.error('download error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
