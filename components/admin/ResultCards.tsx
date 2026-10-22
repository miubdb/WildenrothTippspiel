'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Btn, Field, Notice, Panel, Pill, inputCls, selectCls } from '@/components/admin/ui'
import type { MatchRow, ScorerDraft } from '@/components/admin/types'
import { MatchAnnulmentPanel } from '@/components/admin/MatchAnnulmentPanel'

/**
 * Visuelle Übernahme aus dem alten, verworfenen Admin-Redesign (components/admin/ResultCards.tsx
 * dort) — angepasst an das, was hier bereits existiert, statt es zu duplizieren:
 *  - `onMessage`/`notify`-Aufrufe sind hier `onMessage: (m: string | null) => void`, der schon
 *    bestehenden Konvention von GoalscorersTab/KaderSection folgend, statt eines neuen
 *    Toast-Systems.
 *  - `CupSettlementPreview`, `isWildenrothMatch` und `LineupsSection` (+ ihre kleinen Helfer)
 *    sind UNVERÄNDERT aus app/admin/page.tsx hierher VERSCHOBEN (nicht neu geschrieben, nicht
 *    kopiert) — das war vorher die einzige bestehende Implementierung der Abrechnungs-Vorschau
 *    (Risiko #1 aus dem Admin-Übernahmeplan: keine zweite, unabhängige Kopie) bzw. der
 *    Aufstellungspflege, und bleibt es; sie standen in page.tsx nur deshalb exportiert, weil
 *    diese Datei sie zuvor importierte. `MatchRow`/`ScorerDraft` kommen aus
 *    components/admin/types.ts, wohin sie aus demselben Grund ausgelagert wurden (page.tsx
 *    importiert sie jetzt ebenfalls von dort) — ohne das wären page.tsx und diese Datei
 *    gegenseitig voneinander abhängig gewesen.
 */

function isWildenrothMatch(match: MatchRow) {
  return !!(match.home_team?.name?.includes('Wildenroth') || match.away_team?.name?.includes('Wildenroth'))
}

/** Client-side "would settle as" preview for the 6 named-outcome cup markets
 *  (BTTS/Torschütze settle via their own existing mechanisms, not shown
 *  here), computed live from the current form state so the admin can sanity-
 *  check every market BEFORE clicking "Ergebnis & abrechnen" — mirrors
 *  settleBet()/cupAdvanceWinner() in app/api/admin/settle/route.ts exactly;
 *  keep both in sync if that logic ever changes. Purely a display aid, never
 *  submitted anywhere — the server re-derives everything itself. */
