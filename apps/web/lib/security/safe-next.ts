// Allow only same-site relative paths. Anything else falls back to the default.
export function safeNext(next: string | undefined, fallback = '/backoffice'): string {
  if (!next) return fallback
  // Must start with a single "/" (blocks "//host", "/\host", "https://...")
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  // Block control characters
  if (/[\u0000-\u001f]/.test(next)) return fallback
  return next
}