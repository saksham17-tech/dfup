import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { discardUnfinished, DiscardError } from '@/lib/chunkCleanup';
import { isCleanupOperator } from '@/lib/uploadAuth';

export async function POST(request: NextRequest) {
  if (!isCleanupOperator(request)) return NextResponse.json({ error: 'Cleanup operator token required' }, { status: 401 });
  const hours = Number(request.nextUrl.searchParams.get('hours') ?? '24');
  if (!Number.isFinite(hours) || hours < 0 || hours > 876000)
    return NextResponse.json({ error: 'hours must be between 0 and 876000' }, { status: 400 });
  let removed = 0;
  try {
    const client = getSupabaseServer();
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    const ids: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = client.from('files').select('id').in('status', ['UPLOADING', 'FAILED']);
      if (hours > 0) query = query.lt('created_at', cutoff);
      const { data, error } = await query.order('id').range(offset, offset + 999);
      if (error) throw error;
      for (const file of data ?? []) ids.push(file.id);
      if (!data || data.length < 1000) break;
    }
    for (const id of ids) {
      try { await discardUnfinished(client, id, null); removed++; }
      catch (error: unknown) {
        if (!(error instanceof DiscardError) || ![404, 409].includes(error.status)) throw error;
      }
    }
    return NextResponse.json({ ok: true, removed });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, removed, error: error instanceof Error ? error.message : 'Cleanup failed' }, { status: 500 });
  }
}
