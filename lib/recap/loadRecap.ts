import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { SEASON_START } from '@/lib/season'
import { plainSelectionLabel } from '@/lib/betDisplay'
import { buildSlips, RECAP_SEASON, type RecapBetRow, type RecapComboRow, type RecapMatchRow } from '@/lib/recap/slips'
import { buildRecapReport, type RecapReport } from '@/lib/recap/report'
import { computeRangeReadiness, HINRUNDE, recapVisibility, type RangeReadiness, type RecapVisibility } from '@/lib/recap/availability'

/**
 * Lädt die Rohdaten für Recap-Auswertungen (Service-Role, weil Auswertungen über ALLE Tipper laufen) und
 * rechnet mit den reinen Funktionen in lib/recap/*. Es verlässt nie etwas den Server außer dem
 * aggregierten Bericht (Namen nur für genannte Tipper, keine E-Mails, keine gelöschten Konten).
 * Alle Abfragen laufen über fetchAllRows (PostgREST-Limit 1000).
 */

const MARKET_LABELS: Record<string, string> = {
  '1x2': 'Spielausgang', double_chance: 'Doppelte Chance', handicap: 'Handicap', btts: 'Beide treffen', exact_score: 'Ergebnis',
  over_under_2_5: 'Über/Unter 2,5', over_under_3_5: 'Über/Unter 3,5', over_under_5_5: 'Über/Unter 5,5', over_9_5: 'Über 9,5 Tore',
  goalscorer: 'Torschütze', goalscorer_2plus: 'Torschütze 2+', matchday_special: 'Spieltags-Special',
}

export interface RawRecapData { matches: RecapMatchRow[]; bets: RecapBetRow[]; combos: RecapComboRow[]; profiles: { id: string; display_name: string | null; username: string | null; avatar_url: string | null; deleted_at: string | null; is_admin: boolean | null }[]; teams: Map<number, string>; players: Record<number, string> }

export async function loadRawRecapData(): Promise<RawRecapData> {
  const admin = createAdminClient()
  const [matches, bets, combos, profiles, teams, players] = await Promise.all([
    fetchAllRows<RecapMatchRow>((f, t) => admin.from('matches').select('id, matchday, match_date, status, match_category, is_topspiel, tippspiel_matchday, home_team_id, away_team_id, home_score, away_score, competition_type').or(`match_date.gte.${SEASON_START},matchday.eq.999`).order('id').range(f, t)),
    fetchAllRows<RecapBetRow>((f, t) => admin.from('bets').select('id, user_id, match_id, market_type, selection, stake, odds_value, status, payout, combo_id, created_at, is_risky, season, is_bonus, void_reason, special_id').eq('season', RECAP_SEASON).order('id').range(f, t)),
    fetchAllRows<RecapComboRow>((f, t) => admin.from('combo_bets').select('id, user_id, stake, total_odds, status, payout, created_at, season, void_reason, original_total_odds').eq('season', RECAP_SEASON).order('id').range(f, t)),
    fetchAllRows<RawRecapData['profiles'][number]>((f, t) => admin.from('profiles').select('id, display_name, username, avatar_url, deleted_at, is_admin').order('id').range(f, t)),
    fetchAllRows<{ id: number; name: string }>((f, t) => admin.from('teams').select('id, name').order('id').range(f, t)),
    fetchAllRows<{ id: number; name: string }>((f, t) => admin.from('wildenroth_players').select('id, name').order('id').range(f, t)),
  ])
  return { matches, bets, combos, profiles, teams: new Map(teams.map((x) => [x.id, x.name])), players: Object.fromEntries(players.map((p) => [p.id, p.name])) }
}

export interface RecapRangeState {
  readiness: RangeReadiness
  published: boolean
  visibility: RecapVisibility
  /** Bericht über den Zeitraum; bei nicht bereitem Zeitraum nur für die Admin-Vorschau (bis `previewTo`). */
  report: RecapReport | null
  previewTo: number | null
  /** Letzter vollständig abgeschlossener Spieltag innerhalb des Zeitraums (für Fortschrittsanzeige). */
  completedUpTo: number
  dataAsOfMs: number
}

export async function loadHinrundeState(opts: { adminPreview: boolean }): Promise<RecapRangeState> {
  const raw = await loadRawRecapData()
  const admin = createAdminClient()
  const { data: setting } = await admin.from('app_settings').select('value').eq('key', HINRUNDE.settingKey).maybeSingle()
  const readiness = computeRangeReadiness(raw.matches, raw.bets, HINRUNDE.from, HINRUNDE.to)
  const visibility = recapVisibility(readiness.ready, setting?.value ?? null)
  let completedUpTo = 0
  for (const m of readiness.matchdays) { if (m.complete) completedUpTo = m.matchday; else break }
  const isPublished = visibility === 'published'
  const show = isPublished || (opts.adminPreview && completedUpTo > 0)
  if (!show) return { readiness, published: isPublished, visibility, report: null, previewTo: null, completedUpTo, dataAsOfMs: 0 }
  const to = readiness.ready ? HINRUNDE.to : completedUpTo
  const { slips } = buildSlips({ bets: raw.bets, combos: raw.combos, matches: raw.matches })
  const teamName = (id: number) => raw.teams.get(id) ?? '?'
  const mById = new Map(raw.matches.map((m) => [m.id, m]))
  const report = buildRecapReport({
    allSlips: slips, matches: raw.matches, range: { from: HINRUNDE.from, to }, profiles: raw.profiles,
    labeler: {
      matchLabel: (id) => { const m = mById.get(id); return m ? `${teamName(m.home_team_id)} – ${teamName(m.away_team_id)}` : `Spiel #${id}` },
      marketLabel: (m) => MARKET_LABELS[m] ?? m,
      selectionLabel: (market, sel) => plainSelectionLabel(market, sel, undefined, raw.players),
    },
  })
  return { readiness, published: isPublished, visibility, report, previewTo: readiness.ready ? null : to, completedUpTo, dataAsOfMs: report.dataAsOfMs }
}

export async function loadCompletedMatchdays(): Promise<number[]> {
  const raw = await loadRawRecapData()
  const maxMd = raw.matches.reduce((m, x) => Math.max(m, x.matchday < 900 ? x.matchday : 0), 0)
  const r = computeRangeReadiness(raw.matches, raw.bets, 1, maxMd)
  return r.matchdays.filter((m) => m.complete).map((m) => m.matchday)
}

export async function loadReadinessOnly(): Promise<RangeReadiness> {
  const raw = await loadRawRecapData()
  return computeRangeReadiness(raw.matches, raw.bets, HINRUNDE.from, HINRUNDE.to)
}
