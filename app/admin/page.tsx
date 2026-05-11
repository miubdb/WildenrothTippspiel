'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface MatchRow {
  id: number
  match_number: number
  matchday: number
  match_date: string
  status: string
  home_score: number | null
  away_score: number | null
  home_team: { name: string; short_name: string } | null
  away_team: { name: string; short_name: string } | null
}

interface InviteCode {
  id: string
  code: string
  max_uses: number | null
  used_count: number
  is_active: boolean
  created_at: string
}

type Tab = 'results' | 'invites' | 'odds'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('results')
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [scores, setScores] = useState<Record<number, { home: string; away: string }>>({})
  const [loading, setLoading] = useState(false)
  const [settleLoading, setSettleLoading] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([])
  const [newCode, setNewCode] = useState('')
  const [newMaxUses, setNewMaxUses] = useState('10')
  const [oddsLoading, setOddsLoading] = useState(false)

  const supabase = createClient()

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('matches')
      .select(
        `id, match_number, matchday, match_date, status, home_score, away_score,
         home_team:teams!matches_home_team_id_fkey(name, short_name),
         away_team:teams!matches_away_team_id_fkey(name, short_name)`
      )
      .order('match_date', { ascending: true })

    const rows: MatchRow[] = (data ?? []).map((m) => ({
      ...m,
      home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
      away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
    }))

    setMatches(rows)
    setLoading(false)
  }, [supabase])

  const fetchInviteCodes = useCallback(async () => {
    const { data } = await supabase
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false })
    setInviteCodes(data ?? [])
  }, [supabase])

  useEffect(() => {
    fetchMatches()
    fetchInviteCodes()
  }, [fetchMatches, fetchInviteCodes])

  function handleScoreChange(
    matchId: number,
    side: 'home' | 'away',
    value: string
  ) {
    setScores((prev) => ({
      ...prev,
      [matchId]: {
        home: side === 'home' ? value : prev[matchId]?.home ?? '',
        away: side === 'away' ? value : prev[matchId]?.away ?? '',
      },
    }))
  }

  async function settleMatch(matchId: number) {
    const score = scores[matchId]
    if (!score || score.home === '' || score.away === '') {
      setMessage('Bitte beide Tore eingeben.')
      return
    }
    const homeScore = parseInt(score.home)
    const awayScore = parseInt(score.away)
    if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
      setMessage('Ungültige Toranzahl.')
      return
    }

    setSettleLoading(matchId)
    setMessage(null)

    const res = await fetch('/api/admin/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, homeScore, awayScore }),
    })

    const data = await res.json()
    setSettleLoading(null)

    if (res.ok) {
      setMessage(
        `Spiel abgerechnet! ${data.settled} Wette(n) bearbeitet, ${data.combosChecked} Kombi(s) geprüft.`
      )
      fetchMatches()
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  async function createInviteCode() {
    if (!newCode.trim()) return
    const maxUses = parseInt(newMaxUses) || null

    const { error } = await supabase.from('invite_codes').insert({
      code: newCode.trim().toUpperCase(),
      max_uses: maxUses,
      used_count: 0,
      is_active: true,
    })

    if (error) {
      setMessage(`Fehler: ${error.message}`)
    } else {
      setMessage('Einladungscode erstellt.')
      setNewCode('')
      fetchInviteCodes()
    }
  }

  async function toggleCode(id: string, current: boolean) {
    await supabase.from('invite_codes').update({ is_active: !current }).eq('id', id)
    fetchInviteCodes()
  }

  async function recalculateOdds() {
    setOddsLoading(true)
    setMessage(null)
    const res = await fetch('/api/admin/odds', { method: 'POST' })
    const data = await res.json()
    setOddsLoading(false)
    if (res.ok) {
      setMessage(`Quoten berechnet: ${data.updated}/${data.total} Spiele aktualisiert.`)
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  const settledMatches = matches.filter((m) => m.status === 'finished')
  const pendingMatches = matches.filter((m) => {
    if (m.status !== 'scheduled') return false
    return new Date(m.match_date) <= new Date()
  })
  const upcomingMatches = matches.filter((m) => {
    if (m.status !== 'scheduled') return false
    return new Date(m.match_date) > new Date()
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-red-700 text-white px-4 py-4 shadow-lg">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center">
              <span className="text-red-700 font-black text-xs">SpVgg</span>
            </div>
            <div>
              <h1 className="font-black text-xl">Admin Panel</h1>
              <p className="text-red-200 text-xs">Wildenroth Tippspiel</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Message */}
        {message && (
          <div
            className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
              message.startsWith('Fehler')
                ? 'bg-red-50 text-red-700 border border-red-100'
                : 'bg-green-50 text-green-700 border border-green-100'
            }`}
          >
            {message}
            <button onClick={() => setMessage(null)} className="ml-2 opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex bg-white border border-gray-200 rounded-xl p-1 mb-4 shadow-sm">
          {(['results', 'invites', 'odds'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t
                  ? 'bg-red-700 text-white shadow'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'results' ? 'Ergebnisse' : t === 'invites' ? 'Einladungen' : 'Quoten'}
            </button>
          ))}
        </div>

        {/* Results Tab */}
        {tab === 'results' && (
          <div className="space-y-4">
            {/* Pending settlement */}
            {pendingMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Ausstehende Ergebnisse ({pendingMatches.length})
                </h2>
                <div className="space-y-2">
                  {pendingMatches.map((match) => (
                    <MatchSettleCard
                      key={match.id}
                      match={match}
                      score={scores[match.id] ?? { home: '', away: '' }}
                      onChange={(side, val) => handleScoreChange(match.id, side, val)}
                      onSettle={() => settleMatch(match.id)}
                      loading={settleLoading === match.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming matches */}
            {upcomingMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Bevorstehende Spiele ({upcomingMatches.length})
                </h2>
                <div className="space-y-2">
                  {upcomingMatches.map((match) => (
                    <MatchRow key={match.id} match={match} />
                  ))}
                </div>
              </div>
            )}

            {/* Settled */}
            {settledMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Abgerechnete Spiele ({settledMatches.length})
                </h2>
                <div className="space-y-2">
                  {settledMatches.slice(0, 10).map((match) => (
                    <MatchRow key={match.id} match={match} />
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="text-center py-8 text-gray-400">Lade Spiele...</div>
            )}
          </div>
        )}

        {/* Invites Tab */}
        {tab === 'invites' && (
          <div className="space-y-4">
            {/* Create new code */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="font-bold text-gray-900 mb-3">Neuen Code erstellen</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    placeholder="z.B. WILDENROTH2025"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Max. Verwendungen (leer = unbegrenzt)
                  </label>
                  <input
                    type="number"
                    value={newMaxUses}
                    onChange={(e) => setNewMaxUses(e.target.value)}
                    placeholder="10"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <button
                  onClick={createInviteCode}
                  disabled={!newCode.trim()}
                  className="w-full py-2.5 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  Code erstellen
                </button>
              </div>
            </div>

            {/* Existing codes */}
            <div className="space-y-2">
              {inviteCodes.map((code) => (
                <div
                  key={code.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-gray-900 tracking-widest">
                      {code.code}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Verwendet: {code.used_count}
                      {code.max_uses !== null ? ` / ${code.max_uses}` : ' / ∞'}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleCode(code.id, code.is_active)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      code.is_active
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {code.is_active ? 'Aktiv' : 'Inaktiv'}
                  </button>
                </div>
              ))}
              {inviteCodes.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Keine Einladungscodes vorhanden
                </div>
              )}
            </div>
          </div>
        )}

        {/* Odds Tab */}
        {tab === 'odds' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-bold text-gray-900 mb-1">Quoten neu berechnen</h2>
              <p className="text-sm text-gray-500 mb-4">
                Berechnet die Quoten für alle geplanten Spiele neu auf Basis der Saisondaten.
              </p>
              <button
                onClick={recalculateOdds}
                disabled={oddsLoading}
                className="w-full py-3 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {oddsLoading ? (
                  <>
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Berechne...
                  </>
                ) : (
                  'Quoten neu berechnen'
                )}
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
              <strong>Hinweis:</strong> Quoten werden automatisch aus Kopf-an-Kopf-Statistiken
              und Saisonleistungen berechnet. Eine 10% Marge wird angewendet.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MatchSettleCard({
  match,
  score,
  onChange,
  onSettle,
  loading,
}: {
  match: MatchRow
  score: { home: string; away: string }
  onChange: (side: 'home' | 'away', val: string) => void
  onSettle: () => void
  loading: boolean
}) {
  const matchDate = new Date(match.match_date)
  const dateStr = matchDate.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })

  return (
    <div className="bg-white rounded-xl border border-orange-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-orange-600 font-medium bg-orange-50 px-2 py-1 rounded-lg">
          Spieltag {match.matchday}
        </div>
        <div className="text-xs text-gray-500">{dateStr}</div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 text-right text-sm font-semibold text-gray-900">
          {match.home_team?.short_name ?? match.home_team?.name ?? '?'}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min="0"
            max="20"
            value={score.home}
            onChange={(e) => onChange('home', e.target.value)}
            className="w-12 text-center py-2 border border-gray-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="0"
          />
          <span className="text-gray-400 font-bold">:</span>
          <input
            type="number"
            min="0"
            max="20"
            value={score.away}
            onChange={(e) => onChange('away', e.target.value)}
            className="w-12 text-center py-2 border border-gray-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="0"
          />
        </div>
        <div className="flex-1 text-left text-sm font-semibold text-gray-900">
          {match.away_team?.short_name ?? match.away_team?.name ?? '?'}
        </div>
      </div>

      <button
        onClick={onSettle}
        disabled={loading || score.home === '' || score.away === ''}
        className="w-full py-2 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
            Abrechnen...
          </>
        ) : (
          'Ergebnis eintragen & abrechnen'
        )}
      </button>
    </div>
  )
}

function MatchRow({ match }: { match: MatchRow }) {
  const matchDate = new Date(match.match_date)
  const dateStr = matchDate.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
  const timeStr = matchDate.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm px-4 py-3 flex items-center gap-3 ${
        match.status === 'finished' ? 'border-gray-100 opacity-70' : 'border-gray-100'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">ST {match.matchday}</span>
          <span className="text-xs text-gray-300">·</span>
          <span className="text-xs text-gray-400">
            {dateStr} {timeStr}
          </span>
        </div>
        <div className="text-sm font-semibold text-gray-900 mt-0.5">
          {match.home_team?.short_name ?? '?'} –{' '}
          {match.away_team?.short_name ?? '?'}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        {match.status === 'finished' && match.home_score !== null ? (
          <span className="inline-block bg-gray-800 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
            {match.home_score}:{match.away_score}
          </span>
        ) : (
          <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-lg">
            Geplant
          </span>
        )}
      </div>
    </div>
  )
}
