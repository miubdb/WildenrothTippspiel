import { NextResponse, type NextRequest } from 'next/server'
import { isFixtureDemoEnabled } from '@/lib/recap/demo'
import { decryptSnapshot } from '@/lib/recap/snapshot'
import { DEMO_KEY_COOKIE } from '@/lib/recap/demoKey'

export const dynamic = 'force-dynamic'

/** Prüft den Schlüssel, setzt ihn als httpOnly-Cookie und entfernt ihn per Redirect aus der URL. Nur im DB-freien Test-Deployment. */
export function GET(req: NextRequest) {
  if (!isFixtureDemoEnabled()) return new NextResponse('Not found', { status: 404 })
  const k = req.nextUrl.searchParams.get('k') ?? ''
  const ok = decryptSnapshot(k) != null
  const res = NextResponse.redirect(new URL(ok ? '/recap-demo/winter' : '/recap-demo?key=invalid', req.nextUrl.origin))
  if (ok) res.cookies.set(DEMO_KEY_COOKIE, k, { httpOnly: true, secure: true, sameSite: 'lax', path: '/recap-demo', maxAge: 60 * 60 * 24 * 7 })
  res.headers.set('Cache-Control', 'no-store')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}
