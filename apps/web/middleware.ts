import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { applySecurityHeaders, buildCsp } from '@/lib/security/headers'

const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/r/', '/manifest.webmanifest']
const isPublic = (p: string) => PUBLIC.some((x) => p === x || p.startsWith(x))

export async function middleware(request: NextRequest) {
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
            response.cookies.set(name, value, {
              ...options,
              sameSite: 'lax',
              secure: !isDev,
              path: '/',
            }),
          )
        },
      },
    },
  )

  // Use getUser(), which verifies the token with the Auth server.
  // Never trust getSession() for access decisions.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    const redirect = NextResponse.redirect(url)
    // Keep any refreshed session cookies on the redirect response
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    applySecurityHeaders(redirect, csp)
    return redirect
  }

  // TODO (later tasks): tenant resolution, reset markers, rate limits, MFA (aal2) enforcement

  applySecurityHeaders(response, csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
}