export function CupSettlementPreview({
  match, score, cupInput,
}: {
  match: MatchRow
  score: { home: string; away: string }
  cupInput?: { shootoutWinner: string; firstGoalTeam: string; firstGoalMinute: string; halftimeHome: string; halftimeAway: string; awayTeamLed: string }
}) {
  const homeScore = score.home === '' ? null : Number(score.home)
  const awayScore = score.away === '' ? null : Number(score.away)
  if (homeScore == null || awayScore == null || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null

  const homeName = match.home_team?.short_name ?? match.home_team?.name ?? 'Heim'
  const awayName = match.away_team?.short_name ?? match.away_team?.name ?? 'Gast'
  const isDraw = homeScore === awayScore
  const shootoutWinner = (cupInput?.shootoutWinner || null) as 'home' | 'away' | null
  const winner: 'home' | 'away' | null = isDraw ? shootoutWinner : (homeScore > awayScore ? 'home' : 'away')
  const winnerKnown = winner != null

  const htHome = cupInput?.halftimeHome === '' || cupInput?.halftimeHome == null ? null : Number(cupInput.halftimeHome)
  const htAway = cupInput?.halftimeAway === '' || cupInput?.halftimeAway == null ? null : Number(cupInput.halftimeAway)
  const homeLedAtHt = htHome != null && htAway != null && htHome > htAway
  const awayLed = cupInput?.awayTeamLed === 'yes'
  const firstGoal = homeScore === 0 && awayScore === 0 ? 'none' : (cupInput?.firstGoalTeam || null)

  const needsFirstGoalMinute = homeScore > 0 || awayScore > 0
  const firstGoalMinute = cupInput?.firstGoalMinute === '' || cupInput?.firstGoalMinute == null ? null : Number(cupInput.firstGoalMinute)
  const earlyGoal = !needsFirstGoalMinute ? false : (firstGoalMinute != null && firstGoalMinute >= 1 && firstGoalMinute <= 15)

  const htKnown = htHome != null && htAway != null
  const ht1 = (htHome ?? 0) + (htAway ?? 0)
  const ht2 = (homeScore - (htHome ?? 0)) + (awayScore - (htAway ?? 0))
  const moreGoalsOutcome = ht1 > ht2 ? '1. Halbzeit' : ht2 > ht1 ? '2. Halbzeit' : 'Gleich viele'
  const bothHalvesBtts = htKnown && (htHome ?? 0) > 0 && (htAway ?? 0) > 0 && (homeScore - (htHome ?? 0)) > 0 && (awayScore - (htAway ?? 0)) > 0

  const rows: { label: string; value: string; unresolved?: boolean }[] = [
    { label: 'Wer kommt weiter?', value: winnerKnown ? (winner === 'home' ? homeName : awayName) : '— Elfmeter-Sieger fehlt', unresolved: !winnerKnown },
    { label: 'Wie fällt die Entscheidung?', value: isDraw ? 'Elfmeterschießen' : 'Nach 90 Minuten' },
    { label: 'HZ-Führung + Weiter', value: winnerKnown ? (homeLedAtHt && winner === 'home' ? 'Ja' : 'Nein') : '— Elfmeter-Sieger fehlt', unresolved: !winnerKnown },
    { label: 'Comeback (Geiselbullach führte) + Weiter', value: winnerKnown ? (awayLed && winner === 'home' ? 'Ja' : 'Nein') : '— Elfmeter-Sieger fehlt', unresolved: !winnerKnown },
    { label: 'Elfmeterschießen + Weiter', value: isDraw ? (shootoutWinner === 'home' ? 'Ja' : shootoutWinner ? 'Nein' : '— Elfmeter-Sieger fehlt') : 'Nein', unresolved: isDraw && !shootoutWinner },
    { label: 'Erstes Tor', value: firstGoal === 'home' ? homeName : firstGoal === 'away' ? awayName : firstGoal === 'none' ? 'Kein Tor' : '— fehlt noch', unresolved: !firstGoal },
    { label: 'Frühes Tor (Min. 1-15)', value: !needsFirstGoalMinute ? 'Nein (kein Tor)' : (firstGoalMinute != null ? (earlyGoal ? 'Ja' : 'Nein') : '— Minute fehlt'), unresolved: needsFirstGoalMinute && firstGoalMinute == null },
    { label: 'Mehr Tore je Halbzeit', value: htKnown ? moreGoalsOutcome : '— Halbzeitstand fehlt', unresolved: !htKnown },
    { label: 'Beide Teams in beiden HZ', value: htKnown ? (bothHalvesBtts ? 'Ja' : 'Nein') : '— Halbzeitstand fehlt', unresolved: !htKnown },
  ]

  return (
    <div className="bg-white border border-amber-200 rounded-lg p-2 mt-1">
      <div className="text-[10px] font-bold text-amber-700 uppercase mb-1">So würde abgerechnet</div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">{r.label}</span>
            <span className={`font-semibold ${r.unresolved ? 'text-red-600' : 'text-gray-800'}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}


type LineupEntryRow = {
  id: number
  match_id: number
  team_name: string
  player_name: string
  player_id: number | null
  minutes_played: number
  goals: number
  assists: number
  is_starter: boolean | null
  penalty_missed: boolean
}

function isWildenrothTeamName(name: string) {
  return name.includes('Wildenroth')
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
  const [newPlayerId, setNewPlayerId] = useState<number | null>(null)
  const [newMinutes, setNewMinutes] = useState('90')
  const [newGoals, setNewGoals] = useState('0')
  const [newAssists, setNewAssists] = useState('0')
  const [newStarter, setNewStarter] = useState(true)
  const [newPenaltyMissed, setNewPenaltyMissed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Wildenroth's own squad, for a real dropdown instead of free text — the
  // opponent has no roster data in this app, so they keep the old free-text
  // input. Fetched once; the roster endpoint 400s for a non-Wildenroth match,
  // which just means neither side gets a dropdown (silently, not an error
  // worth surfacing here).
  const [roster, setRoster] = useState<{ id: number; name: string }[]>([])
  const datalistId = `players-${matchId}`

  const reload = useCallback(async () => {
    const res = await fetch(`/api/admin/lineups?match_id=${matchId}`)
    const data = await res.json()
    setLoading(false)
    if (res.ok) setLineups(data.lineups ?? [])
  }, [matchId])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!isWildenrothTeamName(homeTeam) && !isWildenrothTeamName(awayTeam)) return
    fetch(`/api/admin/goalscorers/roster?matchId=${matchId}`)
      .then(r => r.json())
      .then(data => setRoster(data.players ?? []))
      .catch(() => {})
  }, [matchId, homeTeam, awayTeam])

  function resetForm() {
    setNewPlayer(''); setNewPlayerId(null); setNewMinutes('90'); setNewGoals('0'); setNewAssists('0')
    setNewStarter(true); setNewPenaltyMissed(false)
  }

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
        player_id: newPlayerId,
        minutes_played: parseInt(newMinutes) || 90,
        goals: parseInt(newGoals) || 0,
        assists: parseInt(newAssists) || 0,
        is_starter: newStarter,
        penalty_missed: newPenaltyMissed,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      resetForm()
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
          {[{ team: homeTeam, entries: homeLineup }, { team: awayTeam, entries: awayLineup }].map(({ team, entries }) => {
            const hasRoster = isWildenrothTeamName(team) && roster.length > 0
            return (
            <div key={team}>
              <div className="text-[11px] font-bold text-gray-700 mb-1 truncate">{team}</div>
              <div className="space-y-1 mb-2">
                {entries.length === 0 && (
                  <div className="text-[10px] text-gray-400 italic">Keine Einträge</div>
                )}
                {entries.map(e => (
                  <div key={e.id} className="flex items-center gap-1 text-[10px] bg-white border border-gray-100 rounded px-1.5 py-1">
                    <span className="flex-1 font-medium text-gray-800 truncate">{e.player_name}</span>
                    {e.is_starter === false && <span className="text-gray-400" title="Einwechslung">🔁</span>}
                    {e.penalty_missed && <span title="Elfer verschossen">❌</span>}
                    <span className="text-gray-400">{e.minutes_played}&apos;</span>
                    {e.goals > 0 && <span className="text-green-700 font-bold">{e.goals}T</span>}
                    {e.assists > 0 && <span className="text-blue-600 font-bold">{e.assists}A</span>}
                    <button onClick={() => deleteEntry(e.id)} className="text-red-500 ml-1">✕</button>
                  </div>
                ))}
              </div>

              {addingTeam === team ? (
                <div className="space-y-1">
                  {hasRoster ? (
                    <select
                      value={newPlayerId ?? ''}
                      onChange={e => {
                        const id = Number(e.target.value)
                        setNewPlayerId(id || null)
                        setNewPlayer(roster.find(p => p.id === id)?.name ?? '')
                      }}
                      className="w-full text-[11px] border border-gray-200 rounded px-2 py-1 bg-white"
                    >
                      <option value="">Spieler wählen…</option>
                      {roster.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <input
                      list={datalistId}
                      value={newPlayer}
                      onChange={e => setNewPlayer(e.target.value)}
                      placeholder="Spielername"
                      className="w-full text-[11px] border border-gray-200 rounded px-2 py-1"
                    />
                  )}
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
                  <div className="flex items-center gap-2 text-[10px] text-gray-600">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={newStarter} onChange={e => setNewStarter(e.target.checked)} />
                      Startelf
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={newPenaltyMissed} onChange={e => setNewPenaltyMissed(e.target.checked)} />
                      Elfer verschossen
                    </label>
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
                      onClick={() => { setAddingTeam(null); resetForm() }}
                      className="px-2 py-1 border border-gray-200 rounded text-[10px] text-gray-600"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setAddingTeam(team); resetForm() }}
                  className="w-full py-1 border border-dashed border-gray-300 rounded text-[10px] text-gray-500 hover:border-red-300 hover:text-red-600"
                >
                  + Spieler
                </button>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type CupInput = { shootoutWinner: string; firstGoalTeam: string; firstGoalMinute: string; halftimeHome: string; halftimeAway: string; awayTeamLed: string }
export const EMPTY_CUP: CupInput = { shootoutWinner: '', firstGoalTeam: '', firstGoalMinute: '', halftimeHome: '', halftimeAway: '', awayTeamLed: '' }

export const CATEGORY_LABEL: Record<string, string> = { kreisliga: 'Kreisliga', wildenroth_ii: 'Wildenroth II', 'b-klasse': 'B-Klasse', bklasse_topspiel: 'B-Klasse-Topspiel' }

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

/** „seit 3 Std.“ / „seit 2 Tagen“ – nur Orientierung, wie lange das Ergebnis schon fehlt. */
export function sinceLabel(iso: string, now: number): string {
  const diffMin = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (diffMin < 90) return 'Anpfiff vorbei'
  const h = Math.floor(diffMin / 60)
  if (h < 48) return `seit ${h} Std.`
  return `seit ${Math.floor(h / 24)} Tagen`
}

// ── Ergebnis-Eingabefeld ────────────────────────────────────────────────────
function ScoreInput({ value, onChange, label, inputRef, onEnter }: {
  value: string; onChange: (v: string) => void; label: string
  inputRef?: React.Ref<HTMLInputElement>; onEnter?: () => void
}) {
  return (
    <input
      ref={inputRef}
      type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} autoComplete="off"
      enterKeyHint={onEnter ? 'next' : 'done'}
      aria-label={label} placeholder="–" value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (onEnter) onEnter(); else e.currentTarget.blur() } }}
      className="h-14 w-[72px] shrink-0 rounded-xl border-2 border-gray-300 bg-white text-center text-[28px] font-extrabold tabular-nums text-gray-900 placeholder:text-gray-400 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/30"
    />
  )
}

function MatchHeader({ match, effectiveMatchday, pill }: { match: MatchRow; effectiveMatchday?: number | null; pill: ReactNode }) {
  const md = effectiveMatchday ?? match.matchday
  const differs = effectiveMatchday != null && effectiveMatchday !== match.matchday
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {pill}
        {match.competition_type === 'cup' && <Pill tone="info">🏆 Pokal</Pill>}
      </div>
      <div className="text-[13px] leading-5 text-gray-600">
        <b className="text-gray-900">{md === 999 ? 'Test' : `Spieltag ${md}`}</b>
        {differs && <span title="Spieltagsnummer des BFV für dieses Spiel"> · BFV-Spieltag {match.matchday}</span>}
        {' · '}{CATEGORY_LABEL[match.match_category ?? 'kreisliga'] ?? match.match_category}
        {' · '}{fmtDay(match.match_date)} {fmtTime(match.match_date)} Uhr
      </div>
    </div>
  )
}

/** Drei Zustände für die Pill-Beschriftung — rein abgeleitet aus bereits geladenen Daten
 *  (home_score/away_score vorhanden?, match_date vs. jetzt), keine neue Serverlogik:
 *  'missing' = Anpfiff vorbei, noch kein Ergebnis · 'unsettled' = Ergebnis da, noch nicht
 *  abgerechnet · 'upcoming' = noch nicht angepfiffen. */
export type SettleMode = 'missing' | 'unsettled' | 'upcoming'

/** Ergebnis-Eintragekarte: Vereinsnamen voll lesbar, große Ergebnisfelder, Abrechnen als eine klare Hauptaktion. */
export function MatchSettleCard({
  match, score, onChange, cupInput, onCupInputChange, onSettle, onPostpone, loading, mode, pendingBets,
  scorerDraft, onScorersChange, effectiveMatchday, now, cupSettlementPreview,
}: {
  match: MatchRow
  score: { home: string; away: string }
  onChange: (side: 'home' | 'away', val: string) => void
  cupInput?: CupInput
  onCupInputChange?: (field: keyof CupInput, val: string) => void
  onSettle: () => void
  onPostpone?: () => void
  loading: boolean
  mode: SettleMode
  pendingBets?: number
  scorerDraft?: ScorerDraft[]
  onScorersChange?: (draft: ScorerDraft[]) => void
  /** Tippspiel-Spieltag, unter dem das Spiel geführt wird (bei Wildenroth II/B-Klasse ≠ eigene BFV-Nummer). */
  effectiveMatchday?: number | null
  now: number
  /** Die EINE bestehende CupSettlementPreview aus app/admin/page.tsx, vom Aufrufer gerendert
   *  und hier nur platziert — keine zweite Implementierung der Abrechnungs-Vorschau. */
  cupSettlementPreview?: ReactNode
}) {
  const awayRef = useRef<HTMLInputElement | null>(null)
  const isCup = match.competition_type === 'cup'
  const ready = score.home !== '' && score.away !== ''
  const pill = mode === 'missing'
    ? <Pill tone="critical">● Ergebnis fehlt · {sinceLabel(match.match_date, now)}</Pill>
    : mode === 'unsettled'
    ? <Pill tone="open">Ergebnis da · nicht abgerechnet</Pill>
    : <Pill tone="info">Geplant · vorab eintragbar</Pill>
  const cup = cupInput ?? EMPTY_CUP
  const homeName = match.home_team?.name ?? '?'
  const awayName = match.away_team?.name ?? '?'

  return (
    <Panel as="article" tone={mode === 'missing' ? 'critical' : mode === 'unsettled' ? 'open' : 'info'} className="space-y-4 p-4">
      <MatchHeader match={match} effectiveMatchday={effectiveMatchday} pill={pill} />

      {/* Vereinsnamen bekommen die volle Breite (lange Namen wie „[SG] TSV Herrsching/SF Breitbrunn 2“ brechen um), das Feld steht rechts daneben. */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Heim</div>
            <div className="break-words text-[17px] font-bold leading-snug text-gray-900">{homeName}</div>
          </div>
          <ScoreInput label={`Tore ${homeName}`} value={score.home} onChange={(v) => onChange('home', v)} onEnter={() => awayRef.current?.focus()} />
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Gast</div>
            <div className="break-words text-[17px] font-bold leading-snug text-gray-900">{awayName}</div>
          </div>
          <ScoreInput label={`Tore ${awayName}`} value={score.away} onChange={(v) => onChange('away', v)} inputRef={awayRef} />
        </div>
      </div>

      {pendingBets != null && pendingBets > 0 && (
        <Notice tone="info"><b>{pendingBets}</b> offene {pendingBets === 1 ? 'Wette wird' : 'Wetten werden'} beim Abrechnen ausgewertet.</Notice>
      )}

      {/* Pokal: zusätzliche manuelle Angaben (siehe app/api/admin/settle/route.ts – nicht automatisch ableitbar) */}
      {isCup && onCupInputChange && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-[13px] font-bold uppercase tracking-wide text-amber-900">🏆 Pokalabrechnung</div>
          <Field label="Elfmeter-Sieger (nur bei Remis nach 90 Min.)">
            <select value={cup.shootoutWinner} onChange={(e) => onCupInputChange('shootoutWinner', e.target.value)} className={selectCls}>
              <option value="">—</option>
              <option value="home">{match.home_team?.name ?? 'Heim'}</option>
              <option value="away">{match.away_team?.name ?? 'Gast'}</option>
            </select>
          </Field>
          <Field label="Erstes Tor">
            <select value={cup.firstGoalTeam} onChange={(e) => onCupInputChange('firstGoalTeam', e.target.value)} className={selectCls}>
              <option value="">— auswählen —</option>
              <option value="home">{match.home_team?.name ?? 'Heim'}</option>
              <option value="away">{match.away_team?.name ?? 'Gast'}</option>
              <option value="none">Kein Tor (0:0)</option>
            </select>
          </Field>
          {cup.firstGoalTeam && cup.firstGoalTeam !== 'none' && (
            <Field label="Minute des 1. Tores" hint="für „Frühes Tor Min. 1–15“">
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={cup.firstGoalMinute}
                onChange={(e) => onCupInputChange('firstGoalMinute', e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="z. B. 12" className={`${inputCls} max-w-[140px]`} />
            </Field>
          )}
          <div>
            <div className="mb-1 text-[13px] font-semibold text-gray-700">Halbzeitstand</div>
            <div className="flex items-center gap-2">
              <input aria-label={`Halbzeit Tore ${match.home_team?.short_name ?? 'Heim'}`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={cup.halftimeHome}
                onChange={(e) => onCupInputChange('halftimeHome', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder={match.home_team?.short_name ?? 'Heim'} className={`${inputCls} max-w-[110px] text-center`} />
              <span className="font-bold text-gray-500">:</span>
              <input aria-label={`Halbzeit Tore ${match.away_team?.short_name ?? 'Gast'}`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={cup.halftimeAway}
                onChange={(e) => onCupInputChange('halftimeAway', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder={match.away_team?.short_name ?? 'Gast'} className={`${inputCls} max-w-[110px] text-center`} />
            </div>
          </div>
          <Field label={`${match.away_team?.short_name ?? 'Gast'} führte im Spielverlauf?`}>
            <select value={cup.awayTeamLed} onChange={(e) => onCupInputChange('awayTeamLed', e.target.value)} className={selectCls}>
              <option value="">— auswählen —</option>
              <option value="yes">Ja, war irgendwann in Führung</option>
              <option value="no">Nein, nie in Führung</option>
            </select>
          </Field>
          <p className="text-[12px] text-gray-700">Halbzeitstand &amp; &bdquo;{match.away_team?.short_name ?? 'Gast'} führte&ldquo; werden für die Pokal-Spezialmärkte benötigt und müssen vor dem Abrechnen ausgefüllt sein.</p>
          {cupSettlementPreview}
        </div>
      )}

      {/* Wildenroth-Spiel: Torschützen direkt hier – sie werden im selben Schritt wie das Ergebnis abgeschickt */}
      {isWildenrothMatch(match) && onScorersChange && (
        <InlineScorerEntry matchId={match.id} draft={scorerDraft ?? []} onChange={onScorersChange} />
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Btn variant="primary" block loading={loading} disabled={!ready} onClick={onSettle} className="sm:flex-1">
          {loading ? 'Wird abgerechnet …' : 'Ergebnis speichern & abrechnen'}
        </Btn>
        {onPostpone && <Btn variant="secondary" disabled={loading} onClick={onPostpone} className="sm:w-auto">Verschoben</Btn>}
      </div>
      {!ready && <p className="-mt-2 text-[12px] text-gray-600">Beide Torzahlen eintragen, dann abrechnen.</p>}
    </Panel>
  )
}

/** Torschützen-Eingabe für ein Wildenroth-Spiel. Unabhängig davon, ob für das Spiel je Quoten eingefroren wurden – der aktive Kader
 *  kommt direkt aus /api/admin/goalscorers/roster. Reiner Entwurfs-Editor; die Karte schickt `draft` zusammen mit dem Ergebnis ab. */
function InlineScorerEntry({
  matchId, draft, onChange,
}: {
  matchId: number
  draft: ScorerDraft[]
  onChange: (draft: ScorerDraft[]) => void
}) {
  const [expanded, setExpanded] = useState(draft.length > 0)
  const [players, setPlayers] = useState<{ id: number; name: string }[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!expanded || players !== null) return
    let cancelled = false
    fetch(`/api/admin/goalscorers/roster?matchId=${matchId}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setPlayers(data.players ?? []) })
      .catch(() => { if (!cancelled) { setPlayers([]); setLoadError(true) } })
    return () => { cancelled = true }
  }, [expanded, players, matchId])

  function addRow() { onChange([...draft, { playerId: players?.[0]?.id ?? 0, goals: 1, isOwnGoal: false }]) }
  function updateRow(i: number, patch: Partial<ScorerDraft>) { onChange(draft.map((r, idx) => (idx === i ? { ...r, ...patch } : r))) }
  function removeRow(i: number) { onChange(draft.filter((_, idx) => idx !== i)) }

  if (!expanded) {
    return <Btn variant="secondary" block onClick={() => setExpanded(true)}>⚽ Torschützen eintragen</Btn>
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
      <div className="text-[13px] font-bold text-sky-900">⚽ Torschützen <span className="font-medium text-sky-800">(werden mit dem Ergebnis abgeschickt)</span></div>
      {players === null ? (
        <div className="text-[14px] text-gray-600">Kader wird geladen …</div>
      ) : (
        <>
          {draft.map((row, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-gray-200 bg-white p-2.5">
              <select aria-label="Torschütze" value={row.playerId} onChange={(e) => updateRow(i, { playerId: Number(e.target.value) })} className={selectCls}>
                {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <label className="flex items-center gap-2 text-[14px] font-semibold text-gray-700">
                  Tore
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={row.goals}
                    onChange={(e) => updateRow(i, { goals: parseInt(e.target.value.replace(/\D/g, '')) || 1 })}
                    className="h-11 w-16 rounded-xl border border-gray-300 bg-white text-center text-[16px] font-bold" />
                </label>
                <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-semibold text-gray-700">
                  <input type="checkbox" checked={row.isOwnGoal} onChange={(e) => updateRow(i, { isOwnGoal: e.target.checked })} className="h-5 w-5 accent-red-700" />
                  Eigentor
                </label>
                <button type="button" onClick={() => removeRow(i)} className="ml-auto min-h-[44px] px-2 text-[14px] font-bold text-red-700">Entfernen</button>
              </div>
            </div>
          ))}
          {loadError && <Notice tone="critical">Kader konnte nicht geladen werden.</Notice>}
          {players.length === 0 && !loadError ? (
            <div className="text-[14px] text-gray-600">Kein aktiver Kader gefunden.</div>
          ) : players.length > 0 ? (
            <Btn variant="secondary" size="sm" onClick={addRow}>+ Torschütze hinzufügen</Btn>
          ) : null}
        </>
      )}
    </div>
  )
}

