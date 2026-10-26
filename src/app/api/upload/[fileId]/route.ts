import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { discardUnfinished, DiscardError } from '@/lib/chunkCleanup';
import { uploadUserId } from '@/lib/uploadAuth';

export async function DELETE(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const userId = await uploadUserId(request);
    if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    await discardUnfinished(getSupabaseServer(), (await params).fileId, userId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not discard upload' },
      { status: error instanceof DiscardError ? error.status : 500 });
  }
}
