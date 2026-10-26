import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { removeUploadData } from '@/lib/chunkCleanup';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const supabaseAdmin = getSupabaseServer();
    const url = new URL(request.url);
    const isPermanent = url.searchParams.get('permanent') === 'true';

    if (isPermanent) {
      const { data: file, error: fileError } = await supabaseAdmin
        .from('files')
        .select('storage_path')
        .eq('id', fileId)
        .single();

      if (fileError || !file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      await removeUploadData(supabaseAdmin, fileId, file.storage_path);
    } else {
      const { error } = await supabaseAdmin
        .from('files')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', fileId);

      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('DELETE route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Delete operation failed' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const supabaseAdmin = getSupabaseServer();

    const { error } = await supabaseAdmin
      .from('files')
      .update({ deleted_at: null })
      .eq('id', fileId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('PATCH restore error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Restore operation failed' },
      { status: 500 }
    );
  }
}
