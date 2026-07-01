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
  match_category: string | null
}

interface AdminUser {
  id: string
  username: string
  display_name: string | null
  balance: number
  eligible_for_current_season: boolean
  is_admin: boolean
  is_wildenroth: boolean
}

type Tab = 'spieltag' | 'quoten' | 'verwaltung'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('spieltag')
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [scores, setScores] = useState<Record<number, { home: string; away: string }>>({})
  const [loading, setLoading] = useState(false)
  const [settleLoading, setSettleLoading] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [seasonResetLoading, setSeasonResetLoading] = useState(false)
  const [oddsLoading, setOddsLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<OddsPreviewResponse | null>(null)
  const [previewMd, setPreviewMd] = useState<number | null>(null)
  const [playerSuggestions, setPlayerSuggestions] = useState<string[]>([])
  const [seasonStarted, setSeasonStarted] = useState(false)
  const [seasonToggleLoading, setSeasonToggleLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [eligBalance, setEligBalance] = useState<Record<string, string>>({})
  const [pendingBetsByMatch, setPendingBetsByMatch] = useState<Record<number, number>>({})

  const supabase = createClient()

  const fetchSeasonData = useCallback(async () => {
    const [{ data: setting }, { data: profs }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'season_started').single(),
      supabase.from('profiles').select('id, username, display_name, balance, eligible_for_current_season, is_admin, is_wildenroth').order('username'),
    ])
    setSeasonStarted(setting?.value === 'true')
    setUsers((profs ?? []) as AdminUser[])
  }, [supabase])

  const fetchPendingCounts = useCallback(async () => {
    const { data } = await supabase.from('bets').select('match_id').eq('status', 'pending')
    const counts: Record<number, number> = {}
    for (const b of (data ?? []) as { match_id: number | null }[]) {
      if (b.match_id != null) counts[b.match_id] = (counts[b.match_id] ?? 0) + 1
    }
    setPendingBetsByMatch(counts)
  }, [supabase])

  useEffect(() => { fetchSeasonData(); fetchPendingCounts() }, [fetchSeasonData, fetchPendingCounts])

  async function toggleSeasonStarted(value: boolean) {
    setSeasonToggleLoading(true)
    setMessage(null)
    const res = await fetch('/api/admin/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_season_started', value }),
    })
    setSeasonToggleLoading(false)
    if (res.ok) { setSeasonStarted(value); setMessage(value ? 'Saison als gestartet markiert.' : 'Saisonstart-Flag entfernt.') }
    else { const d = await res.json(); setMessage(`Fehler: ${d.error}`) }
  }

  async function setUserEligible(userId: string, eligible: boolean, balance?: number) {
    setMessage(null)
    const res = await fetch('/api/admin/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_user_eligible', userId, eligible, balance }),
    })
    if (res.ok) { setMessage('Spieler aktualisiert.'); fetchSeasonData() }
    else { const d = await res.json(); setMessage(`Fehler: ${d.error}`) }
  }

  async function toggleUserWildenroth(userId: string, value: boolean) {
    setMessage(null)
    const res = await fetch('/api/admin/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_user_wildenroth', userId, value }),
    })
    if (res.ok) { setMessage('Wildenroth-Flag aktualisiert.'); fetchSeasonData() }
    else { const d = await res.json(); setMessage(`Fehler: ${d.error}`) }
  }

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('matches')
      .select(
        `id, match_number, matchday, match_date, status, home_score, away_score, match_category,
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

  useEffect(() => {
    fetchMatches()
  }, [fetchMatches])

  useEffect(() => {
    supabase.from('league_players').select('name').then(({ data }) => {
      if (data) setPlayerSuggestions([...new Set(data.map((p: { name: string }) => p.name))])
    })
  }, [supabase])

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

  async function postponeMatch(matchId: number) {
    setMessage(null)
    const res = await fetch('/api/admin/match-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, action: 'postpone' }),
    })
    if (res.ok) {
      setMessage('Spiel als verschoben markiert.')
      fetchMatches()
    } else {
      const d = await res.json()
      setMessage(`Fehler: ${d.error}`)
    }
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

  async function handleCategoryChange(matchId: number, category: string) {
    const supabaseClient = createClient()
    await supabaseClient
      .from('matches')
      .update({ match_category: category || null })
      .eq('id', matchId)
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, match_category: category || null } : m))
  }

  async function recalculateOdds() {
    setOddsLoading(true)
    setMessage(null)
    const res = await fetch('/api/admin/odds', { method: 'POST' })
    const data = await res.json()
    setOddsLoading(false)
    if (res.ok) {
      const frozenNote = data.skippedFrozen > 0 ? ` (${data.skippedFrozen} bereits eingefroren, übersprungen)` : ''
      setMessage(`Quoten berechnet: ${data.updated}/${data.total} Spiele aktualisiert.${frozenNote}`)
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  async function resetSeasonBalances() {
    if (!confirm('Alle Guthaben auf 1.000 Wildis zurücksetzen? Das kann nicht rückgängig gemacht werden.')) return
    setSeasonResetLoading(true)
    setMessage(null)
    const res = await fetch('/api/admin/season-reset', { method: 'POST' })
    const data = await res.json()
    setSeasonResetLoading(false)
    if (res.ok) {
      setMessage('Alle Guthaben wurden auf 1.000 Wildis zurückgesetzt.')
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  const loadPreview = useCallback(async (matchday?: number | null) => {
    setPreviewLoading(true)
    const qs = matchday != null ? `?matchday=${matchday}` : ''
    const res = await fetch(`/api/admin/odds/preview${qs}`)
    const data: OddsPreviewResponse | { error: string } = await res.json()
    setPreviewLoading(false)
    if (res.ok && 'matchday' in data) {
      setPreview(data)
      if (data.matchday != null) setPreviewMd(data.matchday)
    } else if ('error' in data) {
      setMessage(`Fehler: ${data.error}`)
    }
  }, [])

  useEffect(() => {
    if (tab === 'quoten' && !preview) loadPreview()
  }, [tab, preview, loadPreview])

  const settledMatches = matches.filter((m) => m.status === 'finished')
  // Past scheduled games awaiting result entry
  const pendingMatches = matches.filter(
    (m) => m.status === 'scheduled' && new Date(m.match_date) <= new Date()
  )
  // Future games — shown read-only, but with optional early result entry for rescheduled games
  const upcomingMatches = matches.filter(
    (m) => m.status === 'scheduled' && new Date(m.match_date) > new Date()
  )
  // Postponed games — awaiting reschedule
  const postponedMatches = matches.filter((m) => m.status === 'postponed')

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
          {(['spieltag', 'quoten', 'verwaltung'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                tab === t ? 'bg-red-700 text-white shadow' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'spieltag' ? 'Spieltag' : t === 'quoten' ? 'Quoten' : 'Verwaltung'}
            </button>
          ))}
        </div>

        {/* Spieltag Tab */}
        {tab === 'spieltag' && (
          <div className="space-y-4">
            {/* Status overview */}
            {(() => {
              const noResult = matches.filter(m => m.status !== 'finished' && m.status !== 'postponed' && new Date(m.match_date) <= new Date())
              const unsettled = matches.filter(m => m.home_score != null && m.away_score != null && m.status !== 'finished')
              const openBets = Object.values(pendingBetsByMatch).reduce((a, b) => a + b, 0)
              return (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-3 text-center">
                    <div className="text-2xl font-black text-red-600">{noResult.length}</div>
                    <div className="text-[10px] text-red-700 font-semibold mt-0.5 leading-tight">Spiele ohne Ergebnis</div>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-3 text-center">
                    <div className="text-2xl font-black text-orange-600">{unsettled.length}</div>
                    <div className="text-[10px] text-orange-700 font-semibold mt-0.5 leading-tight">Spiele nicht settled</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 text-center">
                    <div className="text-2xl font-black text-blue-600">{openBets}</div>
                    <div className="text-[10px] text-blue-700 font-semibold mt-0.5 leading-tight">offene Wetten</div>
                  </div>
                </div>
              )
            })()}

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
                      onPostpone={() => postponeMatch(match.id)}
                      loading={settleLoading === match.id}
                      pendingBets={pendingBetsByMatch[match.id]}
                      onCategoryChange={handleCategoryChange}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Postponed — shown above upcoming so it's immediately visible */}
            {postponedMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Verschobene Spiele ({postponedMatches.length})
                </h2>
                <p className="text-xs text-gray-400 mb-2">
                  Sobald ein neuer Termin feststeht, Datum aktualisieren → Spiel wird wieder als &quot;Geplant&quot; geführt.
                </p>
                <div className="space-y-2">
                  {postponedMatches.map((match) => (
                    <PostponedMatchCard
                      key={match.id}
                      match={match}
                      onRescheduled={fetchMatches}
                      onMessage={setMessage}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming matches — also allow early settle for rescheduled games */}
            {upcomingMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Bevorstehende Spiele ({upcomingMatches.length})
                </h2>
                <p className="text-xs text-gray-400 mb-2">
                  Verlegt? Ergebnis kann auch vorab eingetragen werden.
                </p>
                <div className="space-y-2">
                  {upcomingMatches.map((match) => (
                    <MatchSettleCard
                      key={match.id}
                      match={match}
                      score={scores[match.id] ?? { home: '', away: '' }}
                      onChange={(side, val) => handleScoreChange(match.id, side, val)}
                      onSettle={() => settleMatch(match.id)}
                      onPostpone={() => postponeMatch(match.id)}
                      loading={settleLoading === match.id}
                      isUpcoming
                      pendingBets={pendingBetsByMatch[match.id]}
                      onCategoryChange={handleCategoryChange}
                    />
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
                    <MatchRow key={match.id} match={match} playerSuggestions={playerSuggestions} />
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="text-center py-8 text-gray-400">Lade Spiele...</div>
            )}

            {/* Tipps — accordion */}
            <TippsAccordion matches={matches} />
          </div>
        )}

        {/* Quoten & Torschützen Tab */}
        {tab === 'quoten' && (
          <div className="space-y-6">
            {/* Odds section */}
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Quoten</h2>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="font-bold text-gray-900 mb-1">Quoten neu berechnen</h3>
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

              <OddsPreviewSection
                preview={preview}
                loading={previewLoading}
                selectedMd={previewMd}
                onSelectMd={(md) => { setPreviewMd(md); loadPreview(md) }}
                onReload={() => loadPreview(previewMd)}
              />
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200" />

            {/* Goalscorers section */}
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Torschützen</h2>
              <GoalscorersTab matches={matches} onMessage={setMessage} />
            </div>
          </div>
        )}

        {/* Verwaltung Tab */}
        {tab === 'verwaltung' && (
          <div className="space-y-4">

            {/* Spieler */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-900 mb-1">Spieler</h3>
              <p className="text-sm text-gray-500 mb-3">
                Saison-Berechtigung und Wildenroth-Flag verwalten.
              </p>
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 flex-wrap bg-gray-50 rounded-xl px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1 flex-wrap">
                        {u.display_name || u.username}
                        {u.is_admin && <span className="text-[10px] text-red-600 font-bold">ADMIN</span>}
                        {u.is_wildenroth && <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-1 rounded">⚽</span>}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {u.balance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} Wildis · {u.eligible_for_current_season ? <span className="text-green-600">berechtigt</span> : <span className="text-amber-600">nicht berechtigt</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleUserWildenroth(u.id, !u.is_wildenroth)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-bold border ${u.is_wildenroth ? 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-100'}`}
                      title="Wildenroth-Spieler/Trainer"
                    >
                      ⚽
                    </button>
                    <input
                      type="number"
                      placeholder="Guthaben"
                      value={eligBalance[u.id] ?? ''}
                      onChange={(e) => setEligBalance(prev => ({ ...prev, [u.id]: e.target.value }))}
                      className="w-24 text-sm py-1.5 px-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <button
                      onClick={() => {
                        const raw = eligBalance[u.id]
                        const bal = raw != null && raw !== '' ? parseFloat(raw) : undefined
                        setUserEligible(u.id, !u.eligible_for_current_season, bal)
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white ${u.eligible_for_current_season ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'}`}
                    >
                      {u.eligible_for_current_season ? 'Sperren' : 'Freischalten'}
                    </button>
                  </div>
                ))}
                {users.length === 0 && <div className="text-sm text-gray-400 text-center py-4">Keine Spieler geladen.</div>}
              </div>
            </div>

            {/* Saison */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-900 mb-3">Saison</h3>
              {/* Start-Flag */}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 mb-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Saisonstart</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {seasonStarted ? <span className="text-green-600 font-medium">Gestartet</span> : <span className="text-gray-400">Nicht gestartet</span>}
                    {' '}· neue Nutzer brauchen manuelle Freischaltung
                  </div>
                </div>
                <button
                  onClick={() => toggleSeasonStarted(!seasonStarted)}
                  disabled={seasonToggleLoading}
                  className={`px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${seasonStarted ? 'bg-gray-500 hover:bg-gray-600' : 'bg-red-700 hover:bg-red-800'}`}
                >
                  {seasonStarted ? 'Flag entfernen' : 'Saison starten'}
                </button>
              </div>
              {/* Reset — danger zone */}
              <details className="group">
                <summary className="cursor-pointer text-xs font-semibold text-gray-400 hover:text-red-600 select-none list-none flex items-center gap-1">
                  <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                  Neue Saison (Guthaben reset)
                </summary>
                <div className="mt-3 border border-red-200 rounded-xl p-4 bg-red-50">
                  <p className="text-xs text-red-700 mb-3">
                    Setzt <strong>alle Guthaben auf 1.000 Wildis</strong> zurück. Bisherige Wetten bleiben als Saison 25/26 erhalten.
                  </p>
                  <button
                    onClick={resetSeasonBalances}
                    disabled={seasonResetLoading}
                    className="w-full py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-bold rounded-lg transition-colors text-sm"
                  >
                    {seasonResetLoading ? 'Wird zurückgesetzt…' : 'Alle Guthaben auf 1.000 Wildis zurücksetzen'}
                  </button>
                </div>
              </details>
            </div>

            {/* Push — kompakt */}
            <AdminPushTab />

            {/* Test-Spieltag */}
            <TestMatchdayPanel />

          </div>
        )}
      </div>
    </div>
  )
}

