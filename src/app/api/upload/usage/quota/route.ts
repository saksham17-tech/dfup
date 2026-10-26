import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

/**
 * GET /api/upload/usage/quota
 * Completed, non-bin files only, matching the file list.
 */
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    const { data: rows, error } = await supabase
      .from('files')
      .select('total_size')
      .eq('status', 'COMPLETED')
      .is('deleted_at', null);

    if (error) {
      console.error('quota query failed', error);
      return NextResponse.json(
        { error: error.message || 'Failed to compute quota' },
        { status: 500 },
      );
    }

    const usedBytes = (rows ?? []).reduce(
      (acc, r) => acc + Number(r.total_size ?? 0),
      0,
    );

    return NextResponse.json({
      usedBytes,
      fileCount: rows?.length ?? 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('quota error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
