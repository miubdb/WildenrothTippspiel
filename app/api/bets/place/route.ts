import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAgainstWildenroth } from '@/lib/wildenroth'
import { isSeasonStarted, buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { ODDS_COLUMN, offeredHandicapSelections, HANDICAP_OPPOSITE } from '@/lib/oddsMarkets'
import { mergeExactScoreOffers } from '@/lib/odds'
import { RISKY_ODDS_THRESHOLD, evaluateSlips, recomputeRiskyForUserMatchday, type RiskySlip } from '@/lib/risky'
import type { Match } from '@/types'

const MAX_STAKE = 250
const CURRENT_SEASON = '26/27'
const TEST_MATCHDAY = 999
const SEASON_START = '2026-08-01'

/** Markets that are no longer offered. Kept out of the betting UI and rejected
 *  here, but still handled by settlement so historical bets grade correctly. */
const RETIRED_MARKETS = new Set(['over_under_7_5'])

/** German display labels for the same-market-conflict error message below —
 *  kept local to this route (display labels are duplicated per-file
 *  throughout the codebase, not shared config). */
const MARKET_LABELS: Record<string, string> = {
  '1x2': '1X2',
  double_chance: 'Doppelte Chance',
  over_under: 'Über/Unter 2,5',
  over_under_3_5: 'Über/Unter 3,5',
  over_under_5_5: 'Über/Unter 5,5',
  over_under_7_5: 'Über/Unter 7,5',
  btts: 'Beide Teams treffen',
  handicap: 'Handicap',
  exact_score: 'Genaues Ergebnis',
  goalscorer: 'Torschütze',
  goalscorer_2plus: 'Torschütze (mind. 2 Tore)',
  cup_advance: 'Wer kommt weiter?',
  cup_first_goal: 'Wer erzielt das erste Tor?',
  cup_decision: 'Wie fällt die Entscheidung?',
  cup_halftime_lead_advance: 'Wildenroth führt zur Halbzeit & kommt weiter',
  cup_comeback_advance: 'Geiselbullach führt – Wildenroth kommt trotzdem weiter',
  cup_shootout_advance: 'Elfmeterschießen – Wildenroth kommt weiter',
  cup_early_goal: 'Frühes Tor Min. 1-15',
  cup_ht_more_goals: 'Mehr Tore in welcher Halbzeit?',
  cup_both_halves_btts: 'Beide Teams treffen in beiden Halbzeiten',
}

/** The current cup fixture (SpVgg Wildenroth vs TSV Geiselbullach,
 *  Sparkassen Fußball-Cup). Hardcoded, not derived via competition_type,
 *  since the "4. Wettschein" bonus rule (see below) is scoped to this one
 *  match by explicit product decision, not to "whichever match happens to be
 *  a cup fixture" in general. */
const CUP_BONUS_MATCH_ID = 573

interface PlaceBetSelection {
  matchId: number
  marketType: string
  selection: string
  oddsValue: number
  stake: number
}

interface PlaceBetBody {
  selections: PlaceBetSelection[]
  mode: 'single' | 'combo'
  comboStake: number
  isRisky?: boolean
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  // All balance/bet-row mutations use the service-role client: the RLS/GRANT
  // model on `bets`/`combo_bets`/the balance RPCs is locked down to service-role
  // only (see migration notes), so this route is the sole write path. Every
  // write below is still scoped to `user.id` from the verified session above.
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  // Saisonstart-Regel: nach Saisonstart dürfen nur berechtigte Nutzer (oder Admins) wetten
  const seasonStarted = await isSeasonStarted(supabase)
  if (seasonStarted) {
    const { data: eligProfile } = await supabase
      .from('profiles')
      .select('eligible_for_current_season, is_admin')
      .eq('id', user.id)
      .single()
    if (!eligProfile?.is_admin && !eligProfile?.eligible_for_current_season) {
      return NextResponse.json({ error: 'NOT_ELIGIBLE' }, { status: 403 })
    }
  }

  let body: PlaceBetBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  // Note: the client-supplied `isRisky` field is intentionally ignored — see
  // `effectiveRisky` below, derived server-side from validated odds.
  const { selections, mode, comboStake } = body

  if (!selections || selections.length === 0) {
    return NextResponse.json({ error: 'Keine Auswahlen.' }, { status: 400 })
  }

  // Validate stakes — must be a finite, positive number within bounds, with at
  // most 2 decimal places (e.g. 9,80 or 9,72 Wildis are valid stakes).
  // (Client only enforces min="1" in the UI, which a direct API call can bypass.)
  function isValidStake(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= MAX_STAKE
      && Math.round(n * 100) === n * 100
  }

  if (mode === 'combo') {
    if (!isValidStake(comboStake)) {
      return NextResponse.json(
        { error: `Einsatz muss zwischen 1 und ${MAX_STAKE} Wildis liegen.` },
        { status: 400 }
      )
    }
  } else {
    for (const s of selections) {
      if (!isValidStake(s.stake)) {
        return NextResponse.json(
          { error: `Einsatz muss zwischen 1 und ${MAX_STAKE} Wildis liegen.` },
          { status: 400 }
        )
      }
    }
  }

  // Retired markets: no longer offered in the UI, so reject them here too —
  // the client is not the security boundary. Settlement still understands them
  // so any bet placed before retirement grades correctly.
  for (const s of selections) {
    if (RETIRED_MARKETS.has(s.marketType)) {
      return NextResponse.json(
        { error: 'Dieser Wettmarkt wird nicht mehr angeboten.' },
        { status: 400 }
      )
    }
  }

  // Combo: reject multiple selections from the same match (all markets)
  if (mode === 'combo') {
    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {
        const a = selections[i], b = selections[j]
        if (a.matchId === b.matchId) {
          return NextResponse.json(
            { error: 'Ungültige Kombiwette – in einer Kombiwette darf jedes Spiel nur einmal vorkommen.' },
            { status: 400 }
          )
        }
        if (a.matchId !== b.matchId || a.marketType === b.marketType) continue
        const has = (m: string, s: string) =>
          (a.marketType === m && a.selection === s) || (b.marketType === m && b.selection === s)
        let bad = false
        if (has('1x2', 'home') && has('double_chance', 'x2')) bad = true
        if (has('1x2', 'away') && has('double_chance', '1x')) bad = true
        if (has('1x2', 'draw') && has('double_chance', '12')) bad = true
        const exact = a.marketType === 'exact_score' ? a : b.marketType === 'exact_score' ? b : null
        if (exact) {
          const [hg, ag] = exact.selection.split(':').map(Number)
          const t = hg + ag
          const diff = hg - ag
          if (has('1x2', 'home') && ag > hg) bad = true
          if (has('1x2', 'away') && hg >= ag) bad = true
          if (has('1x2', 'draw') && hg !== ag) bad = true
          if (has('over_under_3_5', 'over_3.5') && t <= 3) bad = true
          if (has('over_under_3_5', 'under_3.5') && t >= 4) bad = true
          if (has('over_under_5_5', 'over_5.5') && t <= 5) bad = true
          if (has('over_under_5_5', 'under_5.5') && t >= 6) bad = true
          if (has('over_under_7_5', 'over_7.5') && t <= 7) bad = true
          if (has('over_under_7_5', 'under_7.5') && t >= 8) bad = true
          if (has('btts', 'yes') && (hg === 0 || ag === 0)) bad = true
          if (has('btts', 'no') && hg > 0 && ag > 0) bad = true
          if (has('handicap', 'home_minus_1_5') && diff < 2) bad = true
          if (has('handicap', 'away_plus_1_5') && diff >= 2) bad = true
          if (has('handicap', 'home_minus_2_5') && diff < 3) bad = true
          if (has('handicap', 'away_plus_2_5') && diff >= 3) bad = true
          // Mirrored (away-favoured) direction.
          if (has('handicap', 'away_minus_1_5') && diff > -2) bad = true
          if (has('handicap', 'home_plus_1_5') && diff < -1) bad = true
          if (has('handicap', 'away_minus_2_5') && diff > -3) bad = true
          if (has('handicap', 'home_plus_2_5') && diff < -2) bad = true
        }
        if (has('handicap', 'home_minus_1_5') && has('1x2', 'draw')) bad = true
        if (has('handicap', 'home_minus_1_5') && has('1x2', 'away')) bad = true
        if (has('handicap', 'home_minus_2_5') && has('1x2', 'draw')) bad = true
        if (has('handicap', 'home_minus_2_5') && has('1x2', 'away')) bad = true
        if (has('handicap', 'away_minus_1_5') && has('1x2', 'draw')) bad = true
        if (has('handicap', 'away_minus_1_5') && has('1x2', 'home')) bad = true
        if (has('handicap', 'away_minus_2_5') && has('1x2', 'draw')) bad = true
        if (has('handicap', 'away_minus_2_5') && has('1x2', 'home')) bad = true
        if (bad) return NextResponse.json(
          { error: 'Ungültige Kombiwette – widersprüchliche Wetten für dasselbe Spiel.' },
          { status: 400 }
        )
      }
    }
  }

  // Fetch current selection matches to validate deadline and get matchdays
  const matchIds = [...new Set(selections.map((s) => s.matchId))]
  const { data: matches } = await supabase
    .from('matches')
    .select('id, match_number, match_date, status, matchday, home_team_id, away_team_id, match_category, is_topspiel, tippspiel_matchday, competition_type')
    .in('id', matchIds)

  if (!matches || matches.length !== matchIds.length) {
    return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 400 })
  }

  // Pokal-Spezial (competition_type='cup', see CupMatchCard) intentionally
  // offers only 8 markets — never the normal 1X2/Doppelte-Chance/Over-Under/
  // Handicap/Exact-Score set, even though the standard odds columns on its
  // `odds` row are also populated (the normal per-matchday freeze pipeline
  // computes them as a harmless byproduct; nothing else reads them). The UI
  // never renders those buttons for a cup match, but ODDS_COLUMN validation
  // below is market-agnostic and would otherwise accept a replayed/crafted
  // request for them — reject explicitly here instead of relying on the UI.
  // cup_both_halves_btts removed from CUP_ONLY_MARKETS — no longer offered for
  // new bets (0 bets placed, removed from UI). Settlement still handles it.
  const CUP_ONLY_MARKETS = ['cup_advance', 'cup_first_goal', 'cup_decision', 'cup_halftime_lead_advance', 'cup_comeback_advance', 'cup_shootout_advance', 'cup_early_goal', 'cup_ht_more_goals']
  const CUP_ALLOWED_MARKETS = new Set(['btts', 'goalscorer', ...CUP_ONLY_MARKETS])
  // Product decision: these markets are single-outcome "Ja"-only props (see
  // components/CupMatchCard.tsx) — 'no' is no longer offered for new bets on
  // the first 3 (round 2), but stays fully settleable for any bet placed
  // before that changed (settlement reads the stored selection off the bet
  // row, not this allow-list). cup_early_goal is now a proper 2-way market.
  const CUP_YES_ONLY_MARKETS = new Set(['cup_halftime_lead_advance', 'cup_comeback_advance', 'cup_shootout_advance'])
  const cupMatchIds = new Set(matches.filter(m => m.competition_type === 'cup').map(m => m.id))
  for (const s of selections) {
    if (cupMatchIds.has(s.matchId) && !CUP_ALLOWED_MARKETS.has(s.marketType)) {
      return NextResponse.json({ error: 'Dieser Markt wird für das Pokalspiel nicht angeboten.' }, { status: 400 })
    }
    if (!cupMatchIds.has(s.matchId) && CUP_ONLY_MARKETS.includes(s.marketType)) {
      return NextResponse.json({ error: 'Dieser Markt ist nur für das Pokalspiel verfügbar.' }, { status: 400 })
    }
    if (CUP_YES_ONLY_MARKETS.has(s.marketType) && s.selection !== 'yes') {
      return NextResponse.json({ error: 'Dieser Markt bietet für neue Wetten nur noch die Auswahl "Ja" an.' }, { status: 400 })
    }
  }

  // Full current-season match set, needed both to recompute exact-score odds and
  // to group matches by their EFFECTIVE Tippspiel-Spieltag (see lib/season.ts) —
  // a Wildenroth-II/Topspiel match keeps its own independent BFV matchday number,
  // so the per-matchday bet limit below must not group by the raw `matchday`
  // column or it disagrees with what tipps/page.tsx displayed and let the user bet.
  const { data: seasonMatchesRaw } = await supabase
    .from('matches')
    .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday')
    .or(`match_date.gte.${SEASON_START},matchday.eq.${TEST_MATCHDAY}`)
  const seasonMatchesForRequest = (seasonMatchesRaw ?? []) as Match[]
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatchesForRequest)

  // Goalscorer validation: player must be offered for that match, and the
  // submitted odds must match the frozen DB odds (within rounding).
  const goalscorerSels = selections.filter(s => s.marketType === 'goalscorer' || s.marketType === 'goalscorer_2plus')
  if (goalscorerSels.length > 0) {
    const matchPlayerKeys = goalscorerSels.map(s => ({ match_id: s.matchId, player_id: parseInt(s.selection, 10) }))
    if (matchPlayerKeys.some(k => !Number.isFinite(k.player_id))) {
      return NextResponse.json({ error: 'Ungültiger Torschützen-Tipp.' }, { status: 400 })
    }
    // frozen_at must be set — the admin recompute endpoint can now write a
    // draft preview (frozen_at null) before a Spieltag's betting window opens
    // so admins can check/adjust Torschützen odds early, and that draft must
    // never be bettable (same "not open yet" guarantee as the 1X2 markets,
    // which have no `odds` row at all until frozen).
    const { data: gsOddsRows } = await supabase
      .from('match_goalscorer_odds')
      .select('match_id, player_id, is_offered, is_offered_2plus, odds_score, odds_score_2plus, status')
      .in('match_id', matchPlayerKeys.map(k => k.match_id))
      .in('player_id', matchPlayerKeys.map(k => k.player_id))
      .not('frozen_at', 'is', null)

    const gsMap = new Map(
      (gsOddsRows ?? []).map(r => [`${r.match_id}-${r.player_id}`, r])
    )

    for (const s of goalscorerSels) {
      const row = gsMap.get(`${s.matchId}-${parseInt(s.selection, 10)}`)
      if (!row) {
        return NextResponse.json({ error: 'Torschützen-Tipp nicht verfügbar.' }, { status: 400 })
      }
      const offered = s.marketType === 'goalscorer' ? row.is_offered : row.is_offered_2plus
      const expectedOdds = s.marketType === 'goalscorer' ? Number(row.odds_score) : Number(row.odds_score_2plus)
      if (!offered || row.status !== 'available') {
        return NextResponse.json({ error: 'Spieler aktuell nicht wettbar.' }, { status: 400 })
      }
      if (Math.abs(expectedOdds - s.oddsValue) > 0.011) {
        return NextResponse.json({ error: 'Quote hat sich geändert. Bitte Auswahl aktualisieren.' }, { status: 400 })
      }
    }
  }

  // Standard-market odds validation: the client computes/displays odds but the
  // server must not trust them blindly — otherwise a direct API call could submit
  // an inflated oddsValue and get paid out at a fabricated rate. Validate against
  // the frozen `odds` row for that match (the same values the client was shown).
  const oddsCheckedSels = selections.filter(s => ODDS_COLUMN[s.marketType])
  const exactScoreSels = selections.filter(s => s.marketType === 'exact_score')

  if (oddsCheckedSels.length > 0 || exactScoreSels.length > 0) {
    const { data: oddsRows } = await supabase
      .from('odds')
      .select('*')
      .in('match_id', matchIds)
    const oddsMap = new Map((oddsRows ?? []).map(r => [r.match_id, r]))

    // Admin odds overrides (per-market manual corrections) must win here too —
    // tipps/page.tsx already merges these for display, and a bet must validate
    // against exactly what the user was shown, or every overridden market gets
    // rejected with "Quote hat sich geändert" the moment someone tries to bet it.
    const { data: overrideRows } = await admin
      .from('match_odds_overrides')
      .select('*')
      .in('match_id', matchIds)
    const exactOverrideMap = new Map<number, Record<string, number>>()
    for (const ov of overrideRows ?? []) {
      if (ov.exact_score_overrides) exactOverrideMap.set(ov.match_id, ov.exact_score_overrides)
      const existing = oddsMap.get(ov.match_id)
      if (!existing) continue
      const merged = { ...existing }
      for (const col of Object.keys(ov)) {
        if (col === 'match_id' || col === 'updated_by' || col === 'updated_at' || col === 'exact_score_overrides') continue
        if (ov[col] != null) merged[col] = ov[col]
      }
      oddsMap.set(ov.match_id, merged)
    }

    for (const s of oddsCheckedSels) {
      const row = oddsMap.get(s.matchId)
      const col = ODDS_COLUMN[s.marketType][s.selection]
      if (!row || !col || row[col] == null) {
        return NextResponse.json({ error: 'Quote nicht verfügbar. Bitte Seite neu laden.' }, { status: 400 })
      }
      // Handicap only ever offers ONE direction per match (whichever team is
      // actually favoured, see lib/oddsMarkets.ts) — both directions' odds
      // are always computed/stored (an admin can override either), but the
      // non-offered direction is never a real bettable market and must be
      // rejected here even though its price validates fine.
      if (s.marketType === 'handicap' && !offeredHandicapSelections(row as { home_win: number; away_win: number }).includes(s.selection)) {
        return NextResponse.json({ error: 'Handicap-Richtung nicht verfügbar. Bitte Seite neu laden.' }, { status: 400 })
      }
      if (Math.abs(Number(row[col]) - s.oddsValue) > 0.02) {
        return NextResponse.json({ error: 'Quote hat sich geändert. Bitte Auswahl aktualisieren.' }, { status: 400 })
      }
    }

    // Exact score odds are validated against the persisted per-match auto grid
    // (odds.exact_score_odds, frozen alongside the standard markets) merged with
    // any admin override — the same source of truth tipps/page.tsx used to show
    // the score to the user — never a live recompute here (see lib/odds.ts
    // mergeExactScoreOffers). A score not present in the merged, MAX_EXACT_ODDS-
    // filtered list is not currently offered and is rejected outright.
    for (const s of exactScoreSels) {
      const row = oddsMap.get(s.matchId)
      const match = matches.find((m) => m.id === s.matchId)
      if (!row || !match) {
        return NextResponse.json({ error: 'Quote nicht verfügbar. Bitte Seite neu laden.' }, { status: 400 })
      }
      const [hg, ag] = s.selection.split(':').map(Number)
      if (!Number.isFinite(hg) || !Number.isFinite(ag)) {
        return NextResponse.json({ error: 'Ungültiger Ergebnis-Tipp.' }, { status: 400 })
      }

      const offers = mergeExactScoreOffers(row.exact_score_odds, exactOverrideMap.get(s.matchId))
      const offer = offers.find((o) => o.score === s.selection)
      if (!offer || Math.abs(offer.odds - s.oddsValue) > 0.02) {
        return NextResponse.json({ error: 'Quote hat sich geändert. Bitte Auswahl aktualisieren.' }, { status: 400 })
      }
    }
  }

  // This new slip's own odds, from the now-validated values (never trust the
  // client's `isRisky` field). Whether it actually ends up Risky depends on
  // the user's WHOLE active slip set for the Spieltag, not on this value in
  // isolation — see lib/risky.ts. This is only used as the initial DB value
  // at insert time; recomputeRiskyForUserMatchday() below is authoritative
  // and corrects it (and every other affected slip) right after insertion.
  const effectiveTotalOdds =
    mode === 'combo'
      ? selections.reduce((acc, s) => acc * s.oddsValue, 1)
      : selections[0]?.oddsValue ?? 0
  const effectiveRisky = effectiveTotalOdds > RISKY_ODDS_THRESHOLD

  // Wildenroth conflict-of-interest check (mirrors the frontend guard).
  // Team 1 and Team 2 flags are independent — a user can be flagged for either or both.
  const { data: profileFlags } = await supabase
    .from('profiles')
    .select('is_wildenroth, is_wildenroth_ii')
    .eq('id', user.id)
    .single()

  if (profileFlags?.is_wildenroth || profileFlags?.is_wildenroth_ii) {
    const { data: wildenrothTeamRows } = await supabase
      .from('teams')
      .select('id, name')
      .in('name', ['SpVgg Wildenroth', 'SpVgg Wildenroth II'])
    const team1Id = wildenrothTeamRows?.find((t) => t.name === 'SpVgg Wildenroth')?.id ?? null
    const team2Id = wildenrothTeamRows?.find((t) => t.name === 'SpVgg Wildenroth II')?.id ?? null

    const flaggedTeamIds = [
      ...(profileFlags?.is_wildenroth && team1Id != null ? [team1Id] : []),
      ...(profileFlags?.is_wildenroth_ii && team2Id != null ? [team2Id] : []),
    ]

    for (const s of selections) {
      const m = matches.find((x) => x.id === s.matchId)
      if (!m) continue
      for (const teamId of flaggedTeamIds) {
        const involves = m.home_team_id === teamId || m.away_team_id === teamId
        if (!involves) continue
        const wildenrothIsHome = m.home_team_id === teamId
        if (
          isAgainstWildenroth(s.marketType, s.selection, {
            isWildenrothPlayer: true,
            matchInvolvesWildenroth: true,
            wildenrothIsHome,
          })
        ) {
          return NextResponse.json(
            {
              error:
                'Als Wildenroth-Spieler oder -Trainer darfst du nicht gegen dein eigenes Team wetten.',
            },
            { status: 400 },
          )
        }
      }
    }
  }

  // Enforce Tippschluss: single bets are valid until that match's own kickoff.
  // Combo bets require ALL included matches to not have started yet.
  if (mode === 'combo') {
    for (const match of matches) {
      if (new Date(match.match_date) <= new Date() || match.status !== 'scheduled') {
        return NextResponse.json(
          { error: 'Für Kombiwetten müssen alle enthaltenen Spiele noch nicht begonnen haben.' },
          { status: 400 }
        )
      }
    }
  } else {
    for (const sel of selections) {
      const match = matches.find((m) => m.id === sel.matchId)!
      if (new Date(match.match_date) <= new Date() || match.status !== 'scheduled') {
        return NextResponse.json(
          { error: 'Annahmeschluss für dieses Spiel ist bereits abgelaufen.' },
          { status: 400 }
        )
      }
    }
  }

  // Reject backing two different outcomes of the SAME market on the SAME match.
  // That is never a bet, it is a hedge — and on a two-way market whose short side
  // sits near the odds floor it can be an outright arbitrage. The betting UI
  // already treats a second selection in one market as a replacement, so this
  // only closes the direct-API path. (Cross-market hedges like 1X2 + Doppelte
  // Chance stay allowed; the odds floor in lib/odds.ts keeps those books > 1.)
  {
    // Service-role read: this check is a security boundary (blocks hedging/
    // arbitrage), so it must not depend on whatever the session-scoped RLS
    // policy happens to currently allow the caller to see of their own rows.
    const { data: sameMarket } = await admin
      .from('bets')
      .select('match_id, market_type, selection')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .in('match_id', matchIds)
    for (const s of selections) {
      const conflict = (sameMarket ?? []).find(
        (b) => b.match_id === s.matchId && b.market_type === s.marketType && b.selection !== s.selection &&
          // Handicap has TWO independent lines (±1.5 and ±2.5) sharing one
          // market_type — a 1.5 and a 2.5 bet on the SAME favoured side are
          // correlated, not opposite (winning the 2.5 line always wins the
          // 1.5 line too), so only the true complementary pair for the SAME
          // line counts as a hedge here. Every other market has just one
          // line, where any two different selections genuinely are opposite
          // outcomes.
          (b.market_type !== 'handicap' || HANDICAP_OPPOSITE[s.selection] === b.selection)
      )
      if (conflict) {
        // Name the actual match + market so the user knows exactly which
        // existing bet to cancel first, instead of a generic "this game".
        const { data: cm } = await supabase
          .from('matches')
          .select('home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
          .eq('id', conflict.match_id)
          .single() as { data: { home_team: { name: string } | { name: string }[] | null; away_team: { name: string } | { name: string }[] | null } | null }
        const home = Array.isArray(cm?.home_team) ? cm.home_team[0]?.name : cm?.home_team?.name
        const away = Array.isArray(cm?.away_team) ? cm.away_team[0]?.name : cm?.away_team?.name
        const matchLabel = home && away ? `${home} – ${away}` : 'diesem Spiel'
        const marketLabel = MARKET_LABELS[conflict.market_type] ?? conflict.market_type
        return NextResponse.json(
          { error: `Für ${matchLabel} hast du im Markt ${marketLabel} bereits eine Wette auf einen anderen Ausgang platziert. Du kannst nicht gleichzeitig auf entgegengesetzte Ausgänge desselben Markts wetten — storniere die bestehende Wette zuerst, wenn du deine Auswahl ändern möchtest.` },
          { status: 400 }
        )
      }
    }
  }

  // Enforce bet limit per matchday: max 2 normal slips; a 3rd is only allowed
  // once at least one of the user's active slips for that Spieltag has odds
  // > RISKY_ODDS_THRESHOLD — and then it is always the single highest-odds
  // slip that counts as Risky, never every slip whose own odds exceed the
  // threshold (see lib/risky.ts). A combo counts as ONE slip, not per leg.
  // Grouped by EFFECTIVE Spieltag (lib/season.ts), not the raw `matchday` column —
  // a Wildenroth-II/Topspiel match keeps its own independent BFV matchday number,
  // and the limit must apply to the Spieltag the user actually bet under on /tipps.
  // Cup matches (competition_type='cup') return null from effectiveMatchdayOf
  // since they don't belong to the Kreisliga/WildenrothII/Topspiel structure.
  // Use their raw matchday number directly so the per-matchday limit and bonus
  // slot checks run correctly for cup-only submissions.
  const matchdayIds = [...new Set(
    matches.map((m) => m.competition_type === 'cup' ? m.matchday : effectiveMatchdayOf(m as Match, mdIndex)).filter((md): md is number => md !== null)
  )]
  // Captured here so the recompute pass after insertion (below) doesn't have
  // to redo this lookup — same set of match ids used for both.
  const matchdayAllIds = new Map<number, number[]>()

  // "4. Wettschein" Pokal-Bonus (round 6, see CLAUDE.md "TEIL 2"). The cup
  // fixture's own effective Spieltag — looked up from the FULL season match
  // set (seasonMatchesForRequest) so it resolves even when match 573 isn't
  // itself part of THIS submission's `matches`.
  const cupMatchRow = seasonMatchesForRequest.find((m) => m.id === CUP_BONUS_MATCH_ID)
  // Cup match returns null from effectiveMatchdayOf (not part of Kreisliga
  // structure) — use its raw matchday directly (7 for this cup fixture).
  const cupMatchday = cupMatchRow ? cupMatchRow.matchday : null
  // A submission is a BONUS CANDIDATE only if it is a bare single-leg bet on
  // match 573 — a combo containing 573 alongside other matches, or a single-
  // mode submission with several selections, never qualifies (spec: "mode
  // must be 'single', exactly 1 selection, that selection's matchId 573").
  const isBonusCandidateSubmission =
    mode === 'single' && selections.length === 1 && selections[0].matchId === CUP_BONUS_MATCH_ID
  // Set true below only when this submission is actually granted the bonus
  // slot; read at insert time to set bets.is_bonus and to force is_risky=false.
  let submissionIsBonus = false

  for (const matchday of matchdayIds) {
    const isCupMatchday = cupMatchday !== null && matchday === cupMatchday
    // All matches sharing this effective Spieltag (not just current selection).
    // CUP_BONUS_MATCH_ID is included manually when on the cup matchday since
    // effectiveMatchdayOf returns null for cup matches.
    const allMatchdayIds = seasonMatchesForRequest
      .filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)
      .map((m) => m.id)
    if (isCupMatchday && !allMatchdayIds.includes(CUP_BONUS_MATCH_ID)) {
      allMatchdayIds.push(CUP_BONUS_MATCH_ID)
    }

    if (allMatchdayIds.length === 0) continue
    matchdayAllIds.set(matchday, allMatchdayIds)

    // Service-role read: this is the actual security boundary for the
    // per-matchday bet limit, so it must never depend on the caller's own
    // session-scoped RLS visibility into their own rows — a future RLS
    // change (or bug) must not be able to silently disable this limit.
    // Counts 'pending' AND already-settled ('won'/'lost') slips: the limit is
    // on how many slips a user placed for this Spieltag, not on how many are
    // still open — settlement runs per match, so one match in a Spieltag can
    // finish (freeing nothing) while others are still scheduled, and a slip
    // settling early must not hand back a slot to bet again. A cancelled bet
    // (soft-cancelled to status='void', not deleted — see /api/bets/cancel)
    // never occupies a slot here, since 'void' is deliberately excluded from
    // this status list.
    const { data: existingLegs } = await admin
      .from('bets')
      .select('id, combo_id, odds_value, match_id, is_bonus')
      .eq('user_id', user.id)
      .in('status', ['pending', 'won', 'lost'])
      .in('match_id', allMatchdayIds)
    // Per spec: "cup573AlreadyUsedInNormalSlips" — despite the name, this is
    // simply "was match 573 already used in ANY earlier slip this Spieltag"
    // (normal slot OR bonus slot) — there can only ever be ONE bet on 573
    // per user per matchday, appearing either inside a normal slot or as the
    // bonus slot, never both, never twice.
    const cup573AlreadyUsed = isCupMatchday && (existingLegs ?? []).some((b) => b.match_id === CUP_BONUS_MATCH_ID)
    const bonusAlreadyUsed = isCupMatchday && (existingLegs ?? []).some((b) => b.is_bonus === true)

    const existingComboIds = [...new Set((existingLegs ?? []).filter((b) => b.combo_id != null).map((b) => b.combo_id as number))]
    let existingCombos: { id: number; total_odds: number }[] = []
    if (existingComboIds.length > 0) {
      const { data } = await admin.from('combo_bets').select('id, total_odds').in('id', existingComboIds).in('status', ['pending', 'won', 'lost'])
      existingCombos = data ?? []
    }

    // The bonus slip is a fully separate allowance — it must NOT occupy (or
    // be occupied by) a normal-budget slot, so it's excluded here. It's
    // always single_id/combo_id==null, so only the single-leg filter needs it.
    const existingSlips: RiskySlip[] = [
      ...(existingLegs ?? []).filter((b) => b.combo_id == null && !b.is_bonus).map((b) => ({ id: `bet-${b.id}`, odds: Number(b.odds_value) })),
      ...existingCombos.map((c) => ({ id: `combo-${c.id}`, odds: Number(c.total_odds) })),
    ]

    // Simulate the user's slip set for this Spieltag AFTER this request's new
    // slip(s) were added — a combo is one new slip regardless of matchday (it
    // can't span matches from different Spieltage in practice, since the bet
    // slip only ever holds one Spieltag's matches at a time); single mode may
    // submit several selections at once, each its own slip.
    const newSlipsHere: RiskySlip[] = mode === 'combo'
      ? [{ id: 'new-combo', odds: effectiveTotalOdds }]
      : selections
          .filter((s) => {
            const m = matches.find((match) => match.id === s.matchId)
            if (!m) return false
            const mMatchday = m.competition_type === 'cup' ? m.matchday : effectiveMatchdayOf(m as Match, mdIndex)
            return mMatchday === matchday
          })
          .map((s, i) => ({ id: `new-${i}`, odds: s.oddsValue }))

    if (isCupMatchday) {
      const submissionTouches573 = selections.some((s) => s.matchId === CUP_BONUS_MATCH_ID)
      if (submissionTouches573 && cup573AlreadyUsed) {
        return NextResponse.json(
          { error: 'Das Pokalspiel wurde für diesen Spieltag bereits verwendet.' },
          { status: 400 }
        )
      }

      if (isBonusCandidateSubmission) {
        // Prefer NOT using the bonus slot for as long as a normal slot is
        // still available — check the normal budget FIRST, exactly like any
        // other single-match bet would (existing evaluateSlips logic,
        // unchanged). Only once that budget is exhausted does this fall
        // through to the bonus path below.
        const { valid: fitsNormalBudget } = evaluateSlips([...existingSlips, ...newSlipsHere])
        if (!fitsNormalBudget) {
          if (bonusAlreadyUsed) {
            return NextResponse.json(
              {
                error: `Maximal 3 Wettscheine pro Spieltag erlaubt (der Pokal-Bonusschein wurde für Spieltag ${matchday} bereits verwendet). Du hast für Spieltag ${matchday} bereits ${existingSlips.length} Wettschein(e).`,
              },
              { status: 400 }
            )
          }
          // Normal budget full, match 573 not used elsewhere, bonus not used
          // yet → this submission becomes the 4. Wettschein (Pokal-Bonus).
          // Bypasses the normal evaluateSlips check entirely for this
          // matchday — it is additive, not counted against the 3-slip budget.
          submissionIsBonus = true
          continue
        }
        // Falls through to the normal evaluateSlips check below, which will
        // pass (fitsNormalBudget was true) — this bet consumes a normal slot.
      }
    }

    const { valid, riskyId } = evaluateSlips([...existingSlips, ...newSlipsHere])
    if (!valid) {
      const hasRisky = riskyId !== null
      return NextResponse.json(
        {
          error: hasRisky
            ? `Maximal 3 Wettscheine pro Spieltag erlaubt. Ein 3. Schein ist nur erlaubt, wenn mindestens einer deiner Scheine eine Quote über 20,00 hat. Du hast für Spieltag ${matchday} bereits ${existingSlips.length} Wettschein(e).`
            : `Maximal 2 Wettscheine pro Spieltag erlaubt, solange keiner deiner Scheine eine Quote über 20,00 hat. Du hast für Spieltag ${matchday} bereits ${existingSlips.length} Wettschein(e).`,
        },
        { status: 400 }
      )
    }
  }

  // Use test season label for test matchday so bets are excluded from real leaderboard P&L
  const isTestMatchday = matches.some(m => m.matchday === TEST_MATCHDAY)
  const betSeason = isTestMatchday ? 'TEST' : CURRENT_SEASON

  // Calculate total cost
  let totalCost = 0
  if (mode === 'combo') {
    totalCost = comboStake
  } else {
    totalCost = selections.reduce((acc, s) => acc + s.stake, 0)
  }

  // Deduct balance FIRST via an atomic DB function (UPDATE ... WHERE balance >= amount
  // in a single statement) — this closes a double-spend race where two concurrent
  // requests could both read the same stale balance and both succeed. Doing this
  // before inserting bet rows also avoids ever persisting a "free" unpaid bet if a
  // later step fails; if bet insertion fails afterward we refund via increment_balance.
  const { data: newBalanceAfterDeduct, error: deductError } = await admin.rpc('deduct_balance', {
    p_user_id: user.id,
    p_amount: totalCost,
  })

  if (deductError) {
    if (deductError.message?.includes('INSUFFICIENT_BALANCE')) {
      const { data: profile } = await supabase.from('profiles').select('balance').eq('id', user.id).single()
      return NextResponse.json(
        { error: `Nicht genug Guthaben. Verfügbar: ${(profile?.balance ?? 0).toFixed(2)} Wildis, Benötigt: ${totalCost.toFixed(2)} Wildis` },
        { status: 400 }
      )
    }
    console.error('deduct_balance error:', deductError)
    return NextResponse.json({ error: 'Fehler beim Verarbeiten des Einsatzes.' }, { status: 500 })
  }

  // Place bets
  if (mode === 'combo') {
    const totalOdds = selections.reduce((acc, s) => acc * s.oddsValue, 1)

    const { data: comboBet, error: comboError } = await admin
      .from('combo_bets')
      .insert({
        user_id: user.id,
        stake: comboStake,
        total_odds: Math.round(totalOdds * 100) / 100,
        status: 'pending',
        payout: null,
        season: betSeason,
      })
      .select('id')
      .single()

    if (comboError || !comboBet) {
      console.error('combo_bets insert error:', comboError)
      await admin.rpc('increment_balance', { p_user_id: user.id, p_amount: totalCost })
      return NextResponse.json({ error: 'Fehler beim Erstellen der Kombiwette.' }, { status: 500 })
    }

    const betRows = selections.map((s) => ({
      user_id: user.id,
      match_id: s.matchId,
      market_type: s.marketType,
      selection: s.selection,
      stake: null,
      odds_value: s.oddsValue,
      status: 'pending',
      payout: null,
      combo_id: comboBet.id,
      is_risky: effectiveRisky,
      season: betSeason,
    }))

    const { error: betsError } = await admin.from('bets').insert(betRows)
    if (betsError) {
      console.error('bets insert error (combo legs):', betsError)
      await admin.rpc('increment_balance', { p_user_id: user.id, p_amount: totalCost })
      await admin.from('combo_bets').delete().eq('id', comboBet.id)
      return NextResponse.json({ error: 'Fehler beim Speichern der Wetten.' }, { status: 500 })
    }
  } else {
    const betRows = selections.map((s) => ({
      user_id: user.id,
      match_id: s.matchId,
      market_type: s.marketType,
      selection: s.selection,
      stake: s.stake,
      odds_value: s.oddsValue,
      status: 'pending',
      payout: null,
      combo_id: null,
      // Pokal-Bonus (4. Wettschein): NEVER flagged risky regardless of odds
      // (see CLAUDE.md TEIL 2) — sits entirely outside the normal risky-
      // accounting system, so it's forced false here rather than derived
      // from effectiveRisky, and excluded from recomputeRiskyForUserMatchday
      // below (lib/risky.ts skips is_bonus rows).
      is_risky: submissionIsBonus ? false : effectiveRisky,
      is_bonus: submissionIsBonus,
      season: betSeason,
    }))

    const { error: betsError } = await admin.from('bets').insert(betRows)
    if (betsError) {
      console.error('bets insert error (single):', betsError)
      await admin.rpc('increment_balance', { p_user_id: user.id, p_amount: totalCost })
      return NextResponse.json({ error: 'Fehler beim Speichern der Wetten.' }, { status: 500 })
    }
  }

  // Authoritative Risky reclassification: the row(s) just inserted used
  // `effectiveRisky` as a provisional value, which only reflects this new
  // slip's own odds. The actual classification depends on the user's WHOLE
  // active slip set for each affected Spieltag (see lib/risky.ts) — e.g. this
  // new slip's odds might now be the highest, bumping a previously-Risky
  // slip back to normal. Runs once per affected Spieltag, using the same
  // match-id sets already gathered above.
  for (const allMatchdayIds of matchdayAllIds.values()) {
    await recomputeRiskyForUserMatchday(admin, user.id, allMatchdayIds)
  }

  // /tipps and /leaderboard use time-based revalidation (revalidate = 60);
  // without an explicit purge here, the next request within that window
  // (including the client's own router.refresh() right after this call)
  // could still be served a stale full-route-cache entry that predates this
  // bet — up to 60s of the user not seeing their own just-placed bet.
  revalidatePath('/tipps')
  revalidatePath('/leaderboard')

  return NextResponse.json({ success: true, newBalance: newBalanceAfterDeduct })
}
