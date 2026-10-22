import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase/env';

const PROTECTED = ['/backoffice', '/lane', '/admin', '/api/lane'];

// Refreshes the Supabase session cookie on every request and keeps signed-out users out of the app.
// Reset-marker checks (blueprint §27.5.5) are added here in the session-reset task.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;

  if (!data?.claims && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (path.startsWith('/backoffice') || path.startsWith('/lane') || path.startsWith('/admin')) {
    response.headers.set('Cache-Control', 'no-store'); // shared shop PCs must not cache tenant pages
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest).*)'],
};
