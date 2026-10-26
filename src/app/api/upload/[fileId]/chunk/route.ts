import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { completeChunkUpload, UploadCompletionError } from '@/lib/chunkStorage';
import {
  getSupabaseServer,
  STORAGE_BUCKET,
} from '@/lib/supabaseServer';

/**
 * POST /api/upload/:fileId/chunk?chunkIndex=&checksum=
 * Multipart field: "chunk" (binary)
 *
 * Flow:
 *  1. Verify SHA-256
 *  2. Store chunk at  dfup/chunks/{fileId}/{chunkIndex}
 *  3. Upsert file_chunks row
 *  4. When all chunks are present → mark COMPLETED, keeping the stored pieces.
 *     Downloads stream these objects; no whole-file merge or re-upload occurs.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await context.params;
    const rawIndex = req.nextUrl.searchParams.get('chunkIndex');
    const chunkIndex = rawIndex === null ? NaN : Number(rawIndex);
    const checksum = (req.nextUrl.searchParams.get('checksum') || '')
      .trim()
      .toLowerCase();

    if (!fileId || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json(
        { error: 'Invalid fileId or chunkIndex' },
        { status: 400 },
      );
    }
    if (!checksum) {
      return NextResponse.json(
        { error: 'Missing checksum query param' },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const chunk = form.get('chunk');
    if (!chunk || !(chunk instanceof Blob)) {
      return NextResponse.json(
        { error: 'Missing chunk file (field name: "chunk")' },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await chunk.arrayBuffer());
    const actual = createHash('sha256').update(buffer).digest('hex');

    if (actual !== checksum) {
      return NextResponse.json(
        {
          error: `Checksum mismatch for chunk ${chunkIndex}: expected ${checksum}, got ${actual}`,
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServer();

    const { data: file, error: fileErr } = await supabase
      .from('files')
      .select('id, total_chunks, status, storage_path, deleted_at')
      .eq('id', fileId)
      .single();

    if (fileErr || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (chunkIndex >= file.total_chunks) {
      return NextResponse.json(
        {
          error: `chunkIndex ${chunkIndex} out of range [0, ${file.total_chunks - 1}]`,
        },
        { status: 400 },
      );
    }
    if (file.deleted_at) {
      return NextResponse.json({ error: 'File is in the bin' }, { status: 409 });
    }
    // A parallel request or lost response may arrive after completion. Never rewrite saved data.
    if (file.status === 'COMPLETED') {
      return NextResponse.json({ ok: true, chunkIndex, uploadedChunks: file.total_chunks,
        totalChunks: file.total_chunks, completed: true, storagePath: file.storage_path });
    }

    // ── 1. Persist chunk object ──────────────────────────────────────────
    const objectPath = `chunks/${fileId}/${chunkIndex}`;
    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, buffer, {
        contentType: 'application/octet-stream',
        upsert: true,
      });

    if (upErr) {
      console.error('storage upload failed', upErr);
      return NextResponse.json(
        { error: `Storage error: ${upErr.message}` },
        { status: 500 },
      );
    }

    // Cancel may have claimed/deleted the parent while Storage was accepting data.
    const { data: current, error: currentError } = await supabase.from('files')
      .select('id, deleted_at').eq('id', fileId).single();
    if (currentError || !current || current.deleted_at) {
      if (!current || current.deleted_at) {
        await supabase.storage.from(STORAGE_BUCKET).remove([objectPath]);
      }
      return NextResponse.json({ error: 'Upload is no longer available' }, { status: 409 });
    }

    // ── 2. Upsert metadata (idempotent) ──────────────────────────────────
    const { error: upsertErr } = await supabase.from('file_chunks').upsert(
      {
        file_id: fileId,
        chunk_index: chunkIndex,
        chunk_size: buffer.length,
        checksum: actual,
      },
      { onConflict: 'file_id,chunk_index' },
    );

    if (upsertErr) {
      await supabase
        .from('file_chunks')
        .delete()
        .eq('file_id', fileId)
        .eq('chunk_index', chunkIndex);

      const { error: insErr } = await supabase.from('file_chunks').insert({
        file_id: fileId,
        chunk_index: chunkIndex,
        chunk_size: buffer.length,
        checksum: actual,
      });

      if (insErr) {
        console.error('chunk metadata insert failed', insErr);
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    // ── 3. Completion check ──────────────────────────────────────────────
    const { count, error: countErr } = await supabase
      .from('file_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('file_id', fileId);

    if (countErr) {
      console.error('count failed', countErr);
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }

    const uploadedCount = count ?? 0;
    let completed = false;
    let storagePath: string | null = null;

    // The client verifies reused pieces first and explicitly completes after all
    // replacements finish. Old metadata must not finalize a partially replaced file.
    if (uploadedCount >= file.total_chunks && req.nextUrl.searchParams.get('deferCompletion') !== '1') {
      try {
        const result = await completeChunkUpload(supabase, fileId);
        storagePath = result.storagePath;
        completed = true;
      } catch (error) {
        // The chunk is durable even if another parallel request has not finished yet.
        // The explicit completion call reports missing pieces to the client.
        if (!(error instanceof UploadCompletionError) || error.status !== 409) throw error;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        chunkIndex,
        uploadedChunks: uploadedCount,
        totalChunks: file.total_chunks,
        completed,
        storagePath,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('chunk error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
