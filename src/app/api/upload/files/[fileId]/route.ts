import { NextResponse } from 'next/server';
import { getSupabaseServer, STORAGE_BUCKET } from '@/lib/supabaseServer';
import { chunkPrefix, listChunkObjects } from '@/lib/chunkStorage';

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

      // Also remove leftover pieces from partial uploads and legacy merge attempts.
      const pieces = await listChunkObjects(supabaseAdmin, fileId);
      const paths = pieces.map((piece) => piece.path);
      if (file.storage_path && file.storage_path !== chunkPrefix(fileId)) paths.push(file.storage_path);
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths.slice(offset, offset + 100));
        if (error) throw error;
      }

      const { error: metadataError } = await supabaseAdmin.from('file_chunks').delete().eq('file_id', fileId);
      if (metadataError) throw metadataError;
      const { error } = await supabaseAdmin
        .from('files')
        .delete()
        .eq('id', fileId);

      if (error) throw error;
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
