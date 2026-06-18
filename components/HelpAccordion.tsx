'use client'

import { useState } from 'react'

export function HelpAccordion({
  title,
  emoji,
  defaultOpen = false,
  children,
}: {
  title: string
  emoji: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="text-xl flex-shrink-0">{emoji}</span>
        <h2 className="font-bold text-gray-900 dark:text-gray-100 flex-1">{title}</h2>
        <svg
          className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 text-sm text-gray-600 dark:text-gray-300 space-y-2 border-t border-gray-50 dark:border-gray-700">
          {children}
        </div>
      )}
    </div>
  )
}
