import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { SEASON_START } from '@/lib/season'
import { plainSelectionLabel } from '@/lib/betDisplay'
import { simulateSpieltag } from '@/lib/recap/simulation'
import { databaseKind, isSimulationAllowed, supabaseRef, type DatabaseKind } from '@/lib/recap/environmentGuard'
import { MARKET_LABELS } from '@/lib/recap/marketLabels'
import { buildPersonalTips, type PersonalTips } from '@/lib/recap/bestTips'
import { filterSlipsByMatchdays } from '@/lib/recap/tipperIq'
import { buildSlips, RECAP_SEASON, type RecapBetRow, type RecapComboRow, type RecapMatchRow } from '@/lib/recap/slips'
import { buildRecapReport, type RecapReport } from '@/lib/recap/report'
import { canViewRecapReport, computeRangeReadiness, HINRUNDE, recapVisibility, type RangeReadiness, type RecapVisibility } from '@/lib/recap/availability'
import { loadFrozenWinterRecap, frozenViewForUser, type WinterRecapCandidate } from '@/lib/recap/frozenSnapshot'
import { extractWinterAwards } from '@/lib/recap/winterAwards'
import type { CompletionSpecial } from '@/lib/matchdayFinishReadiness'

/**
 * Lädt die Rohdaten für Recap-Auswertungen (Service-Role, weil Auswertungen über ALLE Tipper laufen) und
 * rechnet mit den reinen Funktionen in lib/recap/*. Es verlässt nie etwas den Server außer dem
 * aggregierten Bericht (Namen nur für genannte Tipper, keine E-Mails, keine gelöschten Konten).
 * Alle Abfragen laufen über fetchAllRows (PostgREST-Limit 1000).
 */


export interface RawRecapData { matches: RecapMatchRow[]; bets: RecapBetRow[]; combos: RecapComboRow[]; profiles: { id: string; display_name: string | null; username: string | null; avatar_url: string | null; deleted_at: string | null; is_admin: boolean | null }[]; teams: Map<number, string>; players: Record<number, string>; specials: CompletionSpecial[] }

export async function loadRawRecapData(): Promise<RawRecapData> {
  const admin = createAdminClient()
  const [matches, bets, combos, profiles, teams, players, specials] = await Promise.all([
    fetchAllRows<RecapMatchRow>((f, t) => admin.from('matches').select('id, matchday, match_date, status, match_category, is_topspiel, tippspiel_matchday, home_team_id, away_team_id, home_score, away_score, competition_type').or(`match_date.gte.${SEASON_START},matchday.eq.999`).order('id').range(f, t)),
    fetchAllRows<RecapBetRow>((f, t) => admin.from('bets').select('id, user_id, match_id, market_type, selection, stake, odds_value, status, payout, combo_id, created_at, is_risky, season, is_bonus, void_reason, special_id').eq('season', RECAP_SEASON).order('id').range(f, t)),
    fetchAllRows<RecapComboRow>((f, t) => admin.from('combo_bets').select('id, user_id, stake, total_odds, status, payout, created_at, season, void_reason, original_total_odds').eq('season', RECAP_SEASON).order('id').range(f, t)),
    fetchAllRows<RawRecapData['profiles'][number]>((f, t) => admin.from('profiles').select('id, display_name, username, avatar_url, deleted_at, is_admin').order('id').range(f, t)),
    fetchAllRows<{ id: number; name: string }>((f, t) => admin.from('teams').select('id, name').order('id').range(f, t)),
    fetchAllRows<{ id: number; name: string }>((f, t) => admin.from('wildenroth_players').select('id, name').order('id').range(f, t)),
    fetchAllRows<CompletionSpecial>((f, t) => admin.from('matchday_specials')
      .select('id, included_match_ids').eq('season', RECAP_SEASON).order('id').range(f, t)),
  ])
  return { matches, bets, combos, profiles, teams: new Map(teams.map((x) => [x.id, x.name])), players: Object.fromEntries(players.map((p) => [p.id, p.name])), specials }
}