/** Verschobenes Spiel: neuen Termin eintragen → Spiel gilt wieder als geplant. */
export function PostponedMatchCard({
  match, onRescheduled, onMessage,
}: {
  match: MatchRow
  onRescheduled: () => void
  onMessage: (msg: string | null) => void
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
    // Als lokale Zeit aufbauen (Admin gibt Ortszeit ein, der Browser wandelt per toISOString nach UTC)
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
    <Panel as="article" tone="info" className="space-y-3 p-4">
      <div className="space-y-1.5">
        <Pill tone="info">Verschoben · wartet auf Termin</Pill>
        <div className="text-[13px] text-gray-600">BFV-Spieltag {match.matchday} · ursprünglich {fmtDay(match.match_date)} {fmtTime(match.match_date)} Uhr</div>
      </div>
      <div className="break-words text-[17px] font-bold leading-snug text-gray-900">{match.home_team?.name ?? '?'} – {match.away_team?.name ?? '?'}</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Neues Datum"><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Uhrzeit"><input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className={inputCls} /></Field>
      </div>
      <Field label="Spieltag" hint={parseInt(newMatchday) !== match.matchday ? '⚡ Der Spieltag wird geändert.' : undefined}>
        <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={newMatchday} onChange={(e) => setNewMatchday(e.target.value.replace(/\D/g, '').slice(0, 2))} className={`${inputCls} max-w-[120px]`} />
      </Field>
      <Btn variant="primary" block loading={loading} disabled={!newDate || !newTime} onClick={reschedule}>Nachholtermin speichern</Btn>

      {/* Nichtantritt/Annullierung — für ein verschobenes Spiel, das nie einen
          echten Nachholtermin/ein echtes Ergebnis bekommen wird (siehe
          lib/matchAnnulment.ts). Getrennt vom "Nachholtermin speichern"-Pfad
          oben — beide schließen sich gegenseitig aus (ein Spiel bekommt
          entweder einen neuen Termin ODER wird final annulliert). */}
      <div className="border-t border-gray-100 pt-3">
        <MatchAnnulmentPanel matchId={match.id} onDone={onRescheduled} onMessage={onMessage} />
      </div>
    </Panel>
  )
}

