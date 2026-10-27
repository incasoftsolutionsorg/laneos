// Supabase Storage buckets (migration 20261027090100). Objects live under "<tenant_id>/…".
export const PUBLIC_BUCKET = 'tenant-public';
export const PRIVATE_BUCKET = 'tenant-private';

/** URL of a logo or item photo in the public bucket (null-safe). */
export function publicUrl(path: string | null | undefined): string | null {
  return path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}` : null;
}