export interface RecapRangeState {
  readiness: RangeReadiness
  published: boolean
  visibility: RecapVisibility
  /** Bericht über den Zeitraum; bei nicht bereitem Zeitraum nur für die Admin-Vorschau (bis `previewTo`). */
  report: RecapReport | null
  /** Persönlicher Rückblick – NUR für den anfragenden Nutzer berechnet, nie Teil des gemeinsamen Berichts. */
  personal: PersonalTips | null
  previewTo: number | null
  /** Letzter vollständig abgeschlossener Spieltag innerhalb des Zeitraums (für Fortschrittsanzeige). */
  completedUpTo: number
  dataAsOfMs: number
  /** Gesetzt, wenn die Testsimulation aktiv ist (Preview-Umgebung, Admin, ?test=sim16). */
  simulation: { matchdays: number[]; matches: number; betRows: number; realReadiness: RangeReadiness; databaseRef: string } | null
  /** Verbundene Datenbank (nur Kennung, nie Schlüssel): beweist im Admin-Bereich, wohin diese Umgebung zeigt. */
  database: { ref: string | null; kind: DatabaseKind }
}

export interface LoadOptions { adminPreview: boolean; viewerId: string; simulate?: boolean }

/** One consistent interpretation of the raw rows for both live preview and
 * the immutable snapshot. Nothing is written by this function.
 */
function createReportFromRaw(raw: RawRecapData, to: number) {
  const { slips } = buildSlips({ bets: raw.bets, combos: raw.combos, matches: raw.matches })
  const teamName = (id: number) => raw.teams.get(id) ?? '?'
  const byMatch = new Map(raw.matches.map((m) => [m.id, m]))
  const labeler = {
    matchLabel: (id: number) => { const m = byMatch.get(id); return m ? `${teamName(m.home_team_id)} – ${teamName(m.away_team_id)}${m.competition_type === 'cup' ? ' (Pokal)' : ''}` : `Spiel #${id}` },
    matchTeams: (id: number) => { const m = byMatch.get(id); return m ? { home: teamName(m.home_team_id), away: teamName(m.away_team_id) } : null },
    marketLabel: (m: string) => MARKET_LABELS[m] ?? m,
    selectionLabel: (market: string, sel: string) => plainSelectionLabel(market, sel, undefined, raw.players),
  }
  const range = { from: HINRUNDE.from, to }
  const report = buildRecapReport({ allSlips: slips, matches: raw.matches, range, profiles: raw.profiles, labeler, teamName })
  const rangeSlips = filterSlipsByMatchdays(slips, range.from, range.to)
  return { report, slips, labeler, rangeSlips }
}

/** Materialize the exact public report plus every eligible player's own view
 * from ONE set of DB rows. Only used by the admin publish route after it
 * verifies the final matchday/award gates; nothing is stored before then.
 */
export async function buildFinalWinterRecapCandidate(): Promise<WinterRecapCandidate> {
  const raw = await loadRawRecapData()
  const readiness = computeRangeReadiness(raw.matches, raw.bets, HINRUNDE.from, HINRUNDE.to, RECAP_SEASON, raw.specials)
  const { report, slips, labeler, rangeSlips } = createReportFromRaw(raw, HINRUNDE.to)
  const personal_by_user: WinterRecapCandidate['personal_by_user'] = {}
  for (const user of raw.profiles) {
    if (!user.deleted_at) personal_by_user[user.id] = buildPersonalTips(slips, rangeSlips, user.id, labeler)
  }
  return { report, personal_by_user, readiness, award_rows: extractWinterAwards(report) }
}

