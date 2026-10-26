import { timingSafeEqual } from 'node:crypto';
import { getSupabaseServer } from './supabaseServer';

export async function uploadUserId(request: Request): Promise<string | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await getSupabaseServer().auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

/** Bulk cleanup is an operator action, never exposed to browser users. */
export function isCleanupOperator(request: Request): boolean {
  const expected = process.env.UPLOAD_CLEANUP_TOKEN;
  const actual = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!expected || expected.length < 32 || !actual) return false;
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
