import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

const PUBLIC_PATHS = ['/login', '/auth']

/**
 * Optimistic route gating only (per Next.js's own guidance: proxy is not a
 * full authorization solution). It redirects an unauthenticated visitor away
 * from the app and out of /admin for non-admins based on a JWT app_metadata
 * claim mirrored from `memberships` — but every server action / API route
 * still re-checks against `memberships` itself, and RLS is the real boundary
 * underneath both. This mirrors the sibling Tippspiel project's convention
 * (see its CLAUDE.md): the proxy guards page routes, not /api/*.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  if (user && isPublic && pathname !== '/auth/callback') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and Next internals.
     * /admin/* is further gated inside app/admin/layout.tsx (which checks
     * `memberships.role` server-side against the DB, not a JWT claim) —
     * see that file's comment for why the check lives there and not here.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
