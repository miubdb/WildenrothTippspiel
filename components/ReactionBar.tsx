'use client'

import { useState, useEffect } from 'react'

const EMOJIS = ['👏', '🔥', '😬', '😎', '💀']

type ReactionCount = { emoji: string; count: number; myReaction: boolean }

export function ReactionBar({
  targetType,
  targetId,
  currentUserId,
  initialReactions,
}: {
  targetType: 'bet' | 'combo'
  targetId: number
  currentUserId: string
  initialReactions: { emoji: string; user_id: string }[]
}) {
  const [counts, setCounts] = useState<ReactionCount[]>(() =>
    buildCounts(initialReactions, currentUserId)
  )
  const [loading, setLoading] = useState(false)

  async function toggle(emoji: string) {
    if (loading) return
    setLoading(true)

    // Optimistic update
    setCounts(prev => {
      const myOld = prev.find(r => r.myReaction)
      return EMOJIS.map(e => {
        const existing = prev.find(r => r.emoji === e) ?? { emoji: e, count: 0, myReaction: false }
        if (e === emoji) {
          return existing.myReaction
            ? { ...existing, count: Math.max(0, existing.count - 1), myReaction: false }
            : { ...existing, count: existing.count + 1, myReaction: true }
        }
        if (myOld && e === myOld.emoji) {
          return { ...existing, count: Math.max(0, existing.count - 1), myReaction: false }
        }
        return existing
      }).filter(r => r.count > 0 || r.myReaction)
    })

    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType, targetId, emoji }),
    })
    setLoading(false)
  }

  const displayed = counts.filter(r => r.count > 0)

  return (
    <div className="flex items-center gap-1 flex-wrap mt-1.5">
      {displayed.map(r => (
        <button
          key={r.emoji}
          onClick={() => toggle(r.emoji)}
          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-all ${
            r.myReaction ? 'bg-blue-100 border border-blue-300 text-blue-800' : 'bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <span>{r.emoji}</span>
          <span className="font-semibold">{r.count}</span>
        </button>
      ))}
      {/* Add reaction picker */}
      <AddReactionButton onSelect={toggle} />
    </div>
  )
}

function AddReactionButton({ onSelect }: { onSelect: (e: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-6 h-6 rounded-full bg-gray-100 border border-gray-200 text-gray-500 hover:bg-gray-200 flex items-center justify-center text-xs"
      >
        +
      </button>
      {open && (
        <div className="absolute bottom-8 left-0 z-10 bg-white border border-gray-200 rounded-xl shadow-lg flex gap-1 p-2">
          {EMOJIS.map(e => (
            <button key={e} onClick={() => { onSelect(e); setOpen(false) }} className="text-lg hover:scale-125 transition-transform">
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function buildCounts(reactions: { emoji: string; user_id: string }[], currentUserId: string): ReactionCount[] {
  const map = new Map<string, { count: number; myReaction: boolean }>()
  for (const r of reactions) {
    const existing = map.get(r.emoji) ?? { count: 0, myReaction: false }
    map.set(r.emoji, { count: existing.count + 1, myReaction: existing.myReaction || r.user_id === currentUserId })
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, ...v }))
}
