'use client'

import { useEffect, useRef } from 'react'

export function MatchdayScroller({
  children,
  activeIndex,
}: {
  children: React.ReactNode
  activeIndex: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const active = el.children[activeIndex] as HTMLElement | undefined
    if (!active) return
    el.scrollLeft = Math.max(0, active.offsetLeft - 16)
  }, [activeIndex])

  return (
    <div ref={ref} className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
      {children}
    </div>
  )
}
