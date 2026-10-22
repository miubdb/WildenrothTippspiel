import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MeineWettenClient } from '@/components/meine-wetten/MeineWettenClient'
import type { HistoryItem } from '@/components/BetHistoryWithCancel'
import { STATS_CURRENT_SEASON } from '@/lib/betStats'
import { SEASON_START, buildEffectiveMatchdayIndex, parseBettingOpenOverrides } from '@/lib/season'
import { legMatchdayOf, resolveSlipMatchday, type SlipMatchday } from '@/components/meine-wetten/slipMatchday'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { getCurrentUser } from '@/app/_lib/currentUser'
import { defaultCurrentMatchday } from '@/app/_lib/currentMatchday'
import type { Match } from '@/types'
import { groupBetsIntoItems } from '@/lib/meineWettenItems'

export const dynamic = 'force-dynamic'

/**
 * „Meine Wetten“: alle Scheine der laufenden Saison (offen und abgeschlossen), nach Spieltag gruppiert.
 * Daten werden wie in der bisherigen Wetthistorie des Profils geladen (gleiche Abfragen, gleiche RLS);
 * Stornieren läuft über die bestehende API /api/bets/cancel.
 */
export default async function MeineWettenPage({ searchParams }: { searchParams: Promise<{ highlight?: string }> }) {
  const { highlight } = await searchParams
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Eine Welle statt fünf nacheinander: Scheine, Kader-Namen, Saisonspiele und
  // die Einstellungen für den aktuellen Spieltag sind voneinander unabhängig.
  // Eigene Wetten paginiert geladen (fetchAllRows), nicht mehr .limit(500) — ein aktiver
  // Spieler überschreitet 500 Zeilen durchaus innerhalb einer Saison (jedes Kombi-Leg ist eine
  // eigene Zeile), ein starres Limit hätte ältere Scheine irgendwann kommentarlos abgeschnitten.
  //
  // fetchAllRows WIRFT bei einem Fehler (siehe lib/supabase/paginatedSelect.ts), es gibt kein
  // { data, error }-Objekt zurück. Promise.all([...]) muss deshalb hier in try/catch stehen,
  // sonst würde ein Fehlschlag entweder die ganze Seite mit einem generischen Next.js-Fehler
  // abbrechen oder — schlimmer — bei einem falschen Destructuring unbemerkt zu "keine Wetten".
  type BetRow = {
    id: number; market_type: string; selection: string; stake: number; odds_value: number
    status: string; payout: number | null; created_at: string; combo_id: number | null
    season: string | null; is_risky: boolean | null; special_id: number | null
    match: { id: number; matchday: number; match_date: string; home_score: number | null; away_score: number | null; status: string
      home_team: { name: string; short_name: string } | { name: string; short_name: string }[] | null
      away_team: { name: string; short_name: string } | { name: string; short_name: string }[] | null
    } | { id: number; matchday: number; match_date: string; home_score: number | null; away_score: number | null; status: string
      home_team: { name: string; short_name: string } | { name: string; short_name: string }[] | null
      away_team: { name: string; short_name: string } | { name: string; short_name: string }[] | null
    }[] | null
  }
  let betsRaw: BetRow[]
  let rosterRows: { id: number; name: string }[] | null
  let seasonMatchesRaw: unknown[]
  let settingsRows: { key: string; value: string }[] | null
  try {
    const [betsResolved, rosterRes, seasonMatchesResolved, settingsRes] = await Promise.all([
      fetchAllRows<BetRow>((from, to) => supabase
        .from('bets')
        .select(
          `id, market_type, selection, stake, odds_value, status, payout, created_at, combo_id, season, is_risky, special_id,
         match:matches(id, matchday, match_date, home_score, away_score, status,
           home_team:teams!matches_home_team_id_fkey(name, short_name),
           away_team:teams!matches_away_team_id_fkey(name, short_name)
         )`
        )
        .eq('user_id', user.id)
        .neq('status', 'void')
        .order('id', { ascending: false })
        .range(from, to)),
      supabase.from('wildenroth_players').select('id, name'),
      fetchAllRows((from, to) => supabase
        .from('matches')
        .select('id, match_number, matchday, home_team_id, away_team_id, match_date, status, match_category, is_topspiel, tippspiel_matchday, competition_type')
        .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
        .order('id')
        .range(from, to)),
      supabase.from('app_settings').select('key, value'),
    ])
    betsRaw = betsResolved
    rosterRows = rosterRes.data
    seasonMatchesRaw = seasonMatchesResolved
    settingsRows = settingsRes.data
  } catch (err) {
    // Ein Fehlschlag hier darf NIE stillschweigend als "keine Wetten" durchgehen — das hätte
    // genau wieder eine leer wirkende Kombi-Historie zur Folge, nur aus einem anderen Grund als
    // der eigentliche ID-Typ-Fehler. Lieber ehrlich einen Fehlerzustand zeigen.
    console.error('Meine Wetten: Laden der Wetten/Spiele fehlgeschlagen:', err)
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm font-semibold text-red-700">Deine Wetten konnten nicht geladen werden.</p>
        <p className="mt-1 text-sm text-gray-500">Bitte die Seite neu laden. Falls das Problem bleibt, bitte melden.</p>
      </div>
    )
  }

  const specialIds = [...new Set((betsRaw ?? []).map((b) => b.special_id).filter((id): id is number => id != null))]
  const specialsById: Record<number, { matchday: number; template_key: string; options: { key: string; label: string }[]; settlement_result: { finalStat: number; winningKey: string } | null }> = {}

  const allBets = (betsRaw ?? []).map((b) => ({
    ...b,
    match: (() => {
      const m = Array.isArray(b.match) ? b.match[0] : b.match
      if (!m) return null
      return { ...m, home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team, away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team }
    })(),
  }))
  // laufende Saison (+ Testspieltag), wie im Profil
  const bets = allBets.filter((b) => !b.season || b.season === STATS_CURRENT_SEASON || b.season === 'TEST')

  // combo_id/combo_bets.id sind in Postgres immer integer — hier bewusst NIE als string
  // typisiert; groupBetsIntoItems (lib/meineWettenItems.ts) normalisiert intern auf String(...).
  const comboIds = [...new Set(bets.filter((b) => b.combo_id != null).map((b) => b.combo_id as number))]
  // Kombischeine und Specials hängen nur von den Scheinen ab und laufen gemeinsam.
  const [cbRes, specialsRes] = await Promise.all([
    comboIds.length > 0 ? supabase.from('combo_bets').select('id, stake, total_odds, status, payout').in('id', comboIds) : Promise.resolve({ data: [] as { id: number; stake: number; total_odds: number; status: string; payout: number | null }[], error: null }),
    specialIds.length > 0 ? supabase.from('matchday_specials').select('id, matchday, template_key, options, settlement_result').in('id', specialIds) : Promise.resolve({ data: [] as { id: number; matchday: number; template_key: string; options: unknown; settlement_result: unknown }[], error: null }),
  ])
  // Derselbe Grundsatz wie oben: ein Fehlschlag beim Laden der Kombischeine darf NIE
  // stillschweigend "alle Kombis unsichtbar" bedeuten (leeres visibleIds hätte exakt diesen
  // Effekt) — lieber explizit scheitern als eine irreführend leere Historie zeigen.
  if (cbRes.error) {
    console.error('Meine Wetten: Laden der Kombischeine fehlgeschlagen:', cbRes.error)
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm font-semibold text-red-700">Deine Kombiwetten konnten nicht geladen werden.</p>
        <p className="mt-1 text-sm text-gray-500">Bitte die Seite neu laden. Falls das Problem bleibt, bitte melden.</p>
      </div>
    )
  }
  for (const sp of specialsRes.data ?? []) {
    specialsById[sp.id] = {
      matchday: sp.matchday, template_key: sp.template_key,
      options: sp.options as { key: string; label: string }[],
      settlement_result: sp.settlement_result as { finalStat: number; winningKey: string } | null,
    }
  }

  const playerNameMap: Record<number, string> = Object.fromEntries((rosterRows ?? []).map((r) => [r.id, r.name]))

  // Gruppierung in Scheine (Einzeltipp/Kombischein) über die geteilte, separat getestete
  // Funktion (scripts/meine-wetten-check.ts) — nicht mehr hier dupliziert nachgebaut.
  const items = groupBetsIntoItems(bets, cbRes.data ?? []) as unknown as HistoryItem[]

  // Zuordnung zum Tippspiel-Spieltag wie in der Platzierungs-API (lib/season.ts, effectiveMatchdayOf; Pokal: rohe Nummer) – NICHT die
  // rohe BFV-Nummer. Ein Schein hat keinen gespeicherten Spieltag; liegen seine Spiele in mehreren Spieltagen, wird das als „gemischt“
  // ausgewiesen statt einen Spieltag zu raten (Details und Tests: components/meine-wetten/slipMatchday.ts).
  const seasonMatches = seasonMatchesRaw as unknown as Match[]
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)

  // Welcher Spieltag ist "aktuell" — dieselbe Logik wie auf der Tipps-Seite
  // (app/_lib/currentMatchday.ts), NICHT "jüngster Spieltag mit offenem
  // Schein": sonst verschwindet der aktuelle Spieltag, sobald alle seine
  // Scheine abgerechnet sind, obwohl er weiterhin "der aktuelle" ist.
  const appSettings = new Map((settingsRows ?? []).map((s) => [s.key, s.value] as const))
  const explicitBettingOpens = parseBettingOpenOverrides(appSettings)
  const hasTestMatchday = seasonMatches.some((m) => m.matchday === 999)
  const isPreSeason = seasonMatches.filter((m) => m.matchday !== 999).length === 0
  const currentMatchday = defaultCurrentMatchday(seasonMatches, mdIndex, explicitBettingOpens, { isPreSeason, hasTestMatchday })

  const matchById = new Map(seasonMatches.map((m) => [m.id, m]))
  const legMatchdays: Record<string, number | null> = {}
  const slipMatchdays: Record<string, SlipMatchday> = {}
  for (const item of items) {
    const legs = item.kind === 'single' ? [item.bet] : item.legs
    const mds = legs.map((l) => {
      // Spieltag-Special: match_id ist nur ein technischer Anker, der Spieltag steht am Special selbst
      const md = l.market_type === 'matchday_special' && l.special_id != null
        ? specialsById[l.special_id]?.matchday ?? null
        : (() => { const m = l.match?.id != null ? matchById.get(l.match.id) : undefined; return m ? legMatchdayOf(m, mdIndex) : null })()
      legMatchdays[`leg-${l.id}`] = md
      return md
    })
    slipMatchdays[item.kind === 'single' ? `bet-${item.bet.id}` : `combo-${item.comboId}`] = resolveSlipMatchday(mds)
  }

  return (
    <MeineWettenClient items={items} slipMatchdays={slipMatchdays} legMatchdays={legMatchdays} matchdayOrder={mdIndex.kreisligaMatchdaysDisplayOrder} currentMatchday={currentMatchday} playerNameMap={playerNameMap} specialsById={specialsById} highlight={highlight} />
  )
}
