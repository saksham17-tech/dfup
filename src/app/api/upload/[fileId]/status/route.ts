import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

/**
 * GET /api/upload/:fileId/status
 * Returns { status, totalChunks, uploadedChunks: number[] }
 * Reads the same `file_chunks` table the chunk route writes to.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const supabase = getSupabaseServer();

    const { data: file, error: fileErr } = await supabase
      .from('files')
      .select('status, total_chunks')
      .eq('id', fileId)
      .single();

    if (fileErr || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const uploadedChunks = new Set<number>();
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await supabase
        .from('file_chunks').select('chunk_index').eq('file_id', fileId)
        .order('chunk_index', { ascending: true }).range(offset, offset + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const row of rows ?? []) uploadedChunks.add(Number(row.chunk_index));
      if (!rows || rows.length < 1000) break;
    }

    return NextResponse.json(
      {
        status: file.status,
        totalChunks: file.total_chunks,
        uploadedChunks: [...uploadedChunks],
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
