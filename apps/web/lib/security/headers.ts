export function buildCsp(nonce: string, isDev: boolean) {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const wsSupabase = supabase.replace(/^http/, 'ws')
  const d = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabase}`,
    `font-src 'self'`,
    // wss://localhost:8181/8182 are the QZ Tray ports
    `connect-src 'self' ${supabase} ${wsSupabase} https://*.sentry.io wss://localhost:8181 wss://localhost:8182`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ]
  if (!isDev) d.push('upgrade-insecure-requests')
  return d.join('; ')
}

export function applySecurityHeaders(res: Response, csp: string) {
  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Allow Web Serial (scale) and camera (barcode scanning); block everything else
  res.headers.set(
    'Permissions-Policy',
    'serial=(self), camera=(self), geolocation=(), microphone=(), payment=()',
  )
}