'use client'

import { useState, type ReactNode } from 'react'

const MAX_LEN = 120

export type CommentData = {
  id: number
  target_type: string
  target_id: number
  user_id: string
  content: string
  created_at: string
  author_name: string
}

export function CommentSection({
  targetType,
  targetId,
  currentUserId,
  currentUserName,
  initialComments,
  isAdmin,
  socialBarSlot,
}: {
  targetType: 'bet' | 'combo'
  targetId: number
  currentUserId: string
  currentUserName: string
  initialComments: CommentData[]
  isAdmin?: boolean
  /** Rendered inline next to the "💬 Kommentar" trigger — typically the ReactionBar. */
  socialBarSlot?: ReactNode
}) {
  const [comments, setComments] = useState<CommentData[]>(initialComments)
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  async function submit() {
    const trimmed = input.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType, targetId, content: trimmed }),
    })
    if (res.ok) {
      const { comment } = await res.json()
      setComments(prev => [...prev, { ...comment, author_name: currentUserName }])
      setInput('')
      setOpen(false)
    }
    setSubmitting(false)
  }

  async function remove(id: number) {
    setDeletingId(id)
    const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' })
    if (res.ok) setComments(prev => prev.filter(c => c.id !== id))
    setDeletingId(null)
  }

  const canDelete = (c: CommentData) => c.user_id === currentUserId || isAdmin

  return (
    <div>
      {/* Existing comments */}
      {comments.length > 0 && (
        <div className="space-y-1 mb-1.5">
          {comments.map(c => (
            <div key={c.id} className="flex items-start gap-1.5 group">
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-semibold text-gray-600">{c.author_name} </span>
                <span className="text-[11px] text-gray-500">{c.content}</span>
              </div>
              {canDelete(c) && (
                <button
                  onClick={() => remove(c.id)}
                  disabled={deletingId === c.id}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 hover:text-red-500 flex-shrink-0 transition-opacity disabled:opacity-40"
                  aria-label="Kommentar löschen"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reactions + comment trigger in one row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {socialBarSlot}
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            💬 Kommentar
          </button>
        )}
      </div>

      {/* Input row */}
      {open && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setOpen(false); setInput('') } }}
            placeholder="Kommentar…"
            maxLength={MAX_LEN}
            autoFocus
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-red-300 min-w-0"
          />
          <span className="text-[10px] text-gray-400 flex-shrink-0">{input.length}/{MAX_LEN}</span>
          <button
            onClick={submit}
            disabled={!input.trim() || submitting}
            className="text-xs px-2 py-1 bg-red-700 text-white rounded-lg disabled:opacity-40 flex-shrink-0 font-medium"
          >
            {submitting ? '…' : 'OK'}
          </button>
          <button
            onClick={() => { setOpen(false); setInput('') }}
            className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