/**
 * Bereits annulliertes Spiel (status='annulled') — eigene, dauerhaft erreichbare Karte, damit
 * der Admin die offizielle BFV-Wertung auch TAGE später noch nachtragen/korrigieren kann (siehe
 * MatchAnnulmentPanel#OfficialScoreForm). Ohne diese Karte würde das annullierte Spiel nach dem
 * ersten Annullieren aus der Admin-Oberfläche verschwinden (fällt sonst weder unter "Verschoben"
 * noch "Abgerechnet") — genau der Zustand, in dem "später nachtragen, ohne Wettscheine erneut zu
 * bearbeiten" sonst technisch nicht mehr erreichbar wäre.
 */
export function AnnulledMatchCard({ match, onChanged, onMessage }: {
  match: MatchRow
  onChanged: () => void
  onMessage: (msg: string | null) => void
}) {
  return (
    <Panel as="article" tone="neutral" className="space-y-3 p-4">
      <div className="space-y-1.5">
        <Pill tone="neutral">Annulliert · Nichtantritt</Pill>
        <div className="text-[13px] text-gray-600">BFV-Spieltag {match.matchday} · {fmtDay(match.match_date)} {fmtTime(match.match_date)} Uhr</div>
      </div>
      <div className="break-words text-[17px] font-bold leading-snug text-gray-900">{match.home_team?.name ?? '?'} – {match.away_team?.name ?? '?'}</div>
      <MatchAnnulmentPanel matchId={match.id} onDone={onChanged} onMessage={onMessage} autoLoad />
    </Panel>
  )
}