function TippsAccordion({ matches }: { matches: MatchRow[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-bold text-gray-900 text-sm">Tipps anzeigen</span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-50">
          <AdminBetsTab matches={matches} />
        </div>
      )}
    </div>
  )
}

function AdminPushTab() {
  const [stats, setStats] = useState<{
    totalEligibleUsers: number
    usersWithPushEnabled: number
    activeSubscriptions: number
    enablementRate: string | number
    recentErrors: Array<{ category: string; title: string; error_message: string | null }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [testLoading, setTestLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    setLoading(true)
    const res = await fetch('/api/push/test')
    if (res.ok) {
      const data = await res.json()
      setStats(data.pushOverview)
    }
    setLoading(false)
  }

  async function sendTestToMe() {
    setTestLoading(true)
    const res = await fetch('/api/push/test', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    setTestLoading(false)

    if (res.ok) {
      setMessage('✓ Test-Push gesendet')
      setTimeout(() => setMessage(null), 3000)
    } else {
      const err = await res.json()
      setMessage(`✗ ${err.error}`)
    }
  }

  if (loading) return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-bold text-gray-900 mb-3">Push-Benachrichtigungen</h3>
      <div className="text-center py-4 text-gray-400 text-sm">Lade…</div>
    </div>
  )

  if (!stats) return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-bold text-gray-900 mb-1">Push-Benachrichtigungen</h3>
      <div className="text-red-600 text-sm">Fehler beim Laden</div>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-bold text-gray-900 mb-3">Push-Benachrichtigungen</h3>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-center">
          <div className="text-xl font-black text-blue-600">{stats.usersWithPushEnabled}</div>
          <div className="text-[10px] text-blue-700 font-semibold leading-tight">Push aktiv</div>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2 text-center">
          <div className="text-xl font-black text-green-600">{stats.activeSubscriptions}</div>
          <div className="text-[10px] text-green-700 font-semibold leading-tight">Subscriptions</div>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 text-center">
          <div className="text-xl font-black text-purple-600">
            {typeof stats.enablementRate === 'string' ? stats.enablementRate : stats.enablementRate.toFixed(0)}%
          </div>
          <div className="text-[10px] text-purple-700 font-semibold leading-tight">Aktiviert</div>
        </div>
      </div>

      <button
        onClick={sendTestToMe}
        disabled={testLoading}
        className="w-full py-2 px-3 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
      >
        {testLoading ? '🧪 Wird gesendet…' : '🧪 Test-Push an mich'}
      </button>

      {message && (
        <div className="mt-2 px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg">{message}</div>
      )}

      {stats.recentErrors && stats.recentErrors.length > 0 && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="text-xs font-semibold text-red-700 mb-1">⚠️ Letzte Fehler</div>
          <div className="space-y-1 text-[11px] text-red-600">
            {stats.recentErrors.slice(0, 3).map((err, i) => (
              <div key={i} className="line-clamp-1">
                <strong>{err.title}:</strong> {err.error_message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[11px] text-gray-500">
        <strong>Scheduler:</strong> GitHub Actions läuft alle 30 Min (:07 und :37) — Haupt-Scheduler. Vercel Cron (täglich 08:00 UTC) ist nur Fallback.
      </div>
    </div>
  )
}

const MARKET_LABELS: Record<string, string> = {
  '1x2': '1X2', double_chance: 'Dopp. Chance', over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5', over_under_5_5: 'Ü/U 5,5', over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen', exact_score: 'Ergebnis', handicap: 'Handicap',
  goalscorer: 'Torschütze', goalscorer_2plus: 'Mind. 2 Tore',
}

interface OddsValues {
  home_win: number; draw: number; away_win: number
  odds_1x: number; odds_x2: number; odds_12: number
  over_2_5: number; under_2_5: number
  over_3_5: number; under_3_5: number
  over_5_5: number; under_5_5: number
  over_7_5: number; under_7_5: number
  btts_yes: number; btts_no: number
  hdp_home_minus_1_5: number; hdp_away_plus_1_5: number
  hdp_home_minus_2_5: number; hdp_away_plus_2_5: number
}

interface OddsPreviewMatch {
  match_id: number
  match_number: number
  match_date: string
  status: string
  home_team: string
  away_team: string
  frozen_at: string | null
  odds: OddsValues
  exact_scores: { score: string; odds: number }[]
}

interface OddsPreviewResponse {
  matchday: number | null
  matchdays: number[]
  matches: OddsPreviewMatch[]
  bettingOpensAt: string | null
  isBettingOpen: boolean
}

function fmt(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

type OverrideRow = { match_id: number } & Record<string, number | null>

function OddsPreviewSection({
  preview, loading, selectedMd, onSelectMd, onReload,
}: {
  preview: OddsPreviewResponse | null
  loading: boolean
  selectedMd: number | null
  onSelectMd: (md: number) => void
  onReload: () => void
}) {
  const [overrides, setOverrides] = useState<Record<number, OverrideRow>>({})
  const [overrideMsg, setOverrideMsg] = useState<string | null>(null)

  const matchday = selectedMd ?? preview?.matchday

  // Load overrides when matchday changes
  useEffect(() => {
    if (!matchday) return
    fetch(`/api/admin/odds/overrides?matchday=${matchday}`)
      .then(r => r.json())
      .then(data => {
        const map: Record<number, OverrideRow> = {}
        for (const ov of data.overrides ?? []) map[ov.match_id] = ov
        setOverrides(map)
      })
  }, [matchday])

  async function saveOverride(matchId: number, values: Record<string, number | null>) {
    const res = await fetch('/api/admin/odds/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, values }),
    })
    const data = await res.json()
    if (res.ok) {
      setOverrides(prev => ({ ...prev, [matchId]: { match_id: matchId, ...values } }))
      setOverrideMsg('Überschreibung gespeichert.')
      onReload()
    } else {
      setOverrideMsg(`Fehler: ${data.error}`)
    }
  }

  async function resetOverride(matchId: number) {
    const res = await fetch('/api/admin/odds/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, reset: true }),
    })
    if (res.ok) {
      setOverrides(prev => { const n = { ...prev }; delete n[matchId]; return n })
      setOverrideMsg('Überschreibung zurückgesetzt.')
      onReload()
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-gray-900">Quoten-Vorschau</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Berechnete Quoten · gelb = manuell überschrieben
          </p>
        </div>
        <button
          onClick={onReload}
          disabled={loading}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {loading ? '…' : 'Neu laden'}
        </button>
      </div>

      {overrideMsg && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
          <span className="flex-1">{overrideMsg}</span>
          <button onClick={() => setOverrideMsg(null)}>✕</button>
        </div>
      )}

      {preview?.matchdays && preview.matchdays.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {preview.matchdays.map((md) => (
            <button
              key={md}
              onClick={() => onSelectMd(md)}
              className={`text-xs px-2.5 py-1 rounded-lg border ${
                (selectedMd ?? preview.matchday) === md
                  ? 'bg-red-700 text-white border-red-700'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              ST {md}
            </button>
          ))}
        </div>
      )}

      {loading && !preview && (
        <div className="text-sm text-gray-500 py-4 text-center">Lade Vorschau…</div>
      )}

      {preview && preview.matches.length === 0 && (
        <div className="text-sm text-gray-500 py-4 text-center">
          Kein Spieltag mit geplanten Spielen gefunden.
        </div>
      )}

      {preview && preview.matches.length > 0 && (
        <>
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <div className="font-semibold mb-0.5">
              Spieltag {preview.matchday}
              {preview.matches.every((m) => m.frozen_at)
                ? ' · bereits eingefroren'
                : preview.isBettingOpen
                ? ' · Wettfenster offen, noch nicht eingefroren'
                : ' · noch nicht freigeschaltet'}
            </div>
            {preview.bettingOpensAt && (
              <div>
                Geplante Freischaltung:{' '}
                {new Date(preview.bettingOpensAt).toLocaleString('de-DE', {
                  timeZone: 'Europe/Berlin',
                  weekday: 'short',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                Uhr
              </div>
            )}
          </div>

          <div className="space-y-3">
            {preview.matches.map((m) => (
              <OddsPreviewMatchCard
                key={m.match_id}
                match={m}
                override={overrides[m.match_id] ?? null}
                onSave={(values) => saveOverride(m.match_id, values)}
                onReset={() => resetOverride(m.match_id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const OVERRIDE_FIELDS: { col: string; label: string }[][] = [
  [
    { col: 'home_win', label: '1' }, { col: 'draw', label: 'X' }, { col: 'away_win', label: '2' },
  ],
  [
    { col: 'odds_1x', label: '1X' }, { col: 'odds_12', label: '12' }, { col: 'odds_x2', label: 'X2' },
  ],
  [
    { col: 'over_2_5', label: 'Ü2,5' }, { col: 'under_2_5', label: 'U2,5' },
    { col: 'over_3_5', label: 'Ü3,5' }, { col: 'under_3_5', label: 'U3,5' },
  ],
  [
    { col: 'over_5_5', label: 'Ü5,5' }, { col: 'under_5_5', label: 'U5,5' },
    { col: 'over_7_5', label: 'Ü7,5' }, { col: 'under_7_5', label: 'U7,5' },
  ],
  [
    { col: 'btts_yes', label: 'BTTS Ja' }, { col: 'btts_no', label: 'BTTS Nein' },
  ],
  [
    { col: 'hdp_home_minus_1_5', label: 'H-1,5' }, { col: 'hdp_away_plus_1_5', label: 'G+1,5' },
    { col: 'hdp_home_minus_2_5', label: 'H-2,5' }, { col: 'hdp_away_plus_2_5', label: 'G+2,5' },
  ],
]

function OddsPreviewMatchCard({
  match, override, onSave, onReset,
}: {
  match: OddsPreviewMatch
  override: OverrideRow | null
  onSave: (values: Record<string, number | null>) => Promise<void>
  onReset: () => Promise<void>
}) {
  const o = match.odds
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const allFields = OVERRIDE_FIELDS.flat()
  const initDraft = () => Object.fromEntries(
    allFields.map(f => [f.col, override?.[f.col] != null ? String(override[f.col]) : ''])
  )
  const [draft, setDraft] = useState<Record<string, string>>(initDraft)

  const hasOverride = override != null && allFields.some(f => override[f.col] != null)

  function openEdit() {
    setDraft(initDraft())
    setEditing(true)
  }

  async function handleSave() {
    const values: Record<string, number | null> = {}
    for (const { col } of allFields) {
      const raw = draft[col].trim().replace(',', '.')
      if (raw === '') {
        values[col] = null
      } else {
        const n = parseFloat(raw)
        if (isNaN(n) || n <= 1.0 || n > 999) {
          alert(`Ungültiger Wert für ${col}: muss >1,00 sein.`)
          return
        }
        values[col] = n
      }
    }
    setSaving(true)
    await onSave(values)
    setSaving(false)
    setEditing(false)
  }

  async function handleReset() {
    if (!confirm('Alle Überschreibungen für dieses Spiel zurücksetzen?')) return
    setSaving(true)
    await onReset()
    setSaving(false)
    setEditing(false)
  }

  function isOverridden(col: string): boolean {
    return override?.[col] != null
  }

  function displayOdds(col: string, autoVal: number): string {
    const ov = override?.[col]
    return ov != null ? fmt(Number(ov)) : fmt(autoVal)
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${hasOverride ? 'border-amber-300' : 'border-gray-100'}`}>
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-2">
        <div className="text-sm font-semibold text-gray-800 flex-1 min-w-0 truncate">
          {match.home_team} – {match.away_team}
        </div>
        {hasOverride && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">
            Überschrieben
          </span>
        )}
        <div className="text-[10px] text-gray-500 flex-shrink-0">
          {new Date(match.match_date).toLocaleString('de-DE', {
            timeZone: 'Europe/Berlin',
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          })}
          {match.frozen_at && <span className="ml-1 text-amber-700 font-semibold">· eingefroren</span>}
        </div>
        <button
          onClick={editing ? () => setEditing(false) : openEdit}
          className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 flex-shrink-0"
        >
          {editing ? 'Schließen' : 'Bearbeiten'}
        </button>
      </div>

      {/* Override edit form */}
      {editing && (
        <div className="px-3 py-3 bg-amber-50 border-b border-amber-200 space-y-2">
          <div className="text-xs font-semibold text-amber-800 mb-1">
            Manuelle Quoten-Überschreibung · leer lassen = Auto-Quote
          </div>
          {OVERRIDE_FIELDS.map((group, gi) => (
            <div key={gi} className="flex flex-wrap gap-2">
              {group.map(({ col, label }) => (
                <div key={col} className="flex items-center gap-1">
                  <span className={`text-[10px] font-medium w-12 text-right ${isOverridden(col) ? 'text-amber-700' : 'text-gray-500'}`}>
                    {label}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft[col]}
                    placeholder={fmt(o[col as keyof OddsValues])}
                    onChange={e => setDraft(prev => ({ ...prev, [col]: e.target.value }))}
                    className={`w-16 text-center text-xs py-1 border rounded focus:outline-none focus:ring-1 focus:ring-amber-400 ${
                      draft[col] ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'
                    }`}
                  />
                </div>
              ))}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {saving ? 'Speichern…' : 'Speichern'}
            </button>
            {hasOverride && (
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
              >
                Zurücksetzen
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-3 space-y-2 text-xs">
        <OddsRow label="1X2" cells={[
          ['1', displayOdds('home_win', o.home_win), isOverridden('home_win')],
          ['X', displayOdds('draw', o.draw), isOverridden('draw')],
          ['2', displayOdds('away_win', o.away_win), isOverridden('away_win')],
        ]} />
        <OddsRow label="Dopp. Chance" cells={[
          ['1X', displayOdds('odds_1x', o.odds_1x), isOverridden('odds_1x')],
          ['12', displayOdds('odds_12', o.odds_12), isOverridden('odds_12')],
          ['X2', displayOdds('odds_x2', o.odds_x2), isOverridden('odds_x2')],
        ]} />
        <OddsRow label="Ü/U 2,5" cells={[
          ['Ü', displayOdds('over_2_5', o.over_2_5), isOverridden('over_2_5')],
          ['U', displayOdds('under_2_5', o.under_2_5), isOverridden('under_2_5')],
        ]} />
        <OddsRow label="Ü/U 3,5" cells={[
          ['Ü', displayOdds('over_3_5', o.over_3_5), isOverridden('over_3_5')],
          ['U', displayOdds('under_3_5', o.under_3_5), isOverridden('under_3_5')],
        ]} />
        <OddsRow label="Ü/U 5,5" cells={[
          ['Ü', displayOdds('over_5_5', o.over_5_5), isOverridden('over_5_5')],
          ['U', displayOdds('under_5_5', o.under_5_5), isOverridden('under_5_5')],
        ]} />
        <OddsRow label="Ü/U 7,5" cells={[
          ['Ü', displayOdds('over_7_5', o.over_7_5), isOverridden('over_7_5')],
          ['U', displayOdds('under_7_5', o.under_7_5), isOverridden('under_7_5')],
        ]} />
        <OddsRow label="BTTS" cells={[
          ['Ja', displayOdds('btts_yes', o.btts_yes), isOverridden('btts_yes')],
          ['Nein', displayOdds('btts_no', o.btts_no), isOverridden('btts_no')],
        ]} />
        <OddsRow label="Handicap" cells={[
          ['H -1,5', displayOdds('hdp_home_minus_1_5', o.hdp_home_minus_1_5), isOverridden('hdp_home_minus_1_5')],
          ['G +1,5', displayOdds('hdp_away_plus_1_5', o.hdp_away_plus_1_5), isOverridden('hdp_away_plus_1_5')],
          ['H -2,5', displayOdds('hdp_home_minus_2_5', o.hdp_home_minus_2_5), isOverridden('hdp_home_minus_2_5')],
          ['G +2,5', displayOdds('hdp_away_plus_2_5', o.hdp_away_plus_2_5), isOverridden('hdp_away_plus_2_5')],
        ]} />
        {match.exact_scores.length > 0 && (
          <div className="pt-1">
            <div className="text-gray-400 font-medium mb-1">Top Ergebnisse</div>
            <div className="grid grid-cols-4 gap-1">
              {match.exact_scores.map(({ score, odds }) => (
                <div key={score} className="bg-gray-50 rounded px-1.5 py-1 flex items-center justify-between">
                  <span className="font-semibold text-gray-700">{score}</span>
                  <span className="text-red-700 font-bold">{fmt(odds)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OddsRow({ label, cells }: { label: string; cells: [string, string, boolean?][] }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 text-gray-500 flex-shrink-0">{label}</div>
      <div className="flex-1 flex gap-1.5 flex-wrap">
        {cells.map(([k, v, overridden]) => (
          <div key={k} className={`flex items-center gap-1 rounded px-2 py-0.5 border ${overridden ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}>
            <span className="text-gray-500">{k}</span>
            <span className={`font-bold ${overridden ? 'text-amber-700' : 'text-red-700'}`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const SELECTION_LABELS: Record<string, string> = {
  home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg',
  '1x': '1X', x2: 'X2', '12': '12',
  'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5',
  'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5',
  'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5',
  'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5',
  yes: 'Beide treffen', no: 'Nicht beide',
  home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5',
  home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5',
}

function selLabel(marketType: string, selection: string, players?: Record<number, string>): string {
  if (marketType === 'exact_score') return selection
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(selection, 10)
    const name = players?.[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (mind. 2 Tore)` : name
  }
  return SELECTION_LABELS[selection] ?? selection
}

function AdminBetsTab({ matches }: { matches: MatchRow[] }) {
  const allMatchdays = [...new Set(matches.map(m => m.matchday))].sort((a, b) => a - b)
  const firstScheduled = matches.find(m => m.status === 'scheduled')?.matchday
  const [selectedMd, setSelectedMd] = useState<number>(firstScheduled ?? allMatchdays[allMatchdays.length - 1] ?? 1)
  const [bets, setBets] = useState<{ id: string; user_id: string; match_id: number; market_type: string; selection: string; odds_value: number; status: string; combo_id: string | null; is_risky: boolean; stake: number | null }[]>([])
  const [profiles, setProfiles] = useState<{ id: string; display_name: string | null; username: string }[]>([])
  const [matchMap, setMatchMap] = useState<Record<number, { home: string; away: string }>>({})
  const [playerMap, setPlayerMap] = useState<Record<number, string>>({})
  const [comboMap, setComboMap] = useState<Record<number, { stake: number; total_odds: number; status: string; payout: number | null }>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/bets?matchday=${selectedMd}`)
      .then(r => r.json())
      .then(data => {
        setBets(data.bets ?? []); setProfiles(data.profiles ?? [])
        setMatchMap(data.matchMap ?? {}); setPlayerMap(data.playerNameMap ?? {})
        setComboMap(data.comboMap ?? {})
      })
      .finally(() => setLoading(false))
  }, [selectedMd])

  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p.display_name || p.username]))
  const byUser = profiles.map(p => ({
    profile: p,
    bets: bets.filter(b => b.user_id === p.id),
  }))

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {allMatchdays.map(md => (
          <button key={md} onClick={() => setSelectedMd(md)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              md === selectedMd ? 'bg-red-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300'
            }`}>
            ST {md}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Lade Tipps…</div>}

      {!loading && byUser.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">Keine Tipps für Spieltag {selectedMd}</div>
      )}

      {!loading && byUser.map(({ profile, bets: userBets }) => {
        if (userBets.length === 0) return null
        const shownCombos = new Set<string>()
        return (
          <div key={profile.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-700 font-bold text-xs flex-shrink-0">
                {(profile.display_name || profile.username)[0].toUpperCase()}
              </span>
              <span className="font-semibold text-sm text-gray-900">{profileMap[profile.id]}</span>
              <span className="ml-auto text-xs text-gray-400">{userBets.filter(b => !b.combo_id).length} Einzel · {new Set(userBets.filter(b => b.combo_id).map(b => b.combo_id)).size} Kombi</span>
            </div>
            <div className="divide-y divide-gray-50">
              {userBets.map(bet => {
                if (bet.combo_id) {
                  if (shownCombos.has(bet.combo_id)) return null
                  shownCombos.add(bet.combo_id)
                  const legs = userBets.filter(b => b.combo_id === bet.combo_id)
                  const comboOdds = legs.reduce((acc, l) => acc * l.odds_value, 1)
                  // Compute effective combo status from legs — same logic as the app
                  const effectiveComboStatus =
                    legs.some(l => l.status === 'lost') ? 'lost' :
                    legs.every(l => l.status === 'won') ? 'won' :
                    'pending'
                  return (
                    <div key={bet.combo_id} className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                          {bet.is_risky ? '🎲 RISKY' : '🔗 KOMBI'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {legs.length} Tipps · @{comboOdds.toFixed(2).replace('.', ',')}
                          {comboMap[Number(bet.combo_id)]?.stake != null && ` · ${comboMap[Number(bet.combo_id)].stake} Wildis`}
                        </span>
                        <StatusChip status={effectiveComboStatus} />
                      </div>
                      {legs.map(leg => (
                        <div key={leg.id} className="flex items-center gap-1.5 text-xs text-gray-600 py-0.5 pl-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${leg.status === 'won' ? 'bg-green-500' : leg.status === 'lost' ? 'bg-red-500' : 'bg-yellow-400'}`} />
                          <span className="text-gray-400 text-[10px]">{matchMap[leg.match_id]?.home}–{matchMap[leg.match_id]?.away}</span>
                          <span className="bg-gray-100 text-gray-600 px-1 rounded text-[10px]">{MARKET_LABELS[leg.market_type] ?? leg.market_type}</span>
                          <span className="font-medium text-gray-800">{selLabel(leg.market_type, leg.selection, playerMap)}</span>
                          <span className="text-red-600 font-bold ml-auto">@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                        </div>
                      ))}
                    </div>
                  )
                }
                return (
                  <div key={bet.id} className="px-4 py-2.5 flex items-center gap-2 text-xs">
                    <span className="text-gray-400">{matchMap[bet.match_id]?.home}–{matchMap[bet.match_id]?.away}</span>
                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px]">{MARKET_LABELS[bet.market_type] ?? bet.market_type}</span>
                    <span className="font-medium text-gray-800">{selLabel(bet.market_type, bet.selection, playerMap)}</span>
                    {bet.is_risky && <span className="text-[10px] font-bold text-purple-700">🎲</span>}
                    <span className="text-red-600 font-bold ml-auto">@{bet.odds_value.toFixed(2).replace('.', ',')}</span>
                    <span className="text-gray-400">{bet.stake != null ? `${bet.stake} Wildis` : ''}</span>
                    <StatusChip status={bet.status} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      status === 'won' ? 'bg-green-100 text-green-700' :
      status === 'lost' ? 'bg-red-100 text-red-600' : 'bg-yellow-50 text-yellow-700'
    }`}>
      {status === 'won' ? 'Gewonnen' : status === 'lost' ? 'Verloren' : 'Offen'}
    </span>
  )
}

function MatchSettleCard({
  match,
  score,
  onChange,
  onSettle,
  onPostpone,
  loading,
  isUpcoming,
  pendingBets,
  onCategoryChange,
}: {
  match: MatchRow
  score: { home: string; away: string }
  onChange: (side: 'home' | 'away', val: string) => void
  onSettle: () => void
  onPostpone?: () => void
  loading: boolean
  isUpcoming?: boolean
  pendingBets?: number
  onCategoryChange?: (matchId: number, category: string) => void
}) {
  const matchDate = new Date(match.match_date)
  const dateStr = matchDate.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })

  return (
    <div className={`bg-white rounded-xl border shadow-sm p-4 ${isUpcoming ? 'border-blue-200' : 'border-orange-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`text-xs font-medium px-2 py-1 rounded-lg ${isUpcoming ? 'text-blue-600 bg-blue-50' : 'text-orange-600 bg-orange-50'}`}>
          Spieltag {match.matchday}{isUpcoming ? ' · Verlegt?' : ''}
        </div>
        <div className="flex items-center gap-2">
          {pendingBets != null && pendingBets > 0 && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-50 text-blue-600">{pendingBets} offen</span>
          )}
          <div className="text-xs text-gray-500">{dateStr}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 text-right text-sm font-semibold text-gray-900">
          {match.home_team?.name ?? '?'}
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
          {match.away_team?.name ?? '?'}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSettle}
          disabled={loading || score.home === '' || score.away === ''}
          className="flex-1 py-2 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
              Abrechnen...
            </>
          ) : (
            'Ergebnis & abrechnen'
          )}
        </button>
        {onPostpone && (
          <button
            onClick={onPostpone}
            disabled={loading}
            className="py-2 px-3 bg-yellow-100 hover:bg-yellow-200 disabled:opacity-50 text-yellow-800 font-semibold rounded-lg transition-colors text-sm"
          >
            Verschoben
          </button>
        )}
      </div>
    </div>
  )
}

function PostponedMatchCard({
  match,
  onRescheduled,
  onMessage,
}: {
  match: MatchRow
  onRescheduled: () => void
  onMessage: (msg: string) => void
}) {
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [newMatchday, setNewMatchday] = useState(String(match.matchday))
  const [loading, setLoading] = useState(false)

  async function reschedule() {
    if (!newDate || !newTime) { onMessage('Bitte Datum und Uhrzeit angeben.'); return }
    const md = parseInt(newMatchday)
    if (isNaN(md) || md < 1) { onMessage('Ungültiger Spieltag.'); return }
    setLoading(true)
    // Build as local time (admin inputs local time, browser converts to UTC via toISOString)
    const isoDate = new Date(`${newDate}T${newTime}:00`).toISOString()
    const res = await fetch('/api/admin/match-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: match.id, action: 'reschedule', newDate: isoDate, matchday: md }),
    })
    setLoading(false)
    if (res.ok) {
      onMessage('Nachholtermin gespeichert — Spiel ist wieder als geplant geführt.')
      onRescheduled()
    } else {
      const d = await res.json()
      onMessage(`Fehler: ${d.error}`)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-yellow-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-yellow-100 text-yellow-800">
          Spieltag {match.matchday} · Verschoben
        </span>
      </div>
      <div className="text-sm font-semibold text-gray-900 mb-3">
        {match.home_team?.name ?? '?'} – {match.away_team?.name ?? '?'}
      </div>
      <p className="text-xs text-gray-500 mb-2">Neuen Termin eintragen:</p>
      <div className="flex gap-2 mb-2">
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-gray-500 flex-shrink-0">Spieltag:</label>
        <input
          type="number"
          min="1"
          value={newMatchday}
          onChange={(e) => setNewMatchday(e.target.value)}
          className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {parseInt(newMatchday) !== match.matchday && (
          <span className="text-xs text-amber-600 font-medium">⚡ Spieltag wird geändert</span>
        )}
      </div>
      <button
        onClick={reschedule}
        disabled={loading || !newDate || !newTime}
        className="w-full py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm"
      >
        {loading ? 'Speichern...' : 'Nachholtermin speichern'}
      </button>
    </div>
  )
}

function MatchRow({ match, playerSuggestions }: { match: MatchRow; playerSuggestions?: string[] }) {
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
  const [showLineups, setShowLineups] = useState(false)

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
        match.status === 'finished' ? 'border-gray-100' : 'border-gray-100'
      }`}
    >
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">ST {match.matchday}</span>
            <span className="text-xs text-gray-300">·</span>
            <span className="text-xs text-gray-400">
              {dateStr} {timeStr}
            </span>
          </div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5">
            {match.home_team?.name ?? '?'} –{' '}
            {match.away_team?.name ?? '?'}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {match.status === 'finished' && match.home_score !== null ? (
            <span className="inline-block bg-gray-800 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
              {match.home_score}:{match.away_score}
            </span>
          ) : (
            <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-lg">
              Geplant
            </span>
          )}
          {match.status === 'finished' && (
            <button
              onClick={() => setShowLineups(v => !v)}
              className="text-[10px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              {showLineups ? 'Aufstellung ▲' : 'Aufstellung ▼'}
            </button>
          )}
        </div>
      </div>
      {showLineups && match.status === 'finished' && (
        <LineupsSection
          matchId={match.id}
          homeTeam={match.home_team?.name ?? ''}
          awayTeam={match.away_team?.name ?? ''}
          playerSuggestions={playerSuggestions ?? []}
        />
      )}
    </div>
  )
}

type LineupEntryRow = {
  id: number
  match_id: number
  team_name: string
  player_name: string
  minutes_played: number
  goals: number
  assists: number
}

function LineupsSection({
  matchId,
  homeTeam,
  awayTeam,
  playerSuggestions,
}: {
  matchId: number
  homeTeam: string
  awayTeam: string
  playerSuggestions: string[]
}) {
  const [lineups, setLineups] = useState<LineupEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [addingTeam, setAddingTeam] = useState<string | null>(null)
  const [newPlayer, setNewPlayer] = useState('')
  const [newMinutes, setNewMinutes] = useState('90')
  const [newGoals, setNewGoals] = useState('0')
  const [newAssists, setNewAssists] = useState('0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const datalistId = `players-${matchId}`

  const reload = useCallback(async () => {
    const res = await fetch(`/api/admin/lineups?match_id=${matchId}`)
    const data = await res.json()
    setLoading(false)
    if (res.ok) setLineups(data.lineups ?? [])
  }, [matchId])

  useEffect(() => { reload() }, [reload])

  async function addEntry(teamName: string) {
    if (!newPlayer.trim()) return
    setSaving(true)
    setError(null)
    const res = await fetch('/api/admin/lineups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id: matchId,
        team_name: teamName,
        player_name: newPlayer.trim(),
        minutes_played: parseInt(newMinutes) || 90,
        goals: parseInt(newGoals) || 0,
        assists: parseInt(newAssists) || 0,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setNewPlayer(''); setNewMinutes('90'); setNewGoals('0'); setNewAssists('0')
      setAddingTeam(null)
      reload()
    } else {
      setError(data.error ?? 'Fehler')
    }
  }

  async function deleteEntry(id: number) {
    const res = await fetch(`/api/admin/lineups?id=${id}`, { method: 'DELETE' })
    if (res.ok) reload()
  }

  const homeLineup = lineups.filter(e => e.team_name === homeTeam)
  const awayLineup = lineups.filter(e => e.team_name === awayTeam)

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-3 py-3">
      <datalist id={datalistId}>
        {playerSuggestions.map(p => <option key={p} value={p} />)}
      </datalist>

      {loading && <div className="text-xs text-gray-400 py-2 text-center">Lade Aufstellung…</div>}
      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

      {!loading && (
        <div className="grid grid-cols-2 gap-3">
          {[{ team: homeTeam, entries: homeLineup }, { team: awayTeam, entries: awayLineup }].map(({ team, entries }) => (
            <div key={team}>
              <div className="text-[11px] font-bold text-gray-700 mb-1 truncate">{team}</div>
              <div className="space-y-1 mb-2">
                {entries.length === 0 && (
                  <div className="text-[10px] text-gray-400 italic">Keine Einträge</div>
                )}
                {entries.map(e => (
                  <div key={e.id} className="flex items-center gap-1 text-[10px] bg-white border border-gray-100 rounded px-1.5 py-1">
                    <span className="flex-1 font-medium text-gray-800 truncate">{e.player_name}</span>
                    <span className="text-gray-400">{e.minutes_played}&apos;</span>
                    {e.goals > 0 && <span className="text-green-700 font-bold">{e.goals}T</span>}
                    {e.assists > 0 && <span className="text-blue-600 font-bold">{e.assists}A</span>}
                    <button onClick={() => deleteEntry(e.id)} className="text-red-500 ml-1">✕</button>
                  </div>
                ))}
              </div>

              {addingTeam === team ? (
                <div className="space-y-1">
                  <input
                    list={datalistId}
                    value={newPlayer}
                    onChange={e => setNewPlayer(e.target.value)}
                    placeholder="Spielername"
                    className="w-full text-[11px] border border-gray-200 rounded px-2 py-1"
                  />
                  <div className="flex gap-1">
                    <input
                      type="number" min="0" max="120" value={newMinutes}
                      onChange={e => setNewMinutes(e.target.value)}
                      className="w-14 text-[11px] border border-gray-200 rounded px-1.5 py-1 text-center"
                      placeholder="Min"
                    />
                    <input
                      type="number" min="0" max="20" value={newGoals}
                      onChange={e => setNewGoals(e.target.value)}
                      className="w-10 text-[11px] border border-gray-200 rounded px-1.5 py-1 text-center"
                      placeholder="T"
                    />
                    <input
                      type="number" min="0" max="20" value={newAssists}
                      onChange={e => setNewAssists(e.target.value)}
                      className="w-10 text-[11px] border border-gray-200 rounded px-1.5 py-1 text-center"
                      placeholder="A"
                    />
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => addEntry(team)}
                      disabled={saving || !newPlayer.trim()}
                      className="flex-1 py-1 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white text-[10px] font-semibold rounded"
                    >
                      {saving ? '…' : 'Hinzufügen'}
                    </button>
                    <button
                      onClick={() => { setAddingTeam(null); setNewPlayer(''); setNewMinutes('90'); setNewGoals('0'); setNewAssists('0') }}
                      className="px-2 py-1 border border-gray-200 rounded text-[10px] text-gray-600"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setAddingTeam(team); setNewPlayer(''); setNewMinutes('90'); setNewGoals('0'); setNewAssists('0') }}
                  className="w-full py-1 border border-dashed border-gray-300 rounded text-[10px] text-gray-500 hover:border-red-300 hover:text-red-600"
                >
                  + Spieler
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Goalscorers Admin Tab ───────────────────────────────────────────────

type GsRow = {
  match_id: number
  player_id: number
  status: string
  is_offered: boolean
  is_offered_2plus: boolean
  odds_score: number | null
  odds_score_2plus: number | null
  prob_score: number | null
  prob_score_2plus: number | null
  frozen_at: string | null
  player: {
    id: number; name: string; position: string | null; games: number; minutes: number
    goals: number; assists: number; is_goalkeeper: boolean
  }
}

type ScorerRow = { id: number; player_id: number; goals: number; is_own_goal: boolean }

const STATUS_LABELS: Record<string, string> = {
  available: 'Verfügbar', questionable: 'Fraglich', missing: 'Fehlt',
  injured: 'Verletzt', suspended: 'Gesperrt', not_bettable: 'Nicht wettbar',
}

function GoalscorersTab({ matches, onMessage }: { matches: MatchRow[]; onMessage: (m: string | null) => void }) {
  // Wildenroth match filter: matches whose teams contain "Wildenroth"
  const wildenrothMatches = matches.filter(m =>
    (m.home_team?.name?.includes('Wildenroth') || m.away_team?.name?.includes('Wildenroth'))
  )
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(wildenrothMatches[0]?.id ?? null)
  const [rows, setRows] = useState<GsRow[]>([])
  const [scorers, setScorers] = useState<ScorerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [savingScorers, setSavingScorers] = useState(false)

  const reload = useCallback(async () => {
    if (selectedMatchId == null) return
    setLoading(true)
    const res = await fetch(`/api/admin/goalscorers/match?matchId=${selectedMatchId}`)
    const data = await res.json()
    setLoading(false)
    if (res.ok) {
      setRows(data.rows ?? [])
      setScorers(data.scorers ?? [])
    } else {
      onMessage(`Fehler: ${data.error}`)
    }
  }, [selectedMatchId, onMessage])

  useEffect(() => { reload() }, [reload])

  async function freezeOrRefresh() {
    if (selectedMatchId == null) return
    setFreezing(true)
    const res = await fetch('/api/admin/goalscorers/match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: selectedMatchId, force: true }),
    })
    const data = await res.json()
    setFreezing(false)
    if (res.ok) { onMessage('Torschützen-Quoten berechnet.'); reload() }
    else onMessage(`Fehler: ${data.error}`)
  }

  async function updateAvailability(playerId: number, patch: Partial<{ status: string; is_offered: boolean; is_offered_2plus: boolean }>) {
    if (selectedMatchId == null) return
    const res = await fetch('/api/admin/goalscorers/availability', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: selectedMatchId, playerId, ...patch }),
    })
    if (res.ok) reload()
    else {
      const data = await res.json()
      onMessage(`Fehler: ${data.error}`)
    }
  }

  async function cancelPlayer(playerId: number, playerName: string) {
    if (selectedMatchId == null) return
    if (!confirm(`${playerName} entfernen?\nAlle offenen Torschützenwetten auf diesen Spieler werden storniert und die Einsätze zurückgebucht.`)) return
    const res = await fetch('/api/admin/goalscorers/cancel-player', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: selectedMatchId, playerId }),
    })
    const data = await res.json()
    if (res.ok) {
      onMessage(`Storniert: ${data.cancelledSingles} Einzelwetten, ${data.cancelledCombos} Kombiwetten.`)
      reload()
    } else {
      onMessage(`Fehler: ${data.error}`)
    }
  }

  async function saveScorers() {
    if (selectedMatchId == null) return
    setSavingScorers(true)
    const res = await fetch('/api/admin/goalscorers/scorers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: selectedMatchId,
        scorers: scorers.map(s => ({ playerId: s.player_id, goals: s.goals, isOwnGoal: s.is_own_goal })),
      }),
    })
    const data = await res.json()
    setSavingScorers(false)
    if (res.ok) {
      onMessage(`Torschützen gespeichert · ${data.settled} Wette(n) abgerechnet, ${data.combosChecked} Kombi(s) geprüft.`)
      reload()
    } else onMessage(`Fehler: ${data.error}`)
  }

  function addScorerRow() {
    setScorers(s => [...s, { id: -Date.now(), player_id: rows[0]?.player_id ?? 0, goals: 1, is_own_goal: false }])
  }

  const selectedMatch = wildenrothMatches.find(m => m.id === selectedMatchId) ?? null
  const isFinished = selectedMatch?.status === 'finished'
  const allFrozen = rows.length > 0 && rows.every(r => r.frozen_at)

  return (
    <div className="space-y-4">
      {wildenrothMatches.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-xl px-4 py-3">
          Keine Wildenroth-Spiele gefunden.
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {wildenrothMatches.map(m => {
          const date = new Date(m.match_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
          const opp = m.home_team?.name?.includes('Wildenroth') ? m.away_team?.short_name : m.home_team?.short_name
          return (
            <button key={m.id} onClick={() => setSelectedMatchId(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                m.id === selectedMatchId ? 'bg-red-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300'
              }`}>
              ST {m.matchday} · {opp} · {date}
            </button>
          )
        })}
      </div>

      {selectedMatch && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-900">
                {selectedMatch.home_team?.name} – {selectedMatch.away_team?.name}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {allFrozen ? 'Quoten gefroren' : 'Quoten noch nicht berechnet'}
              </p>
            </div>
            <button onClick={freezeOrRefresh} disabled={freezing}
              className="px-3 py-1.5 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white rounded-lg text-xs font-semibold">
              {freezing ? '…' : 'Quoten neu berechnen'}
            </button>
          </div>

          {loading && <div className="text-center py-6 text-gray-400 text-sm">Lade…</div>}

          {!loading && rows.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm">
              Noch keine Spieler. &bdquo;Quoten neu berechnen&ldquo; klicken.
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="divide-y divide-gray-50">
              {rows
                .filter(r => !r.player?.is_goalkeeper)
                .sort((a, b) => (a.odds_score ?? 99) - (b.odds_score ?? 99))
                .map(r => (
                <div key={r.player_id} className="px-3 py-2.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900 truncate">{r.player.name}</div>
                      <div className="text-[10px] text-gray-400">
                        {r.player.position ?? '–'} · {r.player.games}Sp / {r.player.minutes}min · {r.player.goals}T / {r.player.assists}A
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">Trifft</span>
                      <span className="font-bold text-red-700 tabular-nums">
                        {r.odds_score != null ? Number(r.odds_score).toFixed(2).replace('.', ',') : '–'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">2+</span>
                      <span className="font-bold text-red-700 tabular-nums">
                        {r.is_offered_2plus && r.odds_score_2plus != null ? Number(r.odds_score_2plus).toFixed(2).replace('.', ',') : '–'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <select
                      value={r.status}
                      onChange={e => updateAvailability(r.player_id, { status: e.target.value })}
                      className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5"
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button type="button"
                      onClick={() => updateAvailability(r.player_id, { is_offered: !r.is_offered })}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                        r.is_offered ? 'bg-red-700 border-red-700 text-white' : 'bg-white border-gray-200 text-gray-500'
                      }`}>
                      angeboten
                    </button>
                    <button type="button"
                      onClick={() => updateAvailability(r.player_id, { is_offered_2plus: !r.is_offered_2plus })}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                        r.is_offered_2plus ? 'bg-red-700 border-red-700 text-white' : 'bg-white border-gray-200 text-gray-500'
                      }`}>
                      2+
                    </button>
                    <button onClick={() => cancelPlayer(r.player_id, r.player.name)}
                      className="ml-auto text-[10px] text-red-600 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-50">
                      Spieler entfernen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Scorers entry — only after match finished */}
          {isFinished && (
            <div className="border-t border-gray-100 px-3 py-3 bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-sm text-gray-900">Torschützen eintragen</h4>
                <button onClick={addScorerRow}
                  className="text-xs px-2 py-1 bg-white border border-gray-200 rounded-lg text-gray-700 hover:border-red-300">
                  + Tor
                </button>
              </div>
              <div className="space-y-1.5">
                {scorers.map((s, idx) => (
                  <div key={s.id} className="flex items-center gap-1.5 text-xs">
                    <select value={s.player_id}
                      onChange={e => setScorers(arr => arr.map((x, i) => i === idx ? { ...x, player_id: parseInt(e.target.value) } : x))}
                      className="flex-1 border border-gray-200 rounded px-2 py-1">
                      {rows.filter(r => !r.player?.is_goalkeeper).map(r => (
                        <option key={r.player_id} value={r.player_id}>{r.player.name}</option>
                      ))}
                    </select>
                    <input type="number" min="1" max="10" value={s.goals}
                      onChange={e => setScorers(arr => arr.map((x, i) => i === idx ? { ...x, goals: parseInt(e.target.value) || 1 } : x))}
                      className="w-12 text-center border border-gray-200 rounded px-1 py-1" />
                    <button type="button"
                      onClick={() => setScorers(arr => arr.map((x, i) => i === idx ? { ...x, is_own_goal: !x.is_own_goal } : x))}
                      className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                        s.is_own_goal ? 'bg-red-700 border-red-700 text-white' : 'bg-white border-gray-200 text-gray-500'
                      }`}>
                      ET
                    </button>
                    <button onClick={() => setScorers(arr => arr.filter((_, i) => i !== idx))}
                      className="text-red-600">✕</button>
                  </div>
                ))}
                {scorers.length === 0 && (
                  <div className="text-xs text-gray-500 italic">Noch keine Torschützen eingetragen.</div>
                )}
              </div>
              <button onClick={saveScorers} disabled={savingScorers}
                className="mt-3 w-full py-2 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white text-sm font-bold rounded-lg">
                {savingScorers ? '…' : 'Torschützen speichern & abrechnen'}
              </button>
              <p className="text-[10px] text-gray-500 mt-2">
                Eigentore (ET) zählen nicht für Torschützenwetten.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Test-Spieltag Panel ────────────────────────────────────────────────────

interface TestMatch {
  id: number
  match_date: string
  status: string
  home_team: { name: string } | null
  away_team: { name: string } | null
}

function TestMatchdayPanel() {
  const [exists, setExists] = useState(false)
  const [matches, setMatches] = useState<TestMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  async function loadStatus() {
    setLoading(true)
    const res = await fetch('/api/admin/test-matchday')
    if (res.ok) {
      const data = await res.json()
      setExists(data.exists)
      setMatches(data.matches ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { loadStatus() }, [])

  async function seed() {
    if (!confirm('Test-Spieltag 999 anlegen? Kickoff-Zeiten ab jetzt +5 Min bis +270 Min.')) return
    setActionLoading(true)
    setResult(null)
    const res = await fetch('/api/admin/test-matchday', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seed' }),
    })
    const data = await res.json()
    setResult(res.ok ? `✓ ${data.created} Test-Spiele angelegt · ${data.snapshotted} User-Guthaben gesnapshottet` : `✗ ${data.error}`)
    await loadStatus()
    setActionLoading(false)
  }

  async function teardown() {
    if (!confirm('Test-Spieltag 999 vollständig entfernen? Alle Testdaten werden gelöscht und alle User-Guthaben auf den Snapshot-Stand zurückgesetzt.')) return
    setActionLoading(true)
    setResult(null)
    const res = await fetch('/api/admin/test-matchday', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'teardown' }),
    })
    const data = await res.json()
    if (res.ok) {
      const parts = [`✓ Teardown abgeschlossen`]
      if (data.matchesDeleted > 0) parts.push(`${data.matchesDeleted} Spiele`)
      if (data.betsDeleted > 0) parts.push(`${data.betsDeleted} Wetten`)
      if (data.combosDeleted > 0) parts.push(`${data.combosDeleted} Kombis`)
      if (data.usersRestored > 0) parts.push(`Guthaben von ${data.usersRestored} Usern wiederhergestellt`)
      setResult(parts.join(' · '))
    } else {
      setResult(`✗ ${data.error}`)
    }
    await loadStatus()
    setActionLoading(false)
  }

  const now = new Date()

  return (
    <details className="group" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer list-none flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 select-none">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧪</span>
          <span className="font-bold text-amber-900 text-sm">Test-Spieltag (Pre-Season)</span>
          {!loading && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${exists ? 'bg-amber-200 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
              {exists ? 'aktiv' : 'nicht angelegt'}
            </span>
          )}
        </div>
        <svg className={`w-4 h-4 text-amber-600 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>

      <div className="mt-2 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 space-y-4">
        <div className="text-xs text-amber-800 bg-amber-100 rounded-xl p-3 space-y-1">
          <div className="font-semibold">Isolation-Garantien:</div>
          <ul className="space-y-0.5 ml-2">
            <li>· Spieltag 999 — kein Konflikt mit echten Spieltagen</li>
            <li>· Wetten erhalten <code className="bg-amber-200 px-1 rounded">season=TEST</code> → erscheinen nicht in Ranglisten-P&amp;L</li>
            <li>· Cron überspringt Spieltag ≥ 900 → keine Massen-Pushes</li>
            <li>· Settle-Route überspringt Inaktivitäts-Strafe &amp; Recap-Push für Spieltag 999</li>
            <li>· Seed snapshottert <strong>alle</strong> User-Guthaben → Teardown stellt alle wieder her</li>
          </ul>
        </div>

        {result && (
          <div className={`text-xs px-3 py-2 rounded-lg font-medium ${result.startsWith('✓') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
            {result}
          </div>
        )}

        {!exists ? (
          <button
            onClick={seed}
            disabled={actionLoading}
            className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
          >
            {actionLoading ? 'Anlegen…' : '🧪 Test-Spieltag anlegen (Spieltag 999)'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              {matches.map(m => {
                const kickoff = new Date(m.match_date)
                const minsTill = Math.round((kickoff.getTime() - now.getTime()) / 60_000)
                const kickoffStr = kickoff.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={m.id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 text-xs border border-amber-100">
                    <span className="font-semibold text-gray-800">
                      {m.home_team?.name ?? '?'} – {m.away_team?.name ?? '?'}
                    </span>
                    <span className={`ml-2 flex-shrink-0 ${m.status === 'finished' ? 'text-green-600' : m.status === 'postponed' ? 'text-orange-500' : minsTill <= 0 ? 'text-red-500' : 'text-gray-500'}`}>
                      {m.status === 'finished' ? '✓ abgerechnet' : m.status === 'postponed' ? '⏸ verschoben' : minsTill <= 0 ? `${kickoffStr} (läuft)` : `${kickoffStr} (in ${minsTill} Min)`}
                    </span>
                  </div>
                )
              })}
            </div>
            <button
              onClick={teardown}
              disabled={actionLoading}
              className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
            >
              {actionLoading ? 'Entferne…' : '🗑 Test-Spieltag vollständig entfernen'}
            </button>
          </div>
        )}
      </div>
    </details>
  )
}
