import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAgainstWildenroth } from '@/lib/wildenroth'
import { isSeasonStarted } from '@/lib/season'

const MAX_STAKE = 250
const CURRENT_SEASON = '26/27'
const TEST_MATCHDAY = 999

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

  const { selections, mode, comboStake, isRisky } = body

  if (!selections || selections.length === 0) {
    return NextResponse.json({ error: 'Keine Auswahlen.' }, { status: 400 })
  }

  // Validate stakes — must be a finite, whole, positive number within bounds.
  // (Client only enforces min="1" in the UI, which a direct API call can bypass.)
  function isValidStake(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= MAX_STAKE
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

  // Risky Wette validation: single bet (1 selection) or combo — total odds must exceed 20
  if (isRisky) {
    const totalOdds =
      mode === 'combo'
        ? selections.reduce((acc, s) => acc * s.oddsValue, 1)
        : selections[0]?.oddsValue ?? 0
    if (totalOdds <= 20) {
      return NextResponse.json(
        { error: 'Risky Wette erfordert eine Gesamtquote über 20.' },
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
    .select('id, match_date, status, matchday, home_team_id, away_team_id')
    .in('id', matchIds)

  if (!matches || matches.length !== matchIds.length) {
    return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 400 })
  }

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
  const ODDS_COLUMN: Record<string, Record<string, string>> = {
    '1x2': { home: 'home_win', draw: 'draw', away: 'away_win' },
    double_chance: { '1x': 'odds_1x', x2: 'odds_x2', '12': 'odds_12' },
    over_under: { 'over_2.5': 'over_2_5', 'under_2.5': 'under_2_5' },
    over_under_3_5: { 'over_3.5': 'over_3_5', 'under_3.5': 'under_3_5' },
    over_under_5_5: { 'over_5.5': 'over_5_5', 'under_5.5': 'under_5_5' },
    over_under_7_5: { 'over_7.5': 'over_7_5', 'under_7.5': 'under_7_5' },
    btts: { yes: 'btts_yes', no: 'btts_no' },
    handicap: {
      home_minus_1_5: 'hdp_home_minus_1_5',
      away_plus_1_5: 'hdp_away_plus_1_5',
      home_minus_2_5: 'hdp_home_minus_2_5',
      away_plus_2_5: 'hdp_away_plus_2_5',
    },
  }
  const oddsCheckedSels = selections.filter(s => ODDS_COLUMN[s.marketType])
  const exactScoreSels = selections.filter(s => s.marketType === 'exact_score')

  if (oddsCheckedSels.length > 0 || exactScoreSels.length > 0) {
    const { data: oddsRows } = await supabase
      .from('odds')
      .select('*')
      .in('match_id', matchIds)
    const oddsMap = new Map((oddsRows ?? []).map(r => [r.match_id, r]))

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

    // Exact score odds aren't frozen in a dedicated column (computed on the fly),
    // so apply a sanity bound instead: a specific score can never be more likely
    // (i.e. never have lower odds) than the broad 1X2 outcome it belongs to.
    for (const s of exactScoreSels) {
      const row = oddsMap.get(s.matchId)
      if (!row) {
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
    }
  }

  // Wildenroth conflict-of-interest check (mirrors the frontend guard).
  const { data: profileFlags } = await supabase
    .from('profiles')
    .select('is_wildenroth')
    .eq('id', user.id)
    .single()

  if (profileFlags?.is_wildenroth) {
    const { data: wildenrothTeamRow } = await supabase
      .from('teams')
      .select('id')
      .ilike('name', '%Wildenroth%')
      .limit(1)
      .maybeSingle()
    const wildenrothTeamId = wildenrothTeamRow?.id ?? null
    if (wildenrothTeamId != null) {
      for (const s of selections) {
        const m = matches.find((x) => x.id === s.matchId)
        if (!m) continue
        const involves = m.home_team_id === wildenrothTeamId || m.away_team_id === wildenrothTeamId
        if (!involves) continue
        const wildenrothIsHome = m.home_team_id === wildenrothTeamId
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

  // Enforce bet limit per matchday: max 3 total, max 2 with odds <= 20
  const matchdayIds = [...new Set(matches.map((m) => m.matchday))]
  for (const matchday of matchdayIds) {
    // Fetch ALL match IDs for this matchday (not just current selection)
    const { data: allMatchdayMatches } = await supabase
      .from('matches')
      .select('id')
      .eq('matchday', matchday)

    const allMatchdayIds = (allMatchdayMatches ?? []).map((m) => m.id)

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
      return m?.matchday === matchday
    }).length

    // Max 3 bets per matchday (total)
    if (existingTotalCount + newBetCount > 3) {
      return NextResponse.json(
        { error: `Maximal 3 Wetten pro Spieltag erlaubt. Du hast bereits ${existingTotalCount} Wette(n) für Spieltag ${matchday} platziert.` },
        { status: 400 }
      )
    }

    // Max 2 bets with odds <= 20 per matchday
    if (!isRisky && existingNormalCount + newBetCount > 2) {
      return NextResponse.json(
        { error: `Maximal 2 Wetten mit Quote ≤ 20,0 pro Spieltag. Du hast bereits ${existingNormalCount} solche Wette(n) für Spieltag ${matchday} platziert.` },
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
  const { data: newBalanceAfterDeduct, error: deductError } = await supabase.rpc('deduct_balance', {
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

    const { data: comboBet, error: comboError } = await supabase
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
      await supabase.rpc('increment_balance', { p_user_id: user.id, p_amount: totalCost })
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
      is_risky: isRisky ?? false,
      season: betSeason,
    }))

    const { error: betsError } = await supabase.from('bets').insert(betRows)
    if (betsError) {
      console.error('bets insert error (combo legs):', betsError)
      await supabase.rpc('increment_balance', { p_user_id: user.id, p_amount: totalCost })
      await supabase.from('combo_bets').delete().eq('id', comboBet.id)
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
      is_risky: isRisky ?? false,
      season: betSeason,
    }))

    const { error: betsError } = await supabase.from('bets').insert(betRows)
    if (betsError) {
      console.error('bets insert error (single):', betsError)
      await supabase.rpc('increment_balance', { p_user_id: user.id, p_amount: totalCost })
      return NextResponse.json({ error: 'Fehler beim Speichern der Wetten.' }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, newBalance: newBalanceAfterDeduct })
}
