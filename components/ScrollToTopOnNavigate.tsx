'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

/**
 * The app's scrollable area is the <main id="app-main"> element, not the window
 * (it uses overflow-y-auto so the sticky header/bottom-nav stay fixed). Next.js's
 * router only resets window scroll on navigation, so this custom container keeps
 * its previous scrollTop when switching pages (e.g. Tipps scrolled down → Rangliste
 * opens already scrolled) or switching matchday via ?matchday=X on the same route.
 * Reset it manually whenever the path or query string changes.
 */
export function ScrollToTopOnNavigate() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    document.getElementById('app-main')?.scrollTo({ top: 0 })
  }, [pathname, searchParams])

  return null
}
