'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '@/components/admin/ui'
import type { MatchRow } from '@/components/admin/types'
import { effectiveMatchdayOf, type EffectiveMatchdayIndex } from '@/lib/season'
import type { Match } from '@/types'

/**
 * UNVERÄNDERT aus app/admin/page.tsx hierher verschoben (nicht neu geschrieben) — zieht von
 * Quoten nach Spieltag um (siehe SpieltagTabView.tsx), ruft aber exakt dieselben bestehenden
 * API-Routen (/api/admin/goalscorers/*) auf wie bisher. Eigene Datei, damit SpieltagTabView sie
 * importieren kann, ohne dass app/admin/page.tsx von einer Komponente importiert oder umgekehrt
 * ein Kreis entsteht.
 */

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
  /** Season record for the team ACTUALLY playing this fixture
   *  (wildenroth_player_team_stats). `player.games/minutes/goals` is club-wide
   *  and pools a squad='both' player's Kreisliga and B-Klasse appearances, so it
   *  must not be shown as this team's record. null = no row yet. */
  team_stats: { games: number; minutes: number; goals: number; assists: number; as_of_matches: number } | null
}

type ScorerRow = { id: number; player_id: number; goals: number; is_own_goal: boolean }

const STATUS_LABELS: Record<string, string> = {
  available: 'Verfügbar', questionable: 'Fraglich', missing: 'Fehlt',
  injured: 'Verletzt', suspended: 'Gesperrt', not_bettable: 'Nicht wettbar',
}

