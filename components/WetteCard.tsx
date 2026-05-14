'use client'

import { useState } from 'react'
import { ReactionBar } from '@/components/ReactionBar'
import { CommentSection, type CommentData } from '@/components/CommentSection'

// ── Types ──────────────────────────────────────────────────────────────

export type WetteStatus = 'pending' | 'won' | 'lost'

export type WetteLeg = {
  id: number
  matchName: string
  market: string
  selection: string
  odds: number
  status: WetteStatus
  score?: string | null
}

export type WetteData = {
  id: string
  type: 'single' | 'combo'
  isRisky?: boolean
  totalOdds: number
  stake: number
  payout?: number | null
  status: WetteStatus
  legs: WetteLeg[]
  betId?: number
  comboId?: number
}

export type WetteSocial = {
  reactions: { emoji: string; user_id: string }[]
  comments: CommentData[]
  currentUserId: string
  currentUserName: string
  isAdmin?: boolean
  targetType: 'bet' | 'combo'
  targetId: number
}

// ── Helpers ────────────────────────────────────────────────────────────

const MARKET_LABEL: Record<string, string> = {
  '1x2': 'Spielausgang',
  double_chance: 'Doppelte Chance',
  over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5',
  over_under_5_5: 'Ü/U 5,5',
  over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen',
  exact_score: 'Ergebnis',
  handicap: 'Handicap',
}

export function fmt(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtOdds(n: number) {
  return n.toFixed(2).replace('.', ',')
}

function StatusPill({ status }: { status: WetteStatus }) {
  if (status === 'won')
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">Gewonnen</span>
  if (status === 'lost')
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 whitespace-nowrap">Verloren</span>
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 whitespace-nowrap">Offen</span>
}

// ── WetteCard ─────────────────────────────────────────────────────────

export function WetteCard({
  wette,
  social,
  onCancel,
  cancellingId,
  isDeadlinePassed,
  defaultOpen = false,
}: {
  wette: WetteData
  social?: WetteSocial
  onCancel?: (betId?: number, comboId?: number) => void
  cancellingId?: string | null
  isDeadlinePassed?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isCancelling = cancellingId === wette.id
  const canCancel = !!onCancel && !isDeadlinePassed && wette.status === 'pending'

  const accentCls =
    wette.status === 'won' ? 'border-l-green-500' :
    wette.status === 'lost' ? 'border-l-red-400' :
    'border-l-amber-400'

  const leg0 = wette.legs[0]
  const typeLine =
    wette.isRisky ? '🎲 Risky' :
    wette.type === 'combo' ? `🔗 Kombiwette · ${wette.legs.length} Tipps` :
    'Einzelwette'

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* ── Collapsed header — always visible, entire row is the toggle ── */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full border-l-4 ${accentCls} px-3 pt-2.5 pb-2 text-left`}
      >
        <div className="flex items-start gap-2">
          {/* Left: type / selection / match / stake */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-gray-400 font-medium">{typeLine}</span>
              {wette.type === 'single' && leg0 && (
                <span className="text-xs font-bold text-gray-900">{leg0.selection}</span>
              )}
            </div>
            {wette.type === 'single' && leg0 && (
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{leg0.matchName}</div>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm font-black text-red-700">@{fmtOdds(wette.totalOdds)}</span>
              <span className="text-[10px] text-gray-500">{fmt(wette.stake)} €</span>
              {wette.status === 'pending' && (
                <span className="text-[10px] text-gray-500">
                  {'→ mög. '}<span className="font-semibold text-gray-700">{fmt(wette.stake * wette.totalOdds)} €</span>
                </span>
              )}
              {wette.status === 'won' && wette.payout != null && (
                <span className="text-[10px] font-bold text-green-600">+{fmt(wette.payout)} €</span>
              )}
              {wette.status === 'lost' && (
                <span className="text-[10px] text-red-400 line-through">{fmt(wette.stake)} €</span>
              )}
            </div>
          </div>

          {/* Right: status + storno + chevron */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
            <div className="flex items-center gap-1">
              <StatusPill status={wette.status} />
              <svg
                className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {canCancel && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onCancel(wette.betId, wette.comboId) }}
                disabled={isCancelling}
                className="text-[10px] px-1.5 py-0.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40 font-medium"
              >
                {isCancelling ? '…' : 'Storno'}
              </button>
            )}
          </div>
        </div>
      </button>

      {/* ── Expanded: legs + social ── */}
      {open && (
        <div className="border-t border-gray-100">
          <div className="px-3 py-2 space-y-2">
            {wette.legs.map(leg => {
              const dotCls = leg.status === 'won' ? 'bg-green-500' : leg.status === 'lost' ? 'bg-red-400' : 'bg-amber-400'
              const oddsCls = leg.status === 'won' ? 'text-green-600' : leg.status === 'lost' ? 'text-red-400' : 'text-red-700'
              return (
                <div key={leg.id} className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${dotCls}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-gray-500 leading-snug">{leg.matchName}</div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1 py-px rounded">
                        {MARKET_LABEL[leg.market] ?? leg.market}
                      </span>
                      <span className="text-xs font-semibold text-gray-900">{leg.selection}</span>
                      {leg.score && <span className="text-[10px] text-gray-400">· {leg.score}</span>}
                    </div>
                  </div>
                  <span className={`text-xs font-bold flex-shrink-0 ${oddsCls}`}>
                    @{fmtOdds(leg.odds)}
                  </span>
                </div>
              )
            })}
          </div>

          {social && (
            <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-1.5">
              <CommentSection
                targetType={social.targetType}
                targetId={social.targetId}
                currentUserId={social.currentUserId}
                currentUserName={social.currentUserName}
                initialComments={social.comments}
                isAdmin={social.isAdmin}
                socialBarSlot={
                  <ReactionBar
                    targetType={social.targetType}
                    targetId={social.targetId}
                    currentUserId={social.currentUserId}
                    initialReactions={social.reactions}
                  />
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