/** Abgerechnetes Spiel: klar als erledigt gekennzeichnet; Aufstellung bei Bedarf. */
export function SettledMatchRow({ match, playerSuggestions, effectiveMatchday }: { match: MatchRow; playerSuggestions?: string[]; effectiveMatchday?: number | null }) {
  const [showLineups, setShowLineups] = useState(false)
  const hasScore = match.home_score !== null && match.away_score !== null
  return (
    <Panel as="article" tone="success" className="overflow-hidden">
      <div className="space-y-3 p-4">
        <MatchHeader match={match} effectiveMatchday={effectiveMatchday} pill={<Pill tone="success">✓ Abgerechnet</Pill>} />
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 break-words text-[16px] font-bold leading-snug text-gray-900">
            {match.home_team?.name ?? '?'}<span className="font-normal text-gray-500"> – </span>{match.away_team?.name ?? '?'}
          </div>
          {hasScore && (
            <div className="shrink-0 rounded-xl bg-gray-900 px-3.5 py-2 font-display text-[26px] font-extrabold leading-none tabular-nums text-white" aria-label={`Endstand ${match.home_score} zu ${match.away_score}`}>
              {match.home_score}:{match.away_score}
            </div>
          )}
        </div>
        {match.status === 'finished' && (
          <Btn variant="secondary" size="sm" block aria-expanded={showLineups} onClick={() => setShowLineups((v) => !v)}>
            {showLineups ? 'Aufstellung ausblenden ▲' : 'Aufstellung anzeigen ▼'}
          </Btn>
        )}
      </div>
      {showLineups && match.status === 'finished' && (
        <div className="border-t border-gray-200 bg-gray-50 p-3">
          <LineupsSection matchId={match.id} homeTeam={match.home_team?.name ?? ''} awayTeam={match.away_team?.name ?? ''} playerSuggestions={playerSuggestions ?? []} />
        </div>
      )}
    </Panel>
  )
}
