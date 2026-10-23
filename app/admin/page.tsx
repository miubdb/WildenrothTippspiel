'use client'

import Image from 'next/image'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { mergeExactScoreOffers } from '@/lib/odds'
import type { OddsAnomaly } from '@/lib/oddsAnomalies'
import { homeHandicapFavored } from '@/lib/oddsMarkets'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf, nearestMatchdayByDate, SEASON_START } from '@/lib/season'
import { SurveyTab } from '@/components/admin/SurveyTab'
import { StatsTab } from '@/components/admin/StatsTab'
import { AuditLogPanel } from '@/components/admin/AuditLogPanel'
import { Btn, CategoryGroup, Chips, EmptyNote, Field, inputCls, LoadingBlock, Notice, Panel, Pill, Section, selectCls, useConfirm, wl } from '@/components/admin/ui'
import { AdminShellNav } from '@/components/admin/AdminShellNav'
import { ErgebnisseTabView } from '@/components/admin/ErgebnisseTabView'
import { SpieltagTabView } from '@/components/admin/SpieltagTabView'
import { EMPTY_CUP, type CupInput } from '@/components/admin/ResultCards'
import { cx } from '@/components/ui'
import type { Match } from '@/types'
import type { MatchRow, ScorerDraft } from '@/components/admin/types'

// Matchday numbers repeat across seasons — without this filter the admin
// match list (and everything fed by it: "Abgerechnete Spiele", the Spieltag
// picker, the bets viewer) mixes in the prior season's identically-numbered
// fixtures. matchday 999 (test) is exempt, same as everywhere else in the app.

interface AdminUser {
  id: string
  username: string
  display_name: string | null
  email: string | null
  balance: number
  eligible_for_current_season: boolean
  is_admin: boolean
  is_wildenroth: boolean
  is_wildenroth_ii: boolean
  deleted_at: string | null
  created_at: string
}

// Admin 3.0: von 5 auf 4 Hauptbereiche reduziert — "Verwaltung" und "Umfrage" sind keine
// eigenen Tabs mehr, sondern Kategorien im neuen Tab "Mehr" (siehe AdminShellNav.tsx).
type Tab = 'ergebnisse' | 'spieltag' | 'quoten' | 'mehr'

const TAB_VALUES: Tab[] = ['ergebnisse', 'spieltag', 'quoten', 'mehr']

