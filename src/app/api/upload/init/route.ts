import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { uploadUserId } from '@/lib/uploadAuth';

/**
 * POST /api/upload/init
 * Body: { filename, totalSize, totalChunks, mimeType }
 * Returns 201 { fileId }.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await uploadUserId(req);
    if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    const body = await req.json();
    const filename = String(body.filename ?? '').trim();
    const totalSize = Number(body.totalSize);
    const totalChunks = Number(body.totalChunks);
    const mimeType = String(body.mimeType || 'application/octet-stream');

    if (!filename || !Number.isSafeInteger(totalSize) || totalSize <= 0) {
      return NextResponse.json(
        { error: 'filename and totalSize are required' },
        { status: 400 },
      );
    }
    if (!Number.isSafeInteger(totalChunks) || totalChunks < 1 || totalChunks !== Math.ceil(totalSize / (4 * 1024 * 1024))) {
      return NextResponse.json(
        { error: 'totalChunks must be >= 1' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServer();

    const { data: matches, error: lookupError } = await supabase.from('files')
      .select('id').eq('user_id', userId).eq('filename', filename).eq('total_size', totalSize)
      .eq('total_chunks', totalChunks).eq('mime_type', mimeType)
      .in('status', ['UPLOADING', 'FAILED']).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(1);
    if (lookupError) throw lookupError;
    if (matches?.[0]) return NextResponse.json({ fileId: matches[0].id, resumed: true });

    const { data: file, error: insertErr } = await supabase
      .from('files')
      .insert({
        filename,
        user_id: userId,
        total_size: totalSize,
        total_chunks: totalChunks,
        mime_type: mimeType,
        status: 'UPLOADING',
      })
      .select('id')
      .single();

    if (insertErr || !file) {
      console.error('insert failed', insertErr);
      return NextResponse.json(
        { error: insertErr?.message || 'Failed to create file record' },
        { status: 500 },
      );
    }

    return NextResponse.json({ fileId: file.id }, { status: 201 });
  } catch (err) {
    console.error('init error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