export function GoalscorersTab({ matches, onMessage, matchday, mdIndex }: { matches: MatchRow[]; onMessage: (m: string | null) => void; matchday: number | null; mdIndex: EffectiveMatchdayIndex }) {
  const confirm = useConfirm()
  // Wildenroth match filter: matches whose teams contain "Wildenroth"
  const wildenrothMatches = matches.filter(m =>
    (m.home_team?.name?.includes('Wildenroth') || m.away_team?.name?.includes('Wildenroth'))
  )
  // Default to the Wildenroth match belonging to the currently-selected
  // matchday (mirrors the odds-preview section above, `previewMd` in the
  // parent) — falling back to the season's first Wildenroth match if none
  // exists for that Spieltag. Only auto-follows when `matchday` itself
  // changes (see effect below), so it never fights a manual dropdown pick.
  const matchForMatchday = (md: number | null) =>
    (md != null ? wildenrothMatches.find(m => effectiveMatchdayOf(m as unknown as Match, mdIndex) === md) : null) ?? wildenrothMatches[0]
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(matchForMatchday(matchday)?.id ?? null)
  const lastAutoMatchday = useRef<number | null>(matchday)
  useEffect(() => {
    if (matchday === lastAutoMatchday.current) return
    lastAutoMatchday.current = matchday
    setSelectedMatchId(matchForMatchday(matchday)?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchday])
  const [rows, setRows] = useState<GsRow[]>([])
  // '1' | '2' — which Wildenroth side's season record the rows show.
  const [statsTeam, setStatsTeam] = useState<string | null>(null)
  const [scorers, setScorers] = useState<ScorerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [savingScorers, setSavingScorers] = useState(false)
  const [oddsDraft, setOddsDraft] = useState<Record<number, { score: string; score2plus: string }>>({})

  // Re-sync the editable odds drafts whenever the rows are (re)loaded — e.g.
  // after "Quoten neu berechnen" recomputes them from the model.
  useEffect(() => {
    const next: Record<number, { score: string; score2plus: string }> = {}
    for (const r of rows) {
      next[r.player_id] = {
        score: r.odds_score != null ? String(r.odds_score) : '',
        score2plus: r.odds_score_2plus != null ? String(r.odds_score_2plus) : '',
      }
    }
    setOddsDraft(next)
  }, [rows])

  const reload = useCallback(async () => {
    if (selectedMatchId == null) return
    setLoading(true)
    const res = await fetch(`/api/admin/goalscorers/match?matchId=${selectedMatchId}`)
    const data = await res.json()
    setLoading(false)
    if (res.ok) {
      setRows(data.rows ?? [])
      setStatsTeam(data.statsTeam ?? null)
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
    if (res.ok) {
      onMessage(data.frozen ? 'Torschützen-Quoten berechnet und eingefroren.' : 'Torschützen-Quoten-Vorschau berechnet (noch nicht eingefroren — Wettfenster ist noch nicht offen).')
      reload()
    }
    else onMessage(`Fehler: ${data.error}`)
  }

  async function updateAvailability(playerId: number, patch: Partial<{ status: string; is_offered: boolean; is_offered_2plus: boolean; odds_score: number; odds_score_2plus: number }>) {
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

  // Manual odds edit (Trifft/2+) — saved on blur, mirroring "leer = kein Wert
  // gesetzt": an empty/unparseable field is silently ignored rather than
  // erroring, since the row's odds_score can legitimately be null (e.g. a
  // player not yet offered) before the first "Quoten neu berechnen".
  async function saveOddsField(playerId: number, field: 'odds_score' | 'odds_score_2plus', raw: string) {
    const trimmed = raw.trim().replace(',', '.')
    if (trimmed === '') return
    const n = parseFloat(trimmed)
    if (isNaN(n) || n <= 1.0 || n > 999) {
      onMessage('Ungültiger Quotenwert (muss >1,00 sein).')
      return
    }
    await updateAvailability(playerId, { [field]: n })
  }

  async function cancelPlayer(playerId: number, playerName: string) {
    if (selectedMatchId == null) return
    if (!(await confirm({
      title: `${playerName} entfernen?`,
      message: 'Alle offenen Torschützenwetten auf diesen Spieler werden storniert und die Einsätze zurückgebucht.',
      confirmLabel: 'Entfernen', tone: 'danger',
    }))) return
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
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-gray-900">
                {selectedMatch.home_team?.name} – {selectedMatch.away_team?.name}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {allFrozen ? 'Quoten gefroren' : 'Quoten noch nicht berechnet'} · Trifft/2+ manuell bearbeitbar (Feld verlassen = speichern)
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
                        {r.player.position ?? '–'} ·{' '}
                        {r.team_stats
                          ? `${r.team_stats.games}Sp / ${r.team_stats.minutes}min · ${r.team_stats.goals}T / ${r.team_stats.assists}A`
                          : '0Sp / 0min · 0T / 0A'}
                        {statsTeam ? ` (Mannschaft ${statsTeam})` : ''}
                        {!r.team_stats && <span className="text-amber-600"> · keine Saisondaten für diese Mannschaft</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">Trifft</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={oddsDraft[r.player_id]?.score ?? ''}
                        placeholder="–"
                        onChange={e => setOddsDraft(prev => ({ ...prev, [r.player_id]: { ...prev[r.player_id], score: e.target.value, score2plus: prev[r.player_id]?.score2plus ?? '' } }))}
                        onBlur={e => saveOddsField(r.player_id, 'odds_score', e.target.value)}
                        className="w-14 text-center font-bold text-red-700 tabular-nums border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-red-400"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">2+</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={oddsDraft[r.player_id]?.score2plus ?? ''}
                        placeholder="–"
                        disabled={!r.is_offered_2plus}
                        onChange={e => setOddsDraft(prev => ({ ...prev, [r.player_id]: { ...prev[r.player_id], score2plus: e.target.value, score: prev[r.player_id]?.score ?? '' } }))}
                        onBlur={e => saveOddsField(r.player_id, 'odds_score_2plus', e.target.value)}
                        className="w-14 text-center font-bold text-red-700 tabular-nums border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-red-400 disabled:bg-gray-50 disabled:text-gray-300"
                      />
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