const TAB_LABEL: Record<Tab, string> = { ergebnisse: 'Ergebnisse', spieltag: 'Spieltag', quoten: 'Quoten', mehr: 'Mehr' }
const TAB_DESC: Record<Tab, string> = {
  ergebnisse: 'Ergebnisse eintragen und Wetten abrechnen',
  spieltag: 'Cockpit, Spiele, Tipps, Topspiel, Torschützen',
  quoten: 'Neu berechnen, Vorschau, Quotenprüfung',
  mehr: 'Spieler, Kader, Umfrage, Statistik, System & Wartung',
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('ergebnisse')
  // Deep-link Spieltag für die "🎫 Neue Wette"-Push (siehe unten) — landet als
  // initiale Auswahl in SpieltagTabView, statt dass der Admin erst selbst den
  // betreffenden Spieltag suchen muss. null = keine Vorgabe (normales Öffnen).
  const [pushDeepLinkMatchday, setPushDeepLinkMatchday] = useState<number | null>(null)
  const confirm = useConfirm()

  // Deep-link support for the "🎫 Neue Wette" push notification — it opens
  // /admin?tab=spieltag(&matchday=N) so tapping it lands directly on the bets
  // view (optionally already on the right Spieltag) instead of the default
  // "Ergebnisse" tab. Read via plain URLSearchParams in an effect (not
  // useSearchParams()) since this page has no Suspense boundary and
  // useSearchParams() would require one. proxy.ts now forwards the full
  // ?tab=…&matchday=… query string through a login redirect too (it used to
  // keep only the pathname, silently dropping this deep link whenever the
  // admin's session had expired before tapping the notification).
  //
  // Admin 3.0, Punkt 13: ein älterer Deep-Link/Bookmark kann noch ?tab=verwaltung oder
  // ?tab=umfrage tragen (die 5-Tab-Struktur vor Admin 3.0) — diese zwei Namen bildet LEGACY_TAB
  // auf den neuen Tab "mehr" ab, statt den Link stillschweigend auf die Standardansicht
  // zurückfallen zu lassen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('tab')
    const LEGACY_TAB: Record<string, Tab> = { verwaltung: 'mehr', umfrage: 'mehr' }
    if (requested && requested in LEGACY_TAB) {
      setTab(LEGACY_TAB[requested])
    } else if (requested && (TAB_VALUES as string[]).includes(requested)) {
      setTab(requested as Tab)
    }
    const requestedMatchday = parseInt(params.get('matchday') ?? '', 10)
    if (Number.isFinite(requestedMatchday)) setPushDeepLinkMatchday(requestedMatchday)
  }, [])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [scores, setScores] = useState<Record<number, { home: string; away: string }>>({})
  // Cup-only manual settlement inputs (see app/api/admin/settle/route.ts) —
  // only ever read/sent for a match with competition_type='cup'.
  const [cupInputs, setCupInputs] = useState<Record<number, CupInput>>({})
  const [loading, setLoading] = useState(false)
  const [settleLoading, setSettleLoading] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [seasonResetLoading, setSeasonResetLoading] = useState(false)
  const [oddsLoading, setOddsLoading] = useState(false)
  // Zusätzlich zur globalen message-Leiste: bleibt stehen, auch wenn der Admin danach woanders
  // hinklickt (die globale Meldung verschwindet beim nächsten setMessage(null) andernorts) —
  // reine Anzeige desselben recalculateOdds()-Ergebnisses, keine zweite Berechnung.
  const [lastOddsRun, setLastOddsRun] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<OddsPreviewResponse | null>(null)
  const [previewMd, setPreviewMd] = useState<number | null>(null)
  const [playerSuggestions, setPlayerSuggestions] = useState<string[]>([])
  const [seasonStarted, setSeasonStarted] = useState(false)
  const [seasonToggleLoading, setSeasonToggleLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  // Cutoff for the "NEU" highlighting — deliberately NOT updated when the
  // admin marks users as seen (see markNewUsersSeen below), so the CURRENT
  // session keeps highlighting them; only a later reload picks up the new
  // cutoff. null means "never marked" — every non-admin user counts as new.
  const [newUsersSeenAt, setNewUsersSeenAt] = useState<string | null>(null)
  const [eligBalance, setEligBalance] = useState<Record<string, string>>({})
  const [pendingBetsByMatch, setPendingBetsByMatch] = useState<Record<number, number>>({})
  // Liga-/Spieltag-/Status-Filter und "weitere anzeigen" für den Ergebnisse-Tab leben jetzt
  // vollständig in ErgebnisseTabView (reiner Darstellungs-Zustand, nichts, was andere Tabs
  // oder Handler hier brauchen).
  // Scorer drafts for the inline "Ergebnis + Torschützen" entry on Wildenroth
  // matches in the Spieltag tab — keyed by matchId, mirrors the `scores` state
  // pattern below so both submit together from the same "Ergebnis & abrechnen".
  const [scorers, setScorers] = useState<Record<number, ScorerDraft[]>>({})
  // Verwaltung tab: Spieler-Verwaltung search filter (display_name/username)
  const [userSearch, setUserSearch] = useState('')
  // Verwaltung tab: Spieler-Verwaltung Chips-Filter — rein client-seitig über die bereits
  // geladenen `users`, keine eigene Abfrage.
  const [userFilter, setUserFilter] = useState<'alle' | 'neu' | 'gesperrt' | 'geloescht'>('alle')
  // Verwaltung tab: awards backfill button (Part A)
  const [awardsBackfillLoading, setAwardsBackfillLoading] = useState(false)

  const visibleUsers = users.filter((u) => {
    if (userFilter === 'neu' && (u.is_admin || (newUsersSeenAt && u.created_at <= newUsersSeenAt))) return false
    if (userFilter === 'gesperrt' && (u.deleted_at || u.eligible_for_current_season)) return false
    if (userFilter === 'geloescht' && !u.deleted_at) return false
    const q = userSearch.trim().toLowerCase()
    if (!q) return true
    return (u.display_name ?? '').toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
  })

  const supabase = createClient()

  // Effective-Spieltag index over the currently loaded matches — used to scope
  // the B-Klasse-Topspiel candidate list (B2), the "Bevorstehende Spiele"
  // default filter (B3), and the Torschützen section's default match (B4) to
  // the Spieltag the admin is actually working on, instead of a raw date
  // window or "always the season's first fixture".
  const mdIndex = useMemo(() => buildEffectiveMatchdayIndex(matches as unknown as Match[]), [matches])
  // The earliest Spieltag (in display order) that still has a match waiting to
  // be settled — i.e. "the Spieltag the admin is currently working on".
  // Deliberately NOT limited to Kreisliga: a Spieltag whose Kreisliga games are
  // done while its Wildenroth-II/Topspiel game follows the next evening still
  // needs its result entered, and restricting this to Kreisliga made the whole
  // admin area jump to the next Spieltag the moment the last Kreisliga match
  // finished. effectiveMatchdayOf returns null for a plain (non-Topspiel)
  // B-Klasse match, so those never pin a Spieltag open.
  // 'postponed' doesn't count as outstanding either — otherwise one indefinitely
  // postponed match would park the admin on an old Spieltag forever.
  const currentMatchday = useMemo(() => {
    for (const md of mdIndex.kreisligaMatchdaysDisplayOrder) {
      const hasUnsettled = matches.some((m) =>
        m.matchday !== 999 &&
        effectiveMatchdayOf(m as unknown as Match, mdIndex) === md &&
        m.status !== 'finished' &&
        m.status !== 'postponed' &&
        m.status !== 'annulled'
      )
      if (hasUnsettled) return md
    }
    return mdIndex.kreisligaMatchdaysDisplayOrder[mdIndex.kreisligaMatchdaysDisplayOrder.length - 1] ?? null
  }, [matches, mdIndex])

  const fetchSeasonData = useCallback(async () => {
    // Users go through /api/admin/users (service-role) — profiles.email isn't
    // readable via the session-scoped client at all, see CLAUDE.md.
    const [{ data: setting }, usersRes] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'season_started').single(),
      fetch('/api/admin/season'),
    ])
    setSeasonStarted(setting?.value === 'true')
    if (usersRes.ok) {
      const { users: fetchedUsers, newUsersSeenAt: seenAt } = await usersRes.json()
      setUsers((fetchedUsers ?? []) as AdminUser[])
      setNewUsersSeenAt(seenAt ?? null)
    }
  }, [supabase])

  // New-registration count since the admin last opened the Verwaltung tab —
  // drives the tab badge. Admins themselves never count as "new".
  const newUserCount = users.filter(u => !u.is_admin && (!newUsersSeenAt || u.created_at > newUsersSeenAt)).length

  // Marks the current moment as "seen" server-side (clears the badge from the
  // NEXT load onward) without touching `newUsersSeenAt` here, so this session
  // keeps showing the highlight the admin just opened the tab to look at.
  const markNewUsersSeen = useCallback(() => {
    if (newUserCount === 0) return
    fetch('/api/admin/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_new_users_seen' }),
    }).catch(() => {})
  }, [newUserCount])

  const fetchPendingCounts = useCallback(async () => {
    // Admin 3.0, Punkt 10: `.eq('status', 'pending')` zählt nicht als Einschränkung auf eine
    // Handvoll Zeilen (siehe CLAUDE.md zum 1000-Zeilen-Cap) — `bets` hat laut CLAUDE.md bereits
    // 1128+ Zeilen, ein unpaginiertes select() hier hätte die "offene Wetten"-Anzeige also
    // irgendwann silently zu niedrig gezeigt. fetchAllRows() seitet mit stabiler .order('id').
    const rows = await fetchAllRows<{ match_id: number | null }>((from, to) =>
      supabase.from('bets').select('match_id').eq('status', 'pending').order('id').range(from, to)
    )
    const counts: Record<number, number> = {}
    for (const b of rows) {
      if (b.match_id != null) counts[b.match_id] = (counts[b.match_id] ?? 0) + 1
    }
    setPendingBetsByMatch(counts)
  }, [supabase])

  useEffect(() => { fetchSeasonData(); fetchPendingCounts() }, [fetchSeasonData, fetchPendingCounts])

  useEffect(() => { if (tab === 'mehr') markNewUsersSeen() }, [tab, markNewUsersSeen])

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

  async function setUserWildenrothRole(userId: string, role: 'fan' | 'team1' | 'team2' | 'both') {
    setMessage(null)
    const res = await fetch('/api/admin/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_user_wildenroth_role', userId, role }),
    })
    if (res.ok) { setMessage('Rolle aktualisiert.'); fetchSeasonData() }
    else { const d = await res.json(); setMessage(`Fehler: ${d.error}`) }
  }

  // Soft-delete: account/profile stay intact (historische Wetten bleiben mit
  // Namen verknüpft), Login wird gesperrt, Nutzer verschwindet aus Rangliste
  // & Co. — bleibt aber hier in der Verwaltung sichtbar (mit Badge), damit
  // er jederzeit reaktiviert werden kann.
  async function deleteUser(userId: string, username: string) {
    if (!(await confirm({
      title: `${username} wirklich löschen?`,
      message: 'Login wird gesperrt, er verschwindet aus Rangliste & Kader. Historische Wetten bleiben erhalten, Reaktivieren ist jederzeit möglich.',
      confirmLabel: 'Löschen', tone: 'danger',
    }))) return
    setMessage(null)
    const res = await fetch('/api/admin/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'soft_delete_user', userId }),
    })
    if (res.ok) { setMessage(`${username} gelöscht.`); fetchSeasonData() }
    else { const d = await res.json(); setMessage(`Fehler: ${d.error}`) }
  }

  async function restoreUser(userId: string, username: string) {
    setMessage(null)
    const res = await fetch('/api/admin/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore_user', userId }),
    })
    if (res.ok) { setMessage(`${username} reaktiviert.`); fetchSeasonData() }
    else { const d = await res.json(); setMessage(`Fehler: ${d.error}`) }
  }

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('matches')
      .select(
        `id, match_number, matchday, match_date, status, home_score, away_score, match_category, is_topspiel, competition_type, tippspiel_matchday,
         home_team:teams!matches_home_team_id_fkey(name, short_name),
         away_team:teams!matches_away_team_id_fkey(name, short_name)`
      )
      .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
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

  function handleScorersChange(matchId: number, draft: ScorerDraft[]) {
    setScorers((prev) => ({ ...prev, [matchId]: draft }))
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

    const match = matches.find(m => m.id === matchId)
    const cup = cupInputs[matchId]
    if (match?.competition_type === 'cup' && homeScore === awayScore && !cup?.shootoutWinner) {
      setMessage('Unentschieden nach 90 Minuten — bitte zuerst den Elfmeterschießen-Sieger angeben.')
      return
    }
    if (match?.competition_type === 'cup' && (cup?.halftimeHome === '' || cup?.halftimeHome == null || cup?.halftimeAway === '' || cup?.halftimeAway == null)) {
      setMessage('Bitte zuerst den Halbzeitstand angeben (für „Wildenroth führt zur Halbzeit & kommt weiter“).')
      return
    }
    if (match?.competition_type === 'cup' && !cup?.awayTeamLed) {
      setMessage('Bitte zuerst angeben, ob Geiselbullach im Spielverlauf in Führung war.')
      return
    }
    if (
      match?.competition_type === 'cup' && (homeScore > 0 || awayScore > 0) &&
      (cup?.firstGoalMinute === '' || cup?.firstGoalMinute == null || isNaN(parseInt(cup.firstGoalMinute)))
    ) {
      setMessage('Bitte zuerst die Minute des ersten Tores angeben (für „Frühes Tor Min. 1-15“).')
      return
    }

    setSettleLoading(matchId)
    setMessage(null)

    const res = await fetch('/api/admin/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId, homeScore, awayScore,
        ...(match?.competition_type === 'cup' ? {
          cupShootoutWinner: cup?.shootoutWinner || null,
          cupFirstGoalTeam: cup?.firstGoalTeam || null,
          cupFirstGoalMinute: cup?.firstGoalMinute !== '' && cup?.firstGoalMinute != null ? parseInt(cup.firstGoalMinute) : null,
          cupHalftimeHomeGoals: cup?.halftimeHome !== '' ? parseInt(cup?.halftimeHome ?? '') : null,
          cupHalftimeAwayGoals: cup?.halftimeAway !== '' ? parseInt(cup?.halftimeAway ?? '') : null,
          cupAwayTeamLed: cup?.awayTeamLed === 'yes' ? true : cup?.awayTeamLed === 'no' ? false : null,
        } : {}),
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setSettleLoading(null)
      setMessage(`Fehler: ${data.error}`)
      return
    }

    let msg = `Spiel abgerechnet! ${data.settled} Wette(n) bearbeitet, ${data.combosChecked} Kombi(s) geprüft.`

    // Wildenroth match with scorers entered inline: submit them right after
    // settlement, in the same click — see ScorerDraft/handleScorersChange
    // above. Skips silently if none were entered (own-goal-only 0:0 etc. is
    // valid; the admin just leaves the list empty).
    const draft = (scorers[matchId] ?? []).filter(s => s.playerId)
    if (draft.length > 0) {
      const gsRes = await fetch('/api/admin/goalscorers/scorers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, scorers: draft }),
      })
      const gsData = await gsRes.json()
      if (gsRes.ok) {
        msg += ` Torschützen gespeichert · ${gsData.settled} Wette(n) abgerechnet, ${gsData.combosChecked} Kombi(s) geprüft.`
        setScorers((prev) => { const n = { ...prev }; delete n[matchId]; return n })
      } else {
        msg += ` Fehler bei Torschützen: ${gsData.error}`
      }
    }

    setSettleLoading(null)
    setMessage(msg)
    fetchMatches()
  }

  // Marks/unmarks a B-Klasse match as the admin-selected weekly Topspiel — the one
  // extra B-Klasse match that becomes bettable on the Tippspiel-Spieltag its date
  // falls into. Admin is responsible for only flagging one match per week.
  async function toggleTopspiel(matchId: number, value: boolean) {
    // Admin 3.0, Punkt 9: über eine Admin-API statt direkt per Session-Client, damit die
    // Topspiel-Auswahl zuverlässig ins Audit-Log kann (app/api/admin/topspiel/route.ts) —
    // dieselbe Mutation, nur serverseitig protokolliert statt rein clientseitig.
    const res = await fetch('/api/admin/topspiel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMessage(`Fehler: ${data.error ?? 'Topspiel-Auswahl fehlgeschlagen'}`)
      return
    }
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, is_topspiel: value } : m))
  }

  async function recalculateOdds() {
    setOddsLoading(true)
    setMessage(null)
    const res = await fetch('/api/admin/odds', { method: 'POST' })
    const data = await res.json()
    setOddsLoading(false)
    if (res.ok) {
      const frozenNote = data.skippedFrozen > 0 ? ` (${data.skippedFrozen} bereits eingefroren, übersprungen)` : ''
      const msg = `Quoten berechnet: ${data.updated}/${data.total} Spiele aktualisiert.${frozenNote}`
      setMessage(msg)
      setLastOddsRun(`${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr – ${msg}`)
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  async function backfillAwards() {
    setAwardsBackfillLoading(true)
    setMessage(null)
    const res = await fetch('/api/admin/awards/backfill', { method: 'POST' })
    const data = await res.json()
    setAwardsBackfillLoading(false)
    if (res.ok) {
      setMessage(`Awards rückwirkend berechnet: ${data.processedMatchdays.length} Spieltage, ${data.totalAwardsWritten} Auszeichnungen geschrieben.`)
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  async function resetSeasonBalances() {
    // Admin 3.0, Punkt 11: Saison-Reset ist unwiderruflich — verlangt jetzt eine bewusst
    // eingetippte Bestätigung statt nur eines Tastendrucks (requireText, components/admin/ui.tsx).
    if (!(await confirm({
      title: 'Alle Guthaben auf 1.000 Wildis zurücksetzen?',
      message: 'Das kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Zurücksetzen', tone: 'danger', requireText: 'ZURÜCKSETZEN',
    }))) return
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

  // Kreisliga defines the Tippspiel-Spieltag structure (lib/season.ts) — the
  // filter must group EVERY match, including Wildenroth II and B-Klasse, by
  // that same effective Spieltag (date-based), not each category's own raw
  // `matchday` column. Wildenroth II/Topspiel-flagged B-Klasse matches run on
  // independent BFV numbering that only coincidentally overlaps Kreisliga's,
  // and plain (non-Topspiel) B-Klasse matches have no Spieltag of their own
  // at all — comparing raw `matchday` values previously showed unrelated
  // B-Klasse fixtures under a given "Spieltag N".
  function matchdayForFilter(m: MatchRow): number | null {
    // `tippspiel_matchday` is the club's hand-set date-block override — every
    // Wildenroth-II/B-Klasse match currently carries one (fixed ahead of
    // go-live), and it's more authoritative than a date-nearest heuristic
    // when present. effectiveMatchdayOf only reads it for Kreisliga/
    // Wildenroth-II/flagged-Topspiel matches (see lib/season.ts), so check it
    // directly here first to also cover plain (non-Topspiel) B-Klasse matches.
    if (m.tippspiel_matchday != null) return m.tippspiel_matchday
    const eff = effectiveMatchdayOf(m as unknown as Match, mdIndex)
    if (eff != null) return eff
    return nearestMatchdayByDate(new Date(m.match_date).getTime(), mdIndex)
  }
  // Liga-/Spieltag-Filterung und die Aufteilung in ausstehend/bevorstehend/verschoben/
  // abgerechnet passiert jetzt in ErgebnisseTabView, auf denselben `matches` — siehe dort.

  /** Schreibt ein einzelnes Pokal-Zusatzfeld für ein Spiel, wie zuvor inline im JSX. */
  function handleCupInputChange(matchId: number, field: keyof CupInput, val: string) {
    setCupInputs(prev => ({ ...prev, [matchId]: { ...(prev[matchId] ?? EMPTY_CUP), [field]: val } }))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-red-700 text-white px-4 py-4 shadow-lg">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center overflow-hidden shrink-0">
              <Image src="/crests/spvgg-wildenroth.png" alt="" width={28} height={28} className="w-7 h-7 object-contain" />
            </div>
            <div>
              <h1 className="font-display text-xl font-extrabold uppercase tracking-wide leading-5">Admin Panel</h1>
              <p className="text-red-200 text-xs">Wildenroth Tippspiel</p>
            </div>
          </div>
        </div>
      </div>

      {/* Echtes Grundgerüst: Desktop feste Seitenleiste + breiterer Arbeitsbereich,
          mobil feste Tab-Leiste unten (beides in AdminShellNav) statt einer einzigen
          Zeile für alle Breiten. */}
      <div className="mx-auto max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 lg:flex lg:max-w-7xl lg:gap-8 lg:pb-12 lg:pt-6">
        <AdminShellNav tab={tab} onTabChange={setTab} newUserCount={newUserCount} />

        <div className="min-w-0 flex-1">
          <header className="mb-4 hidden lg:block">
            <h2 className="font-display text-[30px] font-extrabold uppercase leading-8 tracking-wide text-gray-900">{TAB_LABEL[tab]}</h2>
            <p className="text-[14px] text-gray-600">{TAB_DESC[tab]}</p>
          </header>
          <p className="mb-4 px-1 text-[12px] text-gray-500 lg:hidden">{TAB_DESC[tab]}</p>

          {/* Message */}
          {message && (
            <div
              className={cx(
                'mb-4 flex items-start gap-2 px-4 py-3 rounded-xl text-sm font-medium border',
                message.startsWith('Fehler')
                  ? 'bg-red-50 text-red-700 border-red-100'
                  : 'bg-green-50 text-green-700 border-green-100'
              )}
            >
              <span aria-hidden className="mt-0.5">{message.startsWith('Fehler') ? '⚠' : '✓'}</span>
              <span className="min-w-0 flex-1">{message}</span>
              <button onClick={() => setMessage(null)} aria-label="Meldung schließen" className="opacity-60 hover:opacity-100">
                ✕
              </button>
            </div>
          )}

        {/* Ergebnisse Tab — result entry is the admin's most frequent daily
            action, so it gets its own tab up front instead of being buried
            below the Tipps overview and B-Klasse-Topspiel picker. Visuelle
            Darstellung lebt in ErgebnisseTabView; alle Daten/Handler kommen
            von hier, wie bisher. */}
        {tab === 'ergebnisse' && (
          <ErgebnisseTabView
            matches={matches}
            loading={loading}
            mdIndex={mdIndex}
            currentMatchday={currentMatchday}
            pendingByMatch={pendingBetsByMatch}
            matchdayForFilter={matchdayForFilter}
            playerSuggestions={playerSuggestions}
            scores={scores}
            onScoreChange={handleScoreChange}
            cupInputs={cupInputs}
            onCupInputChange={handleCupInputChange}
            onSettle={settleMatch}
            onPostpone={postponeMatch}
            settleLoading={settleLoading}
            scorers={scorers}
            onScorersChange={handleScorersChange}
            onMessage={setMessage}
            onRescheduled={fetchMatches}
          />
        )}

        {/* Spieltag Tab */}
        {tab === 'spieltag' && (
          <SpieltagTabView
            matches={matches}
            mdIndex={mdIndex}
            currentMatchday={currentMatchday}
            pendingByMatch={pendingBetsByMatch}
            matchdayForFilter={matchdayForFilter}
            onToggleTopspiel={toggleTopspiel}
            onMessage={setMessage}
            initialMatchday={pushDeepLinkMatchday}
          />
        )}

        {/* Quoten Tab — Torschützen zog nach Spieltag um (siehe SpieltagTabView, Abschnitt
            sp-torschuetzen); das Modell selbst (lib/odds.ts, lib/oddsMarkets.ts) bleibt hier wie
            überall nur AUFGERUFEN, nie verändert. */}
        {tab === 'quoten' && (
          <div className="space-y-4">
            <Section id="qu-berechnung" title="Quoten neu berechnen" subtitle="Alle noch nicht eingefrorenen Spiele aus den Saisondaten neu rechnen" defaultOpen>
              <div className="space-y-3">
                <p className="text-[14px] leading-6 text-gray-700">
                  Quoten werden automatisch aus Kopf-an-Kopf-Statistiken und Saisonleistungen berechnet (Hausmarge 10%). Sobald das Wettfenster eines Spieltags geöffnet ist, werden seine Quoten eingefroren und nicht mehr neu berechnet.
                </p>
                <Btn variant="primary" block loading={oddsLoading} onClick={recalculateOdds}>{oddsLoading ? 'Berechne …' : 'Quoten neu berechnen'}</Btn>
                {lastOddsRun && <Notice tone="success">Zuletzt: {lastOddsRun}</Notice>}
              </div>
            </Section>

            <div id="qu-vorschau" className="scroll-mt-24">
              <Panel className="p-4">
                <OddsPreviewSection
                  preview={preview}
                  loading={previewLoading}
                  selectedMd={previewMd}
                  onSelectMd={(md) => { setPreviewMd(md); loadPreview(md) }}
                  onReload={() => loadPreview(previewMd)}
                  onMessage={setMessage}
                />
              </Panel>
            </div>
          </div>
        )}

        {/* "Mehr" Tab (Admin 3.0) — Verwaltung + Umfrage sind keine eigenen Tabs mehr, sondern
            5 Kategorien hier (CategoryGroup, components/admin/ui.tsx). Bonus-Tipps/Specials sind
            nach Spieltag umgezogen (siehe dort) — hier bewusst nicht mehr dupliziert. */}
        {tab === 'mehr' && (
          <div className="space-y-3">

            <CategoryGroup id="mh-spieler" title="Spieler & Mitglieder" subtitle="Accounts: Rolle, Guthaben, Berechtigung, Löschen/Reaktivieren" defaultOpen
              badge={newUserCount > 0 ? <Pill tone="success">{newUserCount} neu</Pill> : <Pill tone="neutral">{users.length}</Pill>}>
              <Section id="vw-spieler" title="Spieler verwalten" subtitle="Registrierungen, Berechtigungen, Guthaben, Accounts" defaultOpen>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Suche nach Name…"
                    className={inputCls}
                  />
                  <Chips value={userFilter} onChange={setUserFilter} label="Spieler filtern" items={[
                    { value: 'alle', label: `Alle · ${users.length}` },
                    { value: 'neu', label: `Neu · ${newUserCount}` },
                    { value: 'gesperrt', label: `Nicht berechtigt · ${users.filter((u) => !u.deleted_at && !u.eligible_for_current_season).length}` },
                    { value: 'geloescht', label: `Gelöscht · ${users.filter((u) => u.deleted_at).length}` },
                  ]} />
                  {users.length === 0 && <EmptyNote>Keine Spieler geladen.</EmptyNote>}
                  {users.length > 0 && visibleUsers.length === 0 && <EmptyNote>Keine Treffer{userSearch ? ` für „${userSearch}“` : ' für diesen Filter'}.</EmptyNote>}
                  <div className="grid gap-3 lg:grid-cols-2">
                    {visibleUsers.map((u) => (
                      <UserCard
                        key={u.id}
                        u={u}
                        isNew={!u.is_admin && (!newUsersSeenAt || u.created_at > newUsersSeenAt)}
                        balance={eligBalance[u.id] ?? ''}
                        onBalanceChange={(v) => setEligBalance((prev) => ({ ...prev, [u.id]: v }))}
                        onRole={(role) => setUserWildenrothRole(u.id, role)}
                        onEligible={() => {
                          const raw = eligBalance[u.id]
                          const bal = raw != null && raw !== '' ? parseFloat(raw) : undefined
                          setUserEligible(u.id, !u.eligible_for_current_season, bal)
                        }}
                        onDelete={() => deleteUser(u.id, u.display_name || u.username)}
                        onRestore={() => restoreUser(u.id, u.display_name || u.username)}
                      />
                    ))}
                  </div>
                </div>
              </Section>
            </CategoryGroup>

            <CategoryGroup id="mh-kader" title="Kader & Transfers" subtitle="Kaderdaten, Transfers, Spielerstatus (reale Roster-Daten)">
              <Section id="vw-kader" title="Kader verwalten" subtitle="Spieler, Transfers, Kaderinformationen" defaultOpen>
                <KaderSection onMessage={setMessage} />
              </Section>
            </CategoryGroup>

            <CategoryGroup id="mh-umfrage" title="Umfrage" subtitle="Teilnahme, Auswertungen, Einzelantworten, Einstellungen">
              <SurveyTab onMessage={setMessage} />
            </CategoryGroup>

            <CategoryGroup id="mh-statistik" title="Statistik" subtitle="Beteiligung je Spieltag, Wettzeiten nach Uhrzeit & Wochentag">
              <StatsTab onMessage={setMessage} />
            </CategoryGroup>

            <CategoryGroup id="mh-system" title="System & Wartung" subtitle="Saison, Push, Tests, Awards — seltene und gefährliche Aktionen">
              <Section id="vw-saison" title="Saisonstart-Flag" subtitle="Steuert, ob neue Nutzer manuell freigeschaltet werden müssen" defaultOpen
                badge={seasonStarted ? <Pill tone="success">gestartet</Pill> : <Pill tone="neutral">nicht gestartet</Pill>}>
                <div className="flex flex-col gap-3 rounded-xl bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[15px] font-bold text-gray-900">Saisonstart</div>
                    <div className="text-[13px] text-gray-600">
                      {seasonStarted ? <span className="font-medium text-green-600">Gestartet</span> : <span className="text-gray-500">Nicht gestartet</span>}
                      {' '}· neue Nutzer brauchen manuelle Freischaltung
                    </div>
                  </div>
                  <Btn variant={seasonStarted ? 'secondary' : 'primary'} loading={seasonToggleLoading} onClick={() => toggleSeasonStarted(!seasonStarted)}>
                    {seasonStarted ? 'Flag entfernen' : 'Saison starten'}
                  </Btn>
                </div>
              </Section>

              <Section id="vw-season-reset" title="Saison-Reset" subtitle="Gefahrenzone — unwiderruflich" tone="critical">
                <div className="space-y-3">
                  <p className="text-[14px] leading-6 text-red-900">
                    Setzt <b>alle Guthaben auf 1.000 Wildis</b> zurück. Bisherige Wetten bleiben als Saison 25/26 erhalten.
                    Verlangt eine bewusst eingetippte Bestätigung, bevor etwas passiert.
                  </p>
                  <Btn variant="danger" block loading={seasonResetLoading} onClick={resetSeasonBalances}>
                    {seasonResetLoading ? 'Wird zurückgesetzt …' : 'Alle Guthaben auf 1.000 Wildis zurücksetzen'}
                  </Btn>
                </div>
              </Section>

              <Section id="vw-sonstiges" title="Push, Test-Spieltag, Awards" subtitle="Push-Benachrichtigungen, Test-Spieltag 999, Awards-Backfill">
                <div className="space-y-4">
                  <AdminPushTab onMessage={setMessage} />
                  <TestMatchdayPanel />
                  <Panel className="space-y-3 p-4">
                    <h4 className="text-[16px] font-bold text-gray-900">Awards rückwirkend berechnen</h4>
                    <p className="text-[14px] leading-6 text-gray-700">
                      Berechnet alle Pokal-Kategorien (inkl. der 3 neuen: Großer Wurf, Torschützen-König, Zocker des
                      Spieltags) für jeden bereits abgerechneten Spieltag der aktuellen Saison neu. Gefahrlos wiederholbar.
                    </p>
                    <Btn variant="primary" block loading={awardsBackfillLoading} onClick={backfillAwards}>
                      {awardsBackfillLoading ? 'Wird berechnet …' : 'Awards rückwirkend berechnen (inkl. 3 neue Kategorien)'}
                    </Btn>
                  </Panel>
                </div>
              </Section>

              <Section id="vw-audit" title="Änderungshistorie" subtitle="Protokoll sicherheitsrelevanter Admin-Aktionen">
                <AuditLogPanel />
              </Section>
            </CategoryGroup>

          </div>
        )}
        </div>
      </div>
    </div>
  )
}

/** Collapsible, visually-separated section wrapper for the Verwaltung tab
 *  (B6) — groups related admin actions under a clear heading instead of one
 *  long flat stack. */
type WRole = 'fan' | 'team1' | 'team2' | 'both'
const WROLE_LABEL: Record<WRole, string> = { fan: 'Fan', team1: '1. Mannschaft', team2: '2. Mannschaft', both: 'Beide Mannschaften' }
const wroleOf = (u: AdminUser): WRole => (u.is_wildenroth && u.is_wildenroth_ii ? 'both' : u.is_wildenroth ? 'team1' : u.is_wildenroth_ii ? 'team2' : 'fan')

/** Visuelle Übernahme aus dem alten, verworfenen Admin-Redesign (dort components/admin/
 *  VerwaltungTab.tsx#UserCard) — die 5 Handler bleiben die bestehenden, unveränderten
 *  Funktionen aus AdminPage (kein `confirm()` wurde hier neu hinzugefügt: das alte Redesign
 *  bestätigt Rollenwechsel/Freischalten zusätzlich, was eine Verhaltensänderung wäre und laut
 *  Vorgabe nicht ungeprüft mit der Design-Modernisierung vermischt werden soll — `deleteUser`
 *  bestätigt bereits heute, das bleibt unverändert). */
function UserCard({ u, isNew, balance, onBalanceChange, onRole, onEligible, onDelete, onRestore }: {
  u: AdminUser; isNew: boolean; balance: string
  onBalanceChange: (v: string) => void
  onRole: (role: WRole) => void
  onEligible: () => void
  onDelete: () => void
  onRestore: () => void
}) {
  return (
    <Panel as="article" tone={u.deleted_at ? 'critical' : u.eligible_for_current_season ? undefined : 'open'} className={`space-y-3 p-4 ${u.deleted_at ? 'opacity-90' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <h4 className="min-w-0 break-words text-[17px] font-bold leading-tight text-gray-900">{u.display_name || u.username}</h4>
        {isNew && <Pill tone="success">NEU</Pill>}
        {u.is_admin && <Pill tone="info">Admin</Pill>}
        {u.deleted_at && <Pill tone="critical">Gelöscht</Pill>}
        {u.is_wildenroth && u.is_wildenroth_ii && <Pill tone="neutral">⚽ Beide</Pill>}
        {u.is_wildenroth && !u.is_wildenroth_ii && <Pill tone="neutral">⚽ 1</Pill>}
        {!u.is_wildenroth && u.is_wildenroth_ii && <Pill tone="neutral">⚽ 2</Pill>}
      </div>
      {u.email && <div className="break-all text-[13px] text-gray-600">{u.email}</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
        <span className="font-semibold tabular-nums text-gray-900">{u.balance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} {wl(u.balance)}</span>
        {u.eligible_for_current_season ? <Pill tone="success">berechtigt</Pill> : <Pill tone="open">nicht berechtigt</Pill>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Btn variant={u.eligible_for_current_season ? 'secondary' : 'success'} onClick={onEligible}>
          {u.eligible_for_current_season ? 'Sperren' : 'Freischalten'}
        </Btn>
        {u.deleted_at
          ? <Btn variant="secondary" onClick={onRestore}>Reaktivieren</Btn>
          : <Btn variant="danger" onClick={onDelete}>Löschen</Btn>}
      </div>

      <details className="group rounded-xl border border-gray-200">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-[14px] font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
          Rolle &amp; Guthaben · {WROLE_LABEL[wroleOf(u)]}
          <svg className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </summary>
        <div className="space-y-3 border-t border-gray-200 p-3">
          <Field label="Rolle (Wildenroth-Zugehörigkeit)">
            <select value={wroleOf(u)} onChange={(e) => onRole(e.target.value as WRole)} className={selectCls}>
              {(Object.keys(WROLE_LABEL) as WRole[]).map((r) => <option key={r} value={r}>{WROLE_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field label="Guthaben setzen (optional)" hint="Wird beim nächsten Freischalten/Sperren dieses Spielers gesetzt. Leer = unverändert.">
            <input type="number" inputMode="decimal" placeholder="z. B. 1000" value={balance} onChange={(e) => onBalanceChange(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </details>
    </Panel>
  )
}

/** `onMessage` ersetzt die frühere eigene `message`-Mini-Leiste (immer grau, kein Unterschied
 *  zwischen Erfolg und Fehler) — läuft jetzt über dieselbe globale Banner-Stelle wie überall
 *  sonst im Admin-Bereich. `loadStats`s fehlender else-Zweig (Netzwerk-/Serverfehler beim ersten
 *  Laden blieben bisher komplett unsichtbar — "Fehler beim Laden" nur bei explizitem !stats,
 *  was nie den eigentlichen Grund nannte) ist jetzt auch über `onMessage` sichtbar. */
function AdminPushTab({ onMessage }: { onMessage: (m: string | null) => void }) {
  const [stats, setStats] = useState<{
    totalEligibleUsers: number
    usersWithPushEnabled: number
    activeSubscriptions: number
    enablementRate: string | number
    recentErrors: Array<{ category: string; title: string; error_message: string | null }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [testLoading, setTestLoading] = useState(false)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    setLoading(true)
    setLoadError(false)
    const res = await fetch('/api/push/test')
    if (res.ok) {
      const data = await res.json()
      setStats(data.pushOverview)
    } else {
      setLoadError(true)
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
      onMessage('Test-Push gesendet.')
    } else {
      const err = await res.json().catch(() => ({}))
      onMessage(`Fehler: ${err.error ?? 'Test-Push fehlgeschlagen'}`)
    }
  }

  if (loading) return <Panel className="p-4"><LoadingBlock label="Push-Statistik wird geladen …" /></Panel>

  if (!stats) return (
    <Panel tone="critical" className="space-y-2 p-4">
      <h4 className="text-[16px] font-bold text-gray-900">Push-Benachrichtigungen</h4>
      <Notice tone="critical" action={<Btn size="sm" onClick={loadStats}>Erneut laden</Btn>}>
        {loadError ? 'Statistik konnte nicht geladen werden.' : 'Unbekannter Fehler beim Laden.'}
      </Notice>
    </Panel>
  )

  return (
    <Panel className="space-y-3 p-4">
      <h4 className="text-[16px] font-bold text-gray-900">Push-Benachrichtigungen</h4>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-center">
          <div className="text-xl font-black text-sky-700">{stats.usersWithPushEnabled}</div>
          <div className="text-[11px] leading-tight font-semibold text-sky-800">Push aktiv</div>
        </div>
        <div className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-center">
          <div className="text-xl font-black text-green-700">{stats.activeSubscriptions}</div>
          <div className="text-[11px] leading-tight font-semibold text-green-800">Subscriptions</div>
        </div>
        <div className="rounded-xl border border-purple-100 bg-purple-50 px-3 py-2 text-center">
          <div className="text-xl font-black text-purple-700">
            {typeof stats.enablementRate === 'string' ? stats.enablementRate : stats.enablementRate.toFixed(0)}%
          </div>
          <div className="text-[11px] leading-tight font-semibold text-purple-800">Aktiviert</div>
        </div>
      </div>

      <Btn variant="primary" block loading={testLoading} onClick={sendTestToMe}>
        {testLoading ? 'Wird gesendet …' : '🧪 Test-Push an mich'}
      </Btn>
      <p className="text-[12px] text-gray-500">
        Sendet eine echte Push-Benachrichtigung an dein eigenes Gerät — kein simulierter Versand.
      </p>

      {stats.recentErrors && stats.recentErrors.length > 0 && (
        <Notice tone="critical">
          <div className="mb-1 font-semibold">Letzte Fehler</div>
          <div className="space-y-1 text-[13px]">
            {stats.recentErrors.slice(0, 3).map((err, i) => (
              <div key={i} className="line-clamp-1">
                <strong>{err.title}:</strong> {err.error_message}
              </div>
            ))}
          </div>
        </Notice>
      )}

      <p className="text-[12px] text-gray-500">
        <strong>Scheduler:</strong> GitHub Actions läuft alle 30 Min (:07 und :37) — Haupt-Scheduler. Vercel Cron (täglich 08:00 UTC) ist nur Fallback.
      </p>
    </Panel>
  )
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
  hdp_away_minus_1_5: number; hdp_home_plus_1_5: number
  hdp_away_minus_2_5: number; hdp_home_plus_2_5: number
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
  // Full 0-6 per side AUTO grid (unfiltered by the MAX_EXACT_ODDS offer cutoff)
  // — lets the editor override any relevant score. What's actually offered to
  // bettors is derived client-side via mergeExactScoreOffers (auto + override,
  // filtered to MAX_EXACT_ODDS only).
  exact_scores: { score: string; odds: number }[]
  // Wildenroth handicap-perspective override (see lib/oddsMarkets.ts) — null
  // when the normal favourite-based rule applies (no Wildenroth side, or
  // before that team's Spieltag cutover), true/false forces that side.
  handicapForceHomeSide: boolean | null
  // Punkt 8 (Admin 3.0): rein lesende Hinweise, vom Server schon aus `odds`+`diagnostics`
  // berechnet (lib/oddsAnomalies.ts) — nie leer/erfunden, nie eine Quotenänderung.
  anomalies: OddsAnomaly[]
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


type OverrideRow = {
  match_id: number
  exact_score_overrides?: Record<string, number> | null
} & Record<string, number | null | Record<string, number> | undefined>
type OverrideValues = Record<string, number | null> & { exact_score_overrides?: Record<string, number> | null }

function OddsPreviewSection({
  preview, loading, selectedMd, onSelectMd, onReload, onMessage,
}: {
  preview: OddsPreviewResponse | null
  loading: boolean
  selectedMd: number | null
  onSelectMd: (md: number) => void
  onReload: () => void
  /** Ersetzt die frühere eigene `overrideMsg`-Mini-Leiste — dieselbe Meldung läuft jetzt über
   *  dieselbe globale Banner-Stelle wie überall sonst im Admin-Bereich. */
  onMessage: (m: string | null) => void
}) {
  const [overrides, setOverrides] = useState<Record<number, OverrideRow>>({})
  const [overridesError, setOverridesError] = useState<string | null>(null)

  const matchday = selectedMd ?? preview?.matchday

  // Load overrides when matchday changes
  useEffect(() => {
    if (!matchday) return
    setOverridesError(null)
    fetch(`/api/admin/odds/overrides?matchday=${matchday}`)
      .then(r => r.json())
      .then(data => {
        const map: Record<number, OverrideRow> = {}
        for (const ov of data.overrides ?? []) map[ov.match_id] = ov
        setOverrides(map)
      })
      // Vorher kein .catch() — ein Netzwerkfehler blieb unsichtbar, Overrides schienen leer.
      .catch(() => setOverridesError('Überschreibungen konnten nicht geladen werden.'))
  }, [matchday])

  async function saveOverride(matchId: number, values: OverrideValues) {
    const res = await fetch('/api/admin/odds/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, values }),
    })
    const data = await res.json()
    if (res.ok) {
      setOverrides(prev => ({ ...prev, [matchId]: { match_id: matchId, ...values } }))
      onMessage('Überschreibung gespeichert.')
      onReload()
    } else {
      onMessage(`Fehler: ${data.error}`)
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
      onMessage('Überschreibung zurückgesetzt.')
      onReload()
    } else {
      // Vorher kein else-Zweig — ein fehlgeschlagenes Zurücksetzen blieb unsichtbar, die
      // Überschreibung stand scheinbar unverändert weiter.
      const data = await res.json().catch(() => ({}))
      onMessage(`Fehler: ${data.error ?? 'Zurücksetzen fehlgeschlagen'}`)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900">Quoten-Vorschau</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Berechnete Quoten · gelb = manuell überschrieben
          </p>
        </div>
        <Btn size="sm" variant="secondary" onClick={onReload} disabled={loading}>{loading ? '…' : 'Neu laden'}</Btn>
      </div>

      {overridesError && <Notice tone="critical" action={<Btn size="sm" onClick={onReload}>Erneut laden</Btn>}>{overridesError}</Notice>}

      {preview?.matchdays && preview.matchdays.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
          <Notice tone="open">
            <div className="font-semibold">
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
          </Notice>

          {/* Punkt 8 (Admin 3.0): reine Hinweis-Übersicht, keine Quotenänderung — siehe
              lib/oddsAnomalies.ts. Jede Zeile verlinkt per Anker auf die betroffene Karte
              unten (scroll-mt-24 auf der Karte selbst sorgt für die Höhe der Sticky-Leiste). */}
          <div id="qu-warnungen" className="scroll-mt-24">
            {(() => {
              const flagged = preview.matches.filter((m) => m.anomalies.length > 0)
              return (
                <Section
                  title="Quotenprüfung"
                  subtitle={`Spieltag ${preview.matchday} — rein informative Hinweise, keine automatische Änderung`}
                  badge={flagged.length > 0 ? <Pill tone="open">{flagged.length}</Pill> : <Pill tone="success">0</Pill>}
                  defaultOpen={flagged.length > 0}
                >
                  {flagged.length === 0 ? (
                    <EmptyNote>Keine Auffälligkeiten erkannt.</EmptyNote>
                  ) : (
                    <ul className="space-y-2">
                      {flagged.map((m) => (
                        <li key={m.match_id}>
                          <a href={`#qu-match-${m.match_id}`} className="block rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 hover:bg-amber-100">
                            <div className="text-[14px] font-semibold text-gray-900">{m.home_team} – {m.away_team}</div>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-amber-900">
                              {m.anomalies.map((a, i) => <li key={i}>{a.reason}</li>)}
                            </ul>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )
            })()}
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
    // Ü/U 7,5 is retired — not offered to bettors, so no override control for it.
    { col: 'over_5_5', label: 'Ü5,5' }, { col: 'under_5_5', label: 'U5,5' },
  ],
  [
    { col: 'btts_yes', label: 'BTTS Ja' }, { col: 'btts_no', label: 'BTTS Nein' },
  ],
  [
    { col: 'hdp_home_minus_1_5', label: 'H-1,5' }, { col: 'hdp_away_plus_1_5', label: 'G+1,5' },
    { col: 'hdp_home_minus_2_5', label: 'H-2,5' }, { col: 'hdp_away_plus_2_5', label: 'G+2,5' },
  ],
  [
    // Mirrored (away-favoured) direction — only ONE direction is actually
    // offered per match (see lib/oddsMarkets.ts#homeHandicapFavored), but
    // both are always computed/storable so the admin can override either.
    { col: 'hdp_away_minus_1_5', label: 'G-1,5' }, { col: 'hdp_home_plus_1_5', label: 'H+1,5' },
    { col: 'hdp_away_minus_2_5', label: 'G-2,5' }, { col: 'hdp_home_plus_2_5', label: 'H+2,5' },
  ],
]

function OddsPreviewMatchCard({
  match, override, onSave, onReset,
}: {
  match: OddsPreviewMatch
  override: OverrideRow | null
  onSave: (values: OverrideValues) => Promise<void>
  onReset: () => Promise<void>
}) {
  const confirm = useConfirm()
  const o = match.odds
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Ersetzt die beiden früheren alert()-Aufrufe in handleSave — Validierungsfehler laufen
  // jetzt wie überall sonst im Admin-Bereich über eine lokale <Notice>, nicht über einen
  // blockierenden Browser-Dialog (der auf iPhone zudem schlecht lesbar abschneidet).
  const [formError, setFormError] = useState<string | null>(null)
  const allFields = OVERRIDE_FIELDS.flat()
  const initDraft = () => Object.fromEntries(
    allFields.map(f => [f.col, override?.[f.col] != null ? String(override[f.col]) : ''])
  )
  const [draft, setDraft] = useState<Record<string, string>>(initDraft)
  const initExactDraft = () => Object.fromEntries(
    match.exact_scores.map(es => [es.score, override?.exact_score_overrides?.[es.score] != null ? String(override.exact_score_overrides[es.score]) : ''])
  )
  const [exactDraft, setExactDraft] = useState<Record<string, string>>(initExactDraft)

  const hasOverride = override != null && (
    allFields.some(f => override[f.col] != null) ||
    (override.exact_score_overrides != null && Object.keys(override.exact_score_overrides).length > 0)
  )

  function openEdit() {
    setDraft(initDraft())
    setExactDraft(initExactDraft())
    setFormError(null)
    setEditing(true)
  }

  async function handleSave() {
    setFormError(null)
    const values: OverrideValues = {}
    for (const { col } of allFields) {
      const raw = draft[col].trim().replace(',', '.')
      if (raw === '') {
        values[col] = null
      } else {
        const n = parseFloat(raw)
        if (isNaN(n) || n <= 1.0 || n > 999) {
          setFormError(`Ungültiger Wert für ${col}: muss >1,00 sein.`)
          return
        }
        values[col] = n
      }
    }
    const exactValues: Record<string, number> = {}
    for (const es of match.exact_scores) {
      const raw = (exactDraft[es.score] ?? '').trim().replace(',', '.')
      if (raw === '') continue
      const n = parseFloat(raw)
      if (isNaN(n) || n <= 1.0 || n > 999) {
        setFormError(`Ungültiger Wert für Ergebnis ${es.score}: muss >1,00 sein.`)
        return
      }
      exactValues[es.score] = n
    }
    values.exact_score_overrides = Object.keys(exactValues).length > 0 ? exactValues : null
    setSaving(true)
    await onSave(values)
    setSaving(false)
    setEditing(false)
  }

  async function handleReset() {
    if (!(await confirm({ title: 'Alle Überschreibungen für dieses Spiel zurücksetzen?', confirmLabel: 'Zurücksetzen', tone: 'danger' }))) return
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

  function isExactOverridden(score: string): boolean {
    return override?.exact_score_overrides?.[score] != null
  }

  // What's actually offered to bettors: auto grid (full 0-6, incl. > MAX_EXACT_ODDS
  // entries) merged with any override, MAX_EXACT_ODDS filter applied AFTER the
  // merge — same rule as tipps/page.tsx and /api/bets/place (lib/odds.ts
  // mergeExactScoreOffers).
  const offeredScores = mergeExactScoreOffers(
    Object.fromEntries(match.exact_scores.map((es) => [es.score, es.odds])),
    override?.exact_score_overrides
  )

  return (
    <div id={`qu-match-${match.match_id}`} className="scroll-mt-24">
    <Panel className="overflow-hidden" tone={hasOverride ? 'open' : undefined}>
      <div className="flex items-start gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="break-words text-[14px] font-bold leading-snug text-gray-900">
            {match.home_team} – {match.away_team}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {hasOverride && <Pill tone="open">Überschrieben</Pill>}
            <span className="text-[12px] text-gray-500">
              {new Date(match.match_date).toLocaleString('de-DE', {
                timeZone: 'Europe/Berlin',
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}
              {match.frozen_at && <span className="ml-1 font-semibold text-amber-700">· eingefroren</span>}
            </span>
          </div>
        </div>
        <Btn size="sm" variant="secondary" className="shrink-0" onClick={editing ? () => setEditing(false) : openEdit}>
          {editing ? 'Schließen' : 'Bearbeiten'}
        </Btn>
      </div>

      {match.anomalies.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
          <Notice tone="open">
            <ul className="list-disc space-y-0.5 pl-4">
              {match.anomalies.map((a, i) => <li key={i}>{a.reason}</li>)}
            </ul>
          </Notice>
        </div>
      )}

      {/* Override edit form */}
      {editing && (
        <div className="space-y-2 border-b border-amber-200 bg-amber-50 px-3 py-3">
          <div className="mb-1 text-[13px] font-semibold text-amber-800">
            Manuelle Quoten-Überschreibung · leer lassen = Auto-Quote
          </div>
          {formError && <Notice tone="critical">{formError}</Notice>}
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
          {match.exact_scores.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] font-semibold text-amber-800 mb-1">Ergebnis (Genaues Ergebnis) · 0-6 pro Team, auch Auto-Quoten &gt; 50 überschreibbar</div>
              <div className="grid grid-cols-3 gap-1.5">
                {match.exact_scores.map(({ score, odds }) => (
                  <div key={score} className="flex items-center gap-1">
                    <span className={`text-[10px] font-medium w-8 text-right ${exactDraft[score] ? 'text-amber-700' : 'text-gray-500'}`}>
                      {score}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={exactDraft[score] ?? ''}
                      placeholder={fmt(odds)}
                      onChange={e => setExactDraft(prev => ({ ...prev, [score]: e.target.value }))}
                      className={`w-16 text-center text-xs py-1 border rounded focus:outline-none focus:ring-1 focus:ring-amber-400 ${
                        exactDraft[score] ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Btn size="sm" variant="primary" onClick={handleSave} loading={saving}>
              Speichern
            </Btn>
            {hasOverride && (
              <Btn size="sm" variant="secondary" onClick={handleReset} disabled={saving}>
                Zurücksetzen
              </Btn>
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
        <OddsRow label="BTTS" cells={[
          ['Ja', displayOdds('btts_yes', o.btts_yes), isOverridden('btts_yes')],
          ['Nein', displayOdds('btts_no', o.btts_no), isOverridden('btts_no')],
        ]} />
        <OddsRow label={`Handicap (Heim${match.handicapForceHomeSide != null ? ' – Wildenroth-Seite' : ' favorisiert'}${homeHandicapFavored(o, match.handicapForceHomeSide) ? ' – angeboten' : ''})`} cells={[
          ['H -1,5', displayOdds('hdp_home_minus_1_5', o.hdp_home_minus_1_5), isOverridden('hdp_home_minus_1_5')],
          ['G +1,5', displayOdds('hdp_away_plus_1_5', o.hdp_away_plus_1_5), isOverridden('hdp_away_plus_1_5')],
          ['H -2,5', displayOdds('hdp_home_minus_2_5', o.hdp_home_minus_2_5), isOverridden('hdp_home_minus_2_5')],
          ['G +2,5', displayOdds('hdp_away_plus_2_5', o.hdp_away_plus_2_5), isOverridden('hdp_away_plus_2_5')],
        ]} />
        <OddsRow label={`Handicap (Gast${match.handicapForceHomeSide != null ? ' – Wildenroth-Seite' : ' favorisiert'}${!homeHandicapFavored(o, match.handicapForceHomeSide) ? ' – angeboten' : ''})`} cells={[
          ['G -1,5', displayOdds('hdp_away_minus_1_5', o.hdp_away_minus_1_5), isOverridden('hdp_away_minus_1_5')],
          ['H +1,5', displayOdds('hdp_home_plus_1_5', o.hdp_home_plus_1_5), isOverridden('hdp_home_plus_1_5')],
          ['G -2,5', displayOdds('hdp_away_minus_2_5', o.hdp_away_minus_2_5), isOverridden('hdp_away_minus_2_5')],
          ['H +2,5', displayOdds('hdp_home_plus_2_5', o.hdp_home_plus_2_5), isOverridden('hdp_home_plus_2_5')],
        ]} />
        {offeredScores.length > 0 && (
          <div className="pt-1">
            <div className="text-gray-400 font-medium mb-1">Ergebnisse (angeboten, Quote ≤ 50,00)</div>
            <div className="grid grid-cols-4 gap-1">
              {offeredScores.map(({ score, odds }) => (
                <div key={score} className={`rounded px-1.5 py-1 flex items-center justify-between ${isExactOverridden(score) ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                  <span className={`font-semibold ${isExactOverridden(score) ? 'text-amber-700' : 'text-gray-700'}`}>{score}</span>
                  <span className="text-red-700 font-bold">{fmt(odds)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <InlineExplain matchId={match.match_id} />
        <SingleMatchRecalc matchId={match.match_id} />
      </div>
    </Panel>
    </div>
  )
}

/** Per-match "Quoten neu berechnen" — the same endpoint and the same model as
 *  the global button in the Quoten tab, scoped to this one fixture via
 *  `{ matchId }`. Exists because a freshly entered result usually only needs
 *  the fixtures depending on it to move; rewriting every upcoming match's
 *  preview odds at the same time is a much bigger change than intended.
 *  Frozen matches are refused by the route, not hidden here. */
function SingleMatchRecalc({ matchId }: { matchId: number }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setMsg(null)
    const res = await fetch('/api/admin/odds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
    })
    const data = await res.json()
    setLoading(false)
    setMsg(res.ok ? 'Quoten neu berechnet — Vorschau neu laden.' : `Fehler: ${data.error}`)
  }

  return (
    <div className="pt-2 mt-2 border-t border-gray-100">
      <button
        onClick={run}
        disabled={loading}
        className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-medium transition-colors"
      >
        {loading ? 'Berechne…' : 'Nur dieses Spiel neu berechnen'}
      </button>
      {msg && <span className="ml-2 text-xs text-gray-600">{msg}</span>}
    </div>
  )
}

/** Per-match "Warum diese Quote?" — the former standalone Erklärung tab,
 *  folded into each odds-preview card as a collapsed-by-default toggle
 *  (occasional diagnostic tool, not primary content). Fetches from the same
 *  read-only /api/admin/odds/explain endpoint, scoped to this one match via
 *  ?matchId=. */
function InlineExplain({ matchId }: { matchId: number }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ExplainMatch | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (data || loading) return
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/odds/explain?matchId=${matchId}`)
    const json: ExplainResponse | { error: string } = await res.json()
    setLoading(false)
    if (res.ok && 'matches' in json) {
      setData(json.matches[0] ?? null)
    } else if ('error' in json) {
      setError(json.error)
    }
  }

  return (
    <div className="pt-1 -mx-3 -mb-3 border-t border-gray-100">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-gray-500 hover:text-gray-700"
      >
        <span>🔍 Warum diese Quote?</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {loading && <div className="text-xs text-gray-400 py-2 text-center">Lade…</div>}
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          {!loading && data && !data.diagnostics && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Keine Diagnostik vorhanden – Quote wurde vermutlich vor Phase 1 berechnet.
            </div>
          )}
          {!loading && data?.diagnostics && (
            <div className="space-y-2">
              <ExplainBaseline d={data.diagnostics} />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <ExplainSide label={data.home_team} side="home" d={data.diagnostics} />
                <ExplainSide label={data.away_team} side="away" d={data.diagnostics} />
              </div>
              <div className="text-[10px] text-gray-400 flex items-center justify-between pt-1 border-t border-gray-100">
                <span>Quelle: {SOURCE_LABEL[data.diagnostics.source] ?? data.diagnostics.source}</span>
                <span>{fmtDateTime(data.diagnostics.computed_at)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- "Warum diese Quote?" — read-only explainability view ----------

/** Everything below `away_final_xg` is NULLABLE: rows written before the
 *  league-aware model (Spieltag 1-7) simply don't have it and the UI omits
 *  those lines instead of showing zeros. */
interface ExplainDiagnostics {
  source: string
  computed_at: string
  home_games_played: number
  away_games_played: number
  home_k_effective: number
  away_k_effective: number
  home_form_mult: number
  away_form_mult: number
  home_roster_factor: number
  away_roster_factor: number
  home_raw_xg: number
  away_raw_xg: number
  home_final_xg: number
  away_final_xg: number

  tier: string | null
  baseline_home: number | null
  baseline_away: number | null
  baseline_sample_matches: number | null

  home_games_all: number | null
  home_games_venue: number | null
  home_goals_for_pg_all: number | null
  home_goals_against_pg_all: number | null
  home_goals_for_pg_venue: number | null
  home_goals_against_pg_venue: number | null
  home_venue_weight: number | null
  home_prior_games: number | null
  home_league_transition: number | null
  home_estimated_attack: number | null
  home_estimated_defence: number | null

  away_games_all: number | null
  away_games_venue: number | null
  away_goals_for_pg_all: number | null
  away_goals_against_pg_all: number | null
  away_goals_for_pg_venue: number | null
  away_goals_against_pg_venue: number | null
  away_venue_weight: number | null
  away_prior_games: number | null
  away_league_transition: number | null
  away_estimated_attack: number | null
  away_estimated_defence: number | null
}

const TIER_LABEL: Record<string, string> = {
  kreisliga: 'Kreisliga',
  b_klasse: 'B-Klasse',
}

interface ExplainMatch {
  match_id: number
  matchday: number
  match_date: string
  home_team: string
  away_team: string
  odds: { home_win: number; draw: number; away_win: number; frozen_at: string | null } | null
  diagnostics: ExplainDiagnostics | null
}

interface ExplainResponse {
  matchday: number | null
  matchdays: number[]
  matches: ExplainMatch[]
}

const SOURCE_LABEL: Record<string, string> = {
  freeze: 'Einfrieren (Tippschluss)',
  admin_recalc: 'Admin-Neuberechnung',
  admin_preview: 'Admin-Vorschau',
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtFactor(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

// The former standalone Erklärung tab's list/grouping UI (OddsExplainSection,
// ExplainCard) was removed — this diagnostic is now available per-match via
// InlineExplain inside each Quoten-tab odds-preview card (above).

/** Compact header above the two sides: which league goal environment the
 *  fixture was priced in, and how much real evidence that baseline rests on.
 *  Hidden entirely for pre-migration rows (tier === null). */
function ExplainBaseline({ d }: { d: ExplainDiagnostics }) {
  if (!d.tier || d.baseline_home == null || d.baseline_away == null) return null
  const n = d.baseline_sample_matches ?? 0
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl px-2.5 py-2 text-xs text-gray-700">
      <div className="flex justify-between items-baseline">
        <span className="font-semibold text-gray-800">Liga-Normalspiel: {TIER_LABEL[d.tier] ?? d.tier}</span>
        <span className="font-medium text-gray-900">{fmtFactor(d.baseline_home)} : {fmtFactor(d.baseline_away)}</span>
      </div>
      <div className={`text-[10px] mt-0.5 ${n < 60 ? 'text-amber-800' : 'text-gray-500'}`}>
        Basis: {n} Spiele{n < 60 ? ' — Liga-Niveau noch überwiegend aus dem Gesamtschnitt aller Ligen geschätzt' : ''}
      </div>
    </div>
  )
}

function ExplainSide({ label, side, d }: { label: string; side: 'home' | 'away'; d: ExplainDiagnostics }) {
  const pick = <T,>(h: T, a: T) => (side === 'home' ? h : a)
  const gamesPlayed = pick(d.home_games_played, d.away_games_played)
  const k = pick(d.home_k_effective, d.away_k_effective)
  const formMult = pick(d.home_form_mult, d.away_form_mult)
  const rosterFactor = pick(d.home_roster_factor, d.away_roster_factor)
  const rawXG = pick(d.home_raw_xg, d.away_raw_xg)
  const finalXG = pick(d.home_final_xg, d.away_final_xg)

  const gamesVenue = pick(d.home_games_venue, d.away_games_venue)
  const gfAll = pick(d.home_goals_for_pg_all, d.away_goals_for_pg_all)
  const gaAll = pick(d.home_goals_against_pg_all, d.away_goals_against_pg_all)
  const gfVenue = pick(d.home_goals_for_pg_venue, d.away_goals_for_pg_venue)
  const gaVenue = pick(d.home_goals_against_pg_venue, d.away_goals_against_pg_venue)
  const venueWeight = pick(d.home_venue_weight, d.away_venue_weight)
  const priorGames = pick(d.home_prior_games, d.away_prior_games)
  const transition = pick(d.home_league_transition, d.away_league_transition)
  const estAtk = pick(d.home_estimated_attack, d.away_estimated_attack)
  const estDef = pick(d.home_estimated_defence, d.away_estimated_defence)
  const venueLabel = side === 'home' ? 'Heim' : 'Auswärts'

  const xgDiffPct = rawXG > 0 ? Math.abs(finalXG - rawXG) / rawXG : 0

  const notes: string[] = []
  if (rosterFactor <= 0.75) notes.push('Kader-Faktor senkt die erwartete Torgefahr deutlich')
  else if (rosterFactor >= 1.10) notes.push('Kader-Faktor erhöht die erwartete Torgefahr')
  if (formMult <= 0.95) notes.push('Form wirkt aktuell leicht dämpfend')
  else if (formMult >= 1.05) notes.push('Form wirkt aktuell leicht verstärkend')
  if (gamesPlayed < 3) notes.push('Wenige Saisonspiele — Schätzung noch stark am Liga-Normalspiel')
  if (venueWeight != null && venueWeight < 0.4) notes.push(`Kaum ${venueLabel}-Spiele — ${venueLabel}-Wert überwiegend aus der Gesamtbilanz abgeleitet`)
  if (transition != null && Math.abs(transition - 1) > 0.01) notes.push('Vorsaison stammt aus einer anderen Liga und wurde umgerechnet')
  if (xgDiffPct >= 0.15) notes.push('Deutlicher Unterschied zwischen roher und finaler xG')

  return (
    <div className="bg-gray-50 rounded-xl p-2.5">
      <div className="font-semibold text-gray-800 truncate mb-1.5">{label}</div>
      <div className="space-y-1 text-gray-600">
        <div className="flex justify-between"><span>Spiele (Saison)</span><span className={`font-medium ${gamesPlayed < 3 ? 'text-amber-700' : 'text-gray-900'}`}>{gamesPlayed}{gamesVenue != null ? ` (${fmtFactor(gamesVenue)}× ${venueLabel} gewichtet)` : ''}</span></div>
        {gfAll != null && gaAll != null && (
          <div className="flex justify-between"><span>Tore ⌀ gesamt</span><span className="font-medium text-gray-900">{fmtFactor(gfAll)} : {fmtFactor(gaAll)}</span></div>
        )}
        {gfVenue != null && gaVenue != null && (
          <div className="flex justify-between"><span>Tore ⌀ {venueLabel}</span><span className="font-medium text-gray-900">{fmtFactor(gfVenue)} : {fmtFactor(gaVenue)}</span></div>
        )}
        {venueWeight != null && (
          <div className="flex justify-between"><span>Gewicht {venueLabel}-Bilanz</span><span className={`font-medium ${venueWeight < 0.4 ? 'text-amber-700' : 'text-gray-900'}`}>{Math.round(venueWeight * 100)} %</span></div>
        )}
        {priorGames != null && priorGames > 0 && (
          <div className="flex justify-between"><span>Vorsaison (gewichtet)</span><span className="font-medium text-gray-900">{fmtFactor(priorGames)} Spiele{transition != null && Math.abs(transition - 1) > 0.01 ? ` × ${fmtFactor(transition)}` : ''}</span></div>
        )}
        {estAtk != null && estDef != null && (
          <div className="flex justify-between"><span>Angriff / Abwehr</span><span className="font-medium text-gray-900">{fmtFactor(estAtk)} / {fmtFactor(estDef)}</span></div>
        )}
        <div className="flex justify-between"><span>K (Shrinkage)</span><span className="font-medium text-gray-900">{fmtFactor(k)}</span></div>
        <div className="flex justify-between"><span>Form-Faktor</span><span className={`font-medium ${formMult <= 0.95 || formMult >= 1.05 ? 'text-amber-700' : 'text-gray-900'}`}>{fmtFactor(formMult)}</span></div>
        <div className="flex justify-between"><span>Kader-Faktor</span><span className={`font-medium ${rosterFactor <= 0.75 || rosterFactor >= 1.10 ? 'text-amber-700 font-bold' : 'text-gray-900'}`}>{fmtFactor(rosterFactor)}</span></div>
        <div className="flex justify-between"><span>xG roh → final</span><span className={`font-medium ${xgDiffPct >= 0.15 ? 'text-amber-700' : 'text-gray-900'}`}>{fmtFactor(rawXG)} → {fmtFactor(finalXG)}</span></div>
      </div>
      {notes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
          {notes.map((n, i) => (
            <div key={i} className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
              {n}
            </div>
          ))}
        </div>
      )}
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


// ── Test-Spieltag Panel ────────────────────────────────────────────────────

interface TestMatch {
  id: number
  match_date: string
  status: string
  home_team: { name: string } | null
  away_team: { name: string } | null
}

function TestMatchdayPanel() {
  const confirm = useConfirm()
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
    } else {
      // Bisher kein else-Zweig: ein Fehler beim initialen Laden blieb komplett unsichtbar —
      // weder Status noch Fehlermeldung, die Karte zeigte stillschweigend "nicht angelegt".
      setResult('✗ Status konnte nicht geladen werden.')
    }
    setLoading(false)
  }

  useEffect(() => { loadStatus() }, [])

  async function seed() {
    if (!(await confirm({ title: 'Test-Spieltag 999 anlegen?', message: 'Kickoff-Zeiten ab jetzt +5 Min bis +270 Min.', confirmLabel: 'Anlegen' }))) return
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
    if (!(await confirm({
      title: 'Test-Spieltag 999 vollständig entfernen?',
      message: 'Alle Testdaten werden gelöscht und alle User-Guthaben auf den Snapshot-Stand zurückgesetzt.',
      confirmLabel: 'Entfernen', tone: 'danger',
    }))) return
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

// ---------- Kader & Transfers ----------
// Pragmatic CRUD over league_players (RLS already restricts writes to admins,
// so this uses the regular session client directly, no separate audit-logged
// API route). Feeds the roster-factor odds adjustment via lib/odds.ts's
// getRosterFactor — see CLAUDE.md.

type LeaguePlayerRow = {
  id: number
  season: string
  team_name: string
  name: string
  goals: number
  matches: number
  status: string
  transfer_to: string | null
  prior_league_level: string | null
  prior_team_name: string | null
}

const KADER_TEAMS = [
  'SpVgg Wildenroth', 'SpVgg Wildenroth II',
]

const KADER_STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  transferred_out: 'Abgang',
  retired: 'Karriereende',
  internal_move: 'Wechsel 1./2.',
  transferred_in: 'Zugang',
}

/** `onMessage` ersetzt die frühere eigene `error`-Mini-Leiste — läuft jetzt über dieselbe
 *  globale Banner-Stelle wie überall sonst im Admin-Bereich. Supabase-Zugriff, Query, RLS-
 *  Erwartungen und alle Handler-Signaturen sind unverändert (reiner Session-Client). */
function KaderSection({ onMessage }: { onMessage: (m: string | null) => void }) {
  const confirm = useConfirm()
  const supabase = createClient()
  const [players, setPlayers] = useState<LeaguePlayerRow[]>([])
  const [teamFilter, setTeamFilter] = useState(KADER_TEAMS[0])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('league_players')
      .select('id, season, team_name, name, goals, matches, status, transfer_to, prior_league_level, prior_team_name')
      .eq('team_name', teamFilter)
      .order('name')
    setLoading(false)
    if (error) { onMessage(`Fehler: ${error.message}`); return }
    setPlayers((data ?? []) as LeaguePlayerRow[])
  }, [supabase, teamFilter, onMessage])

  useEffect(() => { load() }, [load])

  async function updateStatus(id: number, status: string) {
    onMessage(null)
    const { error } = await supabase.from('league_players').update({ status }).eq('id', id)
    if (error) { onMessage(`Fehler: ${error.message}`); return }
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, status } : p))
  }

  async function updateTransferTo(id: number, transfer_to: string) {
    onMessage(null)
    const { error } = await supabase.from('league_players').update({ transfer_to: transfer_to || null }).eq('id', id)
    if (error) { onMessage(`Fehler: ${error.message}`); return }
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, transfer_to: transfer_to || null } : p))
  }

  async function addPlayer() {
    if (!newName.trim()) return
    setSaving(true)
    onMessage(null)
    const { error } = await supabase.from('league_players').insert({
      season: '26/27',
      team_name: teamFilter,
      name: newName.trim(),
      status: 'active',
      goals: 0,
      matches: 0,
    })
    setSaving(false)
    if (error) { onMessage(`Fehler: ${error.message}`); return }
    setNewName('')
    load()
  }

  async function deletePlayer(id: number) {
    if (!(await confirm({ title: 'Spieler aus dem Kader entfernen?', confirmLabel: 'Entfernen', tone: 'danger' }))) return
    const { error } = await supabase.from('league_players').delete().eq('id', id)
    if (error) { onMessage(`Fehler: ${error.message}`); return }
    setPlayers(prev => prev.filter(p => p.id !== id))
  }

  return (
    <Panel className="space-y-3 p-4">
      <p className="text-[14px] leading-6 text-gray-700">
        Fließt in den Kader-Faktor der Quotenberechnung ein — Abgänge, Zugänge und Karriereenden pflegen.
      </p>

      <div className="flex gap-2">
        {KADER_TEAMS.map(t => (
          <Btn key={t} variant={teamFilter === t ? 'primary' : 'secondary'} size="sm" className="flex-1" onClick={() => setTeamFilter(t)}>
            {t}
          </Btn>
        ))}
      </div>

      {loading ? <LoadingBlock label="Kader wird geladen …" /> : (
        <div className="space-y-1.5">
          {players.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-[13px]">
              <span className="min-w-[110px] shrink-0 font-semibold text-gray-800">{p.name}</span>
              <select
                value={p.status}
                onChange={(e) => updateStatus(p.id, e.target.value)}
                className="rounded-lg border border-gray-200 px-1.5 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                {Object.entries(KADER_STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              {(p.status === 'transferred_out' || p.status === 'internal_move') && (
                <input
                  value={p.transfer_to ?? ''}
                  onChange={(e) => updateTransferTo(p.id, e.target.value)}
                  placeholder="wohin?"
                  className="w-28 rounded-lg border border-gray-200 px-1.5 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              )}
              <span className="ml-auto text-gray-500">{p.goals} Tore · {p.matches} Sp.</span>
              <button
                onClick={() => deletePlayer(p.id)}
                className="shrink-0 text-gray-400 hover:text-red-600"
                title="Entfernen"
              >
                ✕
              </button>
            </div>
          ))}
          {players.length === 0 && <EmptyNote>Kein Kader hinterlegt.</EmptyNote>}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Neuer Spieler (Name)"
          className={`flex-1 ${inputCls}`}
        />
        <Btn variant="primary" size="sm" disabled={saving || !newName.trim()} onClick={addPlayer}>
          + Hinzufügen
        </Btn>
      </div>
    </Panel>
  )
}