export async function loadHinrundeState(opts: LoadOptions): Promise<RecapRangeState> {
  const admin = createAdminClient()
  const { data: setting, error: settingError } = await admin.from('app_settings').select('value')
    .eq('key', HINRUNDE.settingKey).maybeSingle()
  if (settingError) throw new Error('Winter-Recap-Freigabe konnte nicht geprüft werden.')
  const database = { ref: supabaseRef(), kind: databaseKind() }
  // Simulations are admin-only in preview/development, never in Production.
  const simulate = !!opts.simulate && opts.adminPreview && isSimulationAllowed()

  if (!simulate) {
    const snapshot = await loadFrozenWinterRecap(admin)
    if (snapshot) {
      const frozenView = frozenViewForUser(snapshot, opts.viewerId)
      const visibility: RecapVisibility = setting?.value === 'true' ? 'published' : 'ready_unpublished'
      const published = visibility === 'published'
      const show = canViewRecapReport(visibility, opts.adminPreview, HINRUNDE.to)
      return {
        readiness: snapshot.readiness, published, visibility,
        report: show ? frozenView.report : null,
        // NEVER send the whole private personal_by_user table to the client.
        personal: show ? frozenView.personal : null,
        previewTo: null, completedUpTo: HINRUNDE.to,
        dataAsOfMs: show ? snapshot.report.dataAsOfMs : 0,
        simulation: null, database,
      }
    }
    if (setting?.value === 'true') {
      // Fail CLOSED: a publication toggle without a frozen snapshot may not
      // expose a live, mutable report. This guards manual DB edits/migrations.
      console.error('Published winter recap has no immutable snapshot — public report withheld.')
      return {
        readiness: { ready: false, matchdays: [], blockers: ['Veröffentlichter Recap ohne eingefrorenen Datenstand – Adminprüfung erforderlich.'] },
        published: false, visibility: 'hidden_not_ready', report: null, personal: null,
        previewTo: null, completedUpTo: 0, dataAsOfMs: 0, simulation: null, database,
      }
    }
  }

  let raw = await loadRawRecapData()
  const realReadiness = computeRangeReadiness(raw.matches, raw.bets, HINRUNDE.from, HINRUNDE.to, RECAP_SEASON, raw.specials)
  let simulation: RecapRangeState['simulation'] = null
  if (simulate) {
    const sim = simulateSpieltag(raw, HINRUNDE.to)
    raw = { ...raw, matches: sim.matches, bets: sim.bets, combos: sim.combos }
    simulation = {
      matchdays: [HINRUNDE.to], matches: sim.simulatedMatchIds.length,
      betRows: sim.simulatedBetRows, realReadiness, databaseRef: supabaseRef() ?? '',
    }
  }
  const readiness = computeRangeReadiness(raw.matches, raw.bets, HINRUNDE.from, HINRUNDE.to, RECAP_SEASON, raw.specials)
  const visibility: RecapVisibility = simulate
    ? (readiness.ready ? 'ready_unpublished' : 'hidden_not_ready')
    : recapVisibility(readiness.ready, setting?.value ?? null)
  let completedUpTo = 0
  for (const m of readiness.matchdays) { if (m.complete) completedUpTo = m.matchday; else break }
  const published = visibility === 'published'
  const show = canViewRecapReport(visibility, opts.adminPreview, completedUpTo)
  if (!show) return { readiness, published, visibility, report: null, personal: null, previewTo: null, completedUpTo, dataAsOfMs: 0, simulation, database }

  const to = readiness.ready ? HINRUNDE.to : completedUpTo
  const { report, slips, labeler, rangeSlips } = createReportFromRaw(raw, to)
  const personal = buildPersonalTips(slips, rangeSlips, opts.viewerId, labeler)
  return { readiness, published, visibility, report, personal, previewTo: readiness.ready ? null : to,
    completedUpTo, dataAsOfMs: report.dataAsOfMs, simulation, database }
}

export async function loadCompletedMatchdays(): Promise<number[]> {
  const raw = await loadRawRecapData()
  const maxMd = raw.matches.reduce((m, x) => Math.max(m, x.matchday < 900 ? x.matchday : 0), 0)
  const r = computeRangeReadiness(raw.matches, raw.bets, 1, maxMd, RECAP_SEASON, raw.specials)
  return r.matchdays.filter((m) => m.complete).map((m) => m.matchday)
}

export async function loadReadinessOnly(): Promise<RangeReadiness> {
  const raw = await loadRawRecapData()
  return computeRangeReadiness(raw.matches, raw.bets, HINRUNDE.from, HINRUNDE.to, RECAP_SEASON, raw.specials)
}
