'use client'

import { useState } from 'react'

/**
 * Profile-header avatar that opens a full-screen lightbox on tap when a
 * real photo is set. The initial-letter fallback (no avatar_url) stays
 * inert — there's nothing bigger to show for it.
 */
export function AvatarLightbox({
  avatarUrl,
  initial,
  size = 64,
}: {
  avatarUrl: string | null
  initial: string
  size?: number
}) {
  const [open, setOpen] = useState(false)

  if (!avatarUrl) {
    return (
      <div
        className="rounded-full bg-white flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <span className="text-red-700 font-black text-2xl">{initial}</span>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Profilbild vergrößern"
        className="flex-shrink-0 rounded-full"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt="Avatar"
          className="rounded-full object-cover border-2 border-white/40 active:opacity-80 transition-opacity"
          style={{ width: size, height: size }}
        />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl}
            alt="Avatar"
            className="max-w-full max-h-full rounded-2xl object-contain"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Schließen"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center text-lg"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
