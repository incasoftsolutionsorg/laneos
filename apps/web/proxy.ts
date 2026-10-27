import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { applySecurityHeaders, buildCsp } from '@/lib/security/headers'

// Next.js 16 runs this on every request (it replaces middleware.ts; only one of the two may exist).
// It refreshes the Supabase session, keeps signed-out users out of private routes and sets the
// security headers (CSP with a per-request nonce).

const PUBLIC = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/auth/confirm',
  '/admin/login',
  '/r/',
  '/manifest.webmanifest',
  '/lane-sw.js',
  '/api/payhere/notify',
]
const isPublic = (p: string) => PUBLIC.some((x) => p === x || p.startsWith(x.endsWith('/') ? x : `${x}/`))

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production'
  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce, isDev)

  const reqHeaders = new Headers(request.headers)
  reqHeaders.set('x-nonce', nonce)
  reqHeaders.set('content-security-policy', csp)

  let response = NextResponse.next({ request: { headers: reqHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: reqHeaders } })
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, sameSite: 'lax', secure: !isDev, path: '/' }),
          )
        },
      },
    },
  )

  // getUser() verifies the token with the Auth server. Never trust getSession() for access decisions.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublic(pathname)) {
    if (pathname.startsWith('/api/')) {
      const res = NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })
      applySecurityHeaders(res, csp)
      return res
    }
    const url = request.nextUrl.clone()
    url.pathname = pathname.startsWith('/admin') ? '/admin/login' : '/login'
    url.searchParams.set('next', pathname)
    const redirect = NextResponse.redirect(url)
    // Keep any refreshed session cookies on the redirect response
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    applySecurityHeaders(redirect, csp)
    return redirect
  }

  // 2-step verification: someone with a verified authenticator must enter a code before any private page.
  // getAuthenticatorAssuranceLevel() reads the (already verified) session locally; no extra round trip.
  if (user && !isPublic(pathname) && !pathname.startsWith('/auth/') && user.factors?.some((f) => f.status === 'verified')) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.currentLevel !== 'aal2') {
      if (pathname.startsWith('/api/')) {
        const res = NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: '2-step verification needed' } }, { status: 401 })
        applySecurityHeaders(res, csp)
        return res
      }
      const url = request.nextUrl.clone()
      url.pathname = '/login/mfa'
      url.search = ''
      url.searchParams.set('next', pathname)
      const redirect = NextResponse.redirect(url)
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
      applySecurityHeaders(redirect, csp)
      return redirect
    }
  }

  // Reset access (§27.5.4–5) deletes the user's auth sessions, so getUser() above already fails for
  // their old tokens. TODO (later tasks): tenant resolution by subdomain, rate limits.

  // Shared shop PCs must not keep tenant pages in the browser cache.
  if (/^\/(backoffice|lane|admin|api)(\/|$)/.test(pathname)) {
    response.headers.set('Cache-Control', 'no-store')
  }
  applySecurityHeaders(response, csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
}
