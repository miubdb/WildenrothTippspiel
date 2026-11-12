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
  // Ungültiger Schlüssel: klare Fehlerseite, KEINE Weiterleitung auf Musterdaten.
  if (!ok) return new NextResponse('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px"><h1>Schlüssel ungültig</h1><p>Der Link enthält keinen gültigen Schlüssel für die echten Wildenroth-Daten. Es werden bewusst keine Musterdaten angezeigt.</p></body>', { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  const res = NextResponse.redirect(new URL('/recap-demo/winter', req.nextUrl.origin))
  res.cookies.set(DEMO_KEY_COOKIE, k, { httpOnly: true, secure: true, sameSite: 'lax', path: '/recap-demo', maxAge: 60 * 60 * 24 * 7 })
  res.headers.set('Cache-Control', 'no-store')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}
