'use client'

import { useState } from 'react'

function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/[ß]/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function TeamLogo({
  name,
  size = 'sm',
  className = '',
}: {
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const slug = teamSlug(name)
  const initial = name.replace(/^(SpVgg|SpFr|TSV|FC|SV|VfL|1\.\s*SC|SC)\s+/i, '').trim()[0]?.toUpperCase() ?? '?'

  const dim = size === 'xs' ? 'w-4 h-4 text-[8px]'
    : size === 'sm' ? 'w-6 h-6 text-[10px]'
    : size === 'md' ? 'w-8 h-8 text-xs'
    : 'w-10 h-10 text-sm'

  if (failed) {
    return (
      <div className={`${dim} rounded-full bg-gray-200 flex items-center justify-center font-bold text-gray-500 flex-shrink-0 ${className}`}>
        {initial}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/crests/${slug}.png`}
      alt={name}
      onError={() => setFailed(true)}
      className={`${dim} rounded-full object-contain flex-shrink-0 ${className}`}
    />
  )
}
