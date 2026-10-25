import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { completeChunkUpload, UploadCompletionError } from '@/lib/chunkStorage';

/** POST /api/upload/:fileId/complete — safe to retry, including after a legacy merge failure. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const result = await completeChunkUpload(getSupabaseServer(), fileId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not complete upload' },
      { status: error instanceof UploadCompletionError ? error.status : 500 },
    );
  }
}
