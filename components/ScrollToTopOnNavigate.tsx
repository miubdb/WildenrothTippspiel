'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

/**
 * The app's intended scrollable area is the <main id="app-main"> element (it uses
 * overflow-y-auto so the sticky header/bottom-nav stay fixed) — but on some engines
 * (notably iOS Safari/PWA) a flex child with overflow-y-auto doesn't reliably get a
 * bounded height, so the window/document itself ends up scrolling instead. Reset
 * BOTH possible scroll containers on every navigation so whichever one actually
 * scrolled gets snapped back to the top.
 */
export function ScrollToTopOnNavigate() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    document.getElementById('app-main')?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [pathname, searchParams])

  return null
}
