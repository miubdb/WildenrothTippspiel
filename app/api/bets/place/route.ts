import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAgainstWildenroth } from '@/lib/wildenroth'
import { isSeasonStarted, buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { ODDS_COLUMN } from '@/lib/oddsMarkets'
import { getExactScoreOdds } from '@/lib/odds'
import type { Match } from '@/types'

const MAX_STAKE = 250
const CURRENT_SEASON = '26/27'
const TEST_MATCHDAY = 999
const SEASON_START = '2026-08-01'
// Server-side ceiling for exact-score odds is recomputed without prior-season
// blending (unlike the frozen model), so it won't match the true value exactly —
// this multiplicative+additive margin absorbs that gap while still catching a
// wildly inflated client-supplied odds value (see lib/odds.ts MAX_EXACT_ODDS).
const EXACT_SCORE_CEILING_MULT = 1.3
const EXACT_SCORE_CEILING_ADD = 2

/** Markets that are no longer offered. Kept out of the betting UI and rejected
 *  here, but still handled by settlement so historical bets grade correctly. */
const RETIRED_MARKETS = new Set(['over_under_7_5'])

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
        }
        if (has('handicap', 'home_minus_1_5') && has('1x2', 'draw')) bad = true
        if (has('handicap', 'home_minus_1_5') && has('1x2', 'away')) bad = true
        if (has('handicap', 'home_minus_2_5') && has('1x2', 'draw')) bad = true
        if (has('handicap', 'home_minus_2_5') && has('1x2', 'away')) bad = true
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
    .select('id, match_number, match_date, status, matchday, home_team_id, away_team_id, match_category, is_topspiel, tippspiel_matchday')
    .in('id', matchIds)

  if (!matches || matches.length !== matchIds.length) {
    return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 400 })
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
    const { data: gsOddsRows } = await supabase
      .from('match_goalscorer_odds')
      .select('match_id, player_id, is_offered, is_offered_2plus, odds_score, odds_score_2plus, status')
      .in('match_id', matchPlayerKeys.map(k => k.match_id))
      .in('player_id', matchPlayerKeys.map(k => k.player_id))

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
    for (const ov of overrideRows ?? []) {
      const existing = oddsMap.get(ov.match_id)
      if (!existing) continue
      const merged = { ...existing }
      for (const col of Object.keys(ov)) {
        if (col === 'match_id' || col === 'updated_by' || col === 'updated_at') continue
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
      if (Math.abs(Number(row[col]) - s.oddsValue) > 0.02) {
        return NextResponse.json({ error: 'Quote hat sich geändert. Bitte Auswahl aktualisieren.' }, { status: 400 })
      }
    }

    // Exact score odds aren't frozen in a dedicated column (computed on the fly).
    // First a cheap sanity bound: a specific score can never be more likely
    // (i.e. never have lower odds) than the broad 1X2 outcome it belongs to.
    // Then a real bound: recompute the model's own odds for that scoreline and
    // reject anything far above it — otherwise any score up to the flat 60.02
    // ceiling would be accepted regardless of how likely it actually is.
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
      const directionOdds = hg > ag ? Number(row.home_win) : hg < ag ? Number(row.away_win) : Number(row.draw)
      if (s.oddsValue < directionOdds - 0.02 || s.oddsValue > 60.02) {
        return NextResponse.json({ error: 'Quote hat sich geändert. Bitte Auswahl aktualisieren.' }, { status: 400 })
      }
      const exactRows = getExactScoreOdds(seasonMatchesForRequest, match.home_team_id, match.away_team_id)
      const exactRow = exactRows.find((r) => r.score === s.selection)
      if (!exactRow || s.oddsValue > exactRow.odds * EXACT_SCORE_CEILING_MULT + EXACT_SCORE_CEILING_ADD) {
        return NextResponse.json({ error: 'Quote hat sich geändert. Bitte Auswahl aktualisieren.' }, { status: 400 })
      }
    }
  }

  // Derive the "risky" flag from the now-validated odds instead of trusting the
  // client's `isRisky` field — otherwise a bet with real odds > 20 could be
  // submitted as `isRisky: false` and consume a normal-bucket slot instead of
  // the single risky slot, bypassing the per-matchday limit below entirely.
  const effectiveTotalOdds =
    mode === 'combo'
      ? selections.reduce((acc, s) => acc * s.oddsValue, 1)
      : selections[0]?.oddsValue ?? 0
  const effectiveRisky = effectiveTotalOdds > 20

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
    const { data: sameMarket } = await supabase
      .from('bets')
      .select('match_id, market_type, selection')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .in('match_id', matchIds)
    for (const s of selections) {
      const conflict = (sameMarket ?? []).find(
        (b) => b.match_id === s.matchId && b.market_type === s.marketType && b.selection !== s.selection
      )
      if (conflict) {
        return NextResponse.json(
          { error: 'Du hast für dieses Spiel bereits eine Wette im selben Markt platziert. Bitte storniere sie zuerst.' },
          { status: 400 }
        )
      }
    }
  }

  // Enforce bet limit per matchday: max 3 total, max 2 with odds <= 20.
  // Grouped by EFFECTIVE Spieltag (lib/season.ts), not the raw `matchday` column —
  // a Wildenroth-II/Topspiel match keeps its own independent BFV matchday number,
  // and the limit must apply to the Spieltag the user actually bet under on /tipps.
  const matchdayIds = [...new Set(
    matches.map((m) => effectiveMatchdayOf(m as Match, mdIndex)).filter((md): md is number => md !== null)
  )]
  for (const matchday of matchdayIds) {
    // All matches sharing this effective Spieltag (not just current selection)
    const allMatchdayIds = seasonMatchesForRequest
      .filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)
      .map((m) => m.id)

    if (allMatchdayIds.length === 0) continue

    // Count existing normal single bets for this matchday
    const { count: singleCount } = await supabase
      .from('bets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_risky', false)
      .is('combo_id', null)
      .in('match_id', allMatchdayIds)

    // Count distinct normal combo bets for this matchday via their legs
    const { data: comboLegs } = await supabase
      .from('bets')
      .select('combo_id')
      .eq('user_id', user.id)
      .eq('is_risky', false)
      .not('combo_id', 'is', null)
      .in('match_id', allMatchdayIds)

    const distinctCombos = new Set((comboLegs ?? []).map((b) => b.combo_id)).size
    const existingNormalCount = (singleCount ?? 0) + distinctCombos

    // Count existing risky bets (singles + combos) for this matchday
    const { data: riskyLegs } = await supabase
      .from('bets')
      .select('combo_id')
      .eq('user_id', user.id)
      .eq('is_risky', true)
      .in('match_id', allMatchdayIds)

    const riskySingles = (riskyLegs ?? []).filter((b) => !b.combo_id).length
    const riskyCombos = new Set((riskyLegs ?? []).filter((b) => b.combo_id).map((b) => b.combo_id)).size
    const existingRiskyCount = riskySingles + riskyCombos

    const existingTotalCount = existingNormalCount + existingRiskyCount
    const newBetCount = mode === 'combo' ? 1 : selections.filter((s) => {
      const m = matches.find((match) => match.id === s.matchId)
      return m && effectiveMatchdayOf(m as Match, mdIndex) === matchday
    }).length

    // Max 3 bets per matchday (total)
    if (existingTotalCount + newBetCount > 3) {
      return NextResponse.json(
        { error: `Maximal 3 Wetten pro Spieltag erlaubt. Du hast bereits ${existingTotalCount} Wette(n) für Spieltag ${matchday} platziert.` },
        { status: 400 }
      )
    }

    // Max 2 bets with odds <= 20 per matchday
    if (!effectiveRisky && existingNormalCount + newBetCount > 2) {
      return NextResponse.json(
        { error: `Maximal 2 Wetten mit Quote ≤ 20,0 pro Spieltag. Du hast bereits ${existingNormalCount} solche Wette(n) für Spieltag ${matchday} platziert.` },
        { status: 400 }
      )
    }

    // Max 1 risky bet (odds > 20) per matchday
    if (effectiveRisky && existingRiskyCount + newBetCount > 1) {
      return NextResponse.json(
        { error: `Maximal 1 Risky-Wette pro Spieltag erlaubt. Du hast bereits eine Risky-Wette für Spieltag ${matchday} platziert.` },
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
      is_risky: effectiveRisky,
      season: betSeason,
    }))

    const { error: betsError } = await admin.from('bets').insert(betRows)
    if (betsError) {
      console.error('bets insert error (single):', betsError)
      await admin.rpc('increment_balance', { p_user_id: user.id, p_amount: totalCost })
      return NextResponse.json({ error: 'Fehler beim Speichern der Wetten.' }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, newBalance: newBalanceAfterDeduct })
}
