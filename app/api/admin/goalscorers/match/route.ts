import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeGoalscorerOffersForMatch, type WildenrothPlayer, type GoalscorerMatchContext } from '@/lib/goalscorer'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadOddsModelInputs } from '@/lib/oddsInputs'
import { bettingOpenTime, parseBettingOpenOverrides } from '@/lib/season'
import { attachTeamStats, buildGoalscorerContext, goalscorerRowAction, CURRENT_SEASON, WILDENROTH_TEAM_NAMES } from '@/lib/goalscorerContext'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: 'Keine Berechtigung.', status: 403 as const }
  return { userId: user.id }
}

/** Which Wildenroth side ('1' | '2') plays this fixture, or null if neither.
 *  Resolved by exact name — an `ilike('%Wildenroth%')` also matches
 *  'SpVgg Wildenroth II' and would send every II fixture to team 1. */
async function resolveWildenrothSide(
  supabase: Awaited<ReturnType<typeof createClient>>,
  homeTeamId: number,
  awayTeamId: number,
): Promise<'1' | '2' | null> {
  const { data } = await supabase.from('teams').select('id, name').in('name', [...WILDENROTH_TEAM_NAMES])
  const t1 = data?.find((t) => t.name === 'SpVgg Wildenroth')?.id ?? null
  const t2 = data?.find((t) => t.name === 'SpVgg Wildenroth II')?.id ?? null
  if (t1 != null && (homeTeamId === t1 || awayTeamId === t1)) return '1'
  if (t2 != null && (homeTeamId === t2 || awayTeamId === t2)) return '2'
  return null
}

/** GET /api/admin/goalscorers/match?matchId=42 — read current state for a Wildenroth match */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const auth = await requireAdmin(supabase)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const matchId = Number(request.nextUrl.searchParams.get('matchId'))
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'matchId fehlt.' }, { status: 400 })
  }

  const { data: match } = await supabase
    .from('matches')
    .select(`id, matchday, home_team_id, away_team_id, status,
      home_team:teams!matches_home_team_id_fkey(id, name),
      away_team:teams!matches_away_team_id_fkey(id, name)`)
    .eq('id', matchId)
    .single()
  if (!match) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })

  const { data: gsRows } = await supabase
    .from('match_goalscorer_odds')
    .select(`*, player:wildenroth_players(*)`)
    .eq('match_id', matchId)
    .order('player_id')

  // Season stats for the team ACTUALLY PLAYING this fixture. `wildenroth_players`
  // carries one global games/minutes/goals per player, which for a `squad='both'`
  // player pools his Kreisliga and B-Klasse appearances into one misleading
  // number — the UI was showing Scheidl as 3 Sp / 198 Min / 1 T when his
  // Wildenroth I record is 5 / 379 / 5. The odds already use the per-team table;
  // the UI now reads the same source.
  const side = await resolveWildenrothSide(supabase, match.home_team_id, match.away_team_id)
  const { data: teamStatRows } = side
    ? await supabase
        .from('wildenroth_player_team_stats')
        .select('player_id, games, minutes, goals, assists, as_of_matches')
        .eq('season', CURRENT_SEASON)
        .eq('team', side)
        .in('player_id', (gsRows ?? []).map((r) => r.player_id))
    : { data: [] }
  const teamStatById = new Map((teamStatRows ?? []).map((r) => [r.player_id, r]))

  // Explicit null rather than a silent fallback to the global numbers: showing
  // the OTHER team's record as if it were this team's is exactly the bug above.
  const rows = (gsRows ?? []).map((r) => ({ ...r, team_stats: teamStatById.get(r.player_id) ?? null }))

  const { data: scorers } = await supabase
    .from('match_goalscorers')
    .select('id, player_id, goals, is_own_goal')
    .eq('match_id', matchId)

  return NextResponse.json({ match, rows, scorers: scorers ?? [], statsTeam: side })
}

/** POST /api/admin/goalscorers/match — (re)compute and freeze odds for a match. */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const auth = await requireAdmin(supabase)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { matchId: number; force?: boolean }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { matchId, force } = body
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: 'matchId fehlt.' }, { status: 400 })

  const { data: match } = await supabase
    .from('matches')
    .select('id, matchday, home_team_id, away_team_id, match_date, match_category, home_score, away_score, status, goalscorer_squad_confirmed_at')
    .eq('id', matchId)
    .single()
  if (!match) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })

  // Freezing (setting frozen_at, i.e. making these odds count for real bets)
  // must happen no earlier than the standard 1X2 market for the same Spieltag
  // — mirrors the tipps/page.tsx pipeline, which only freezes once
  // isBettingOpen. Before that instant this endpoint still computes and
  // upserts the offers (so an admin can preview/adjust them, exactly like the
  // 1X2 "Quoten neu berechnen" admin route always could), it just leaves
  // frozen_at unset — those draft rows are never read by any member-facing
  // page or bet-placement check, both of which only look at frozen odds.
  // `betting_open_md_<N>` (keyed by the raw `matchday`, same as every other
  // real Spieltag override) is the authoritative source; bettingOpenTime()'s
  // Monday-noon formula is only a fallback for Spieltage without one (e.g.
  // the test matchday).
  // The market opens with the whole active squad; the admin removes players who
  // turn out not to be in the matchday squad afterwards (status 'not_in_squad').
  // Before the market is open that removal redistributes his xG share across the
  // remaining players; after it is open it only closes HIM and leaves every
  // published price untouched. Freezing itself is NOT gated on the squad being
  // known — only on the normal betting window, exactly like every other market.
  const squadConfirmed = match.goalscorer_squad_confirmed_at != null
  let allowFreeze = true
  if (match.status === 'scheduled') {
    const { data: settingsRows } = await supabase.from('app_settings').select('key, value')
    const appSettings = new Map((settingsRows ?? []).map(r => [r.key, r.value] as const))
    const earlyBettingOpen = appSettings.get('early_betting_open') === 'true'
    const overrides = parseBettingOpenOverrides(appSettings)
    const openTime = overrides.get(match.matchday) ?? bettingOpenTime(new Date(match.match_date))
    allowFreeze = earlyBettingOpen || new Date() >= openTime
  }

  // Resolve which Wildenroth side (if either) is playing, by exact name — an
  // `ilike('%Wildenroth%')` match with no ORDER BY always resolved to
  // SpVgg Wildenroth (id 14) regardless of which team actually played,
  // rejecting every genuine Wildenroth II fixture with "Kein Wildenroth-Spiel."
  const { data: wildenrothTeams } = await supabase
    .from('teams').select('id, name').in('name', ['SpVgg Wildenroth', 'SpVgg Wildenroth II'])
  const team1Id = wildenrothTeams?.find(t => t.name === 'SpVgg Wildenroth')?.id ?? null
  const team2Id = wildenrothTeams?.find(t => t.name === 'SpVgg Wildenroth II')?.id ?? null

  const involvesTeam1 = team1Id != null && (match.home_team_id === team1Id || match.away_team_id === team1Id)
  const involvesTeam2 = team2Id != null && (match.home_team_id === team2Id || match.away_team_id === team2Id)
  if (!involvesTeam1 && !involvesTeam2) {
    return NextResponse.json({ error: 'Kein Wildenroth-Spiel.' }, { status: 400 })
  }
  const wildenrothId = involvesTeam1 ? team1Id! : team2Id!
  const squads = involvesTeam1 ? ['1', 'both'] : ['2', 'both']

  // MARKET-OPEN SNAPSHOT.
  //
  // `frozen_at` is the published marker: app/api/bets/place/route.ts only accepts
  // a bet on a row that has it, so the moment it is set the price is live and
  // someone may already have backed it. From then on the price is a snapshot and
  // this route must never rewrite it — see the frozen-row guard in the write
  // loop below, which holds even with `force`.
  //
  // `force` means exactly one thing: "run again even though part of this market
  // is already published", i.e. price the players who are NOT yet published.
  // It can NEVER overwrite a published price — the guard in the write loop is
  // unconditional, so `force` cannot reach a row with frozen_at set. An admin
  // who really wants to change a live price uses the explicit manual override
  // (/api/admin/goalscorers/availability), which is a separate, deliberate act.
  const { count: frozenCount } = await supabase
    .from('match_goalscorer_odds').select('id', { count: 'exact', head: true })
    .eq('match_id', matchId).not('frozen_at', 'is', null)
  const marketOpened = (frozenCount ?? 0) > 0
  if (marketOpened && !force) {
    return NextResponse.json({ skipped: true, reason: 'already_frozen' })
  }

  // Players from the squad that's actually playing this match
  const { data: playersRaw } = await supabase.from('wildenroth_players').select('*').eq('active', true).in('squad', squads)
  const players = (playersRaw ?? []) as WildenrothPlayer[]

  // Model inputs from the SAME central loader the 1X2/O-U/BTTS markets use.
  // This route used to run its own `matches` query that selected neither
  // `match_category` nor `competition_type` and was not paginated. Without
  // `match_category` getMatchXG infers the league tier from nothing and treats
  // a Wildenroth II B-Klasse fixture as Kreisliga — measured on the Spieltag-8
  // fixture that meant 2.518 xG here against 2.651 in the main market, a 5%
  // disagreement on the same match. See lib/oddsInputs.ts.
  const { modelMatches, priorCtx } = await loadOddsModelInputs(supabase)

  // Match-specific model xG override, same lookup as tipps/page.tsx and the
  // 1X2 recompute — this route previously ignored it entirely, so an admin
  // correction moved every other market on the fixture except this one.
  const { data: xgOverrideRow } = await createAdminClient()
    .from('match_odds_overrides')
    .select('model_home_xg_override, model_away_xg_override')
    .eq('match_id', matchId)
    .maybeSingle()
  const xgOverride = xgOverrideRow?.model_home_xg_override != null && xgOverrideRow?.model_away_xg_override != null
    ? { homeXG: Number(xgOverrideRow.model_home_xg_override), awayXG: Number(xgOverrideRow.model_away_xg_override) }
    : undefined

  // Per-match availability, the parallel-fixture flag and the two teams' goal
  // levels — same builder the automatic freeze uses. A blocked player is taken
  // OUT of the allocation pool, not merely hidden, otherwise his share of the
  // team xG disappears instead of going to the players who can play.
  const gsCtx = await buildGoalscorerContext(supabase, {
    matchId,
    matchDate: match.match_date,
    modelMatches,
    thisTeamId: wildenrothId,
    otherTeamId: involvesTeam1 ? team2Id : team1Id,
    // Continuity anchor: the last PUBLISHED goalscorer market of THIS side
    // (including any price the admin retyped) plus that fixture's real goals.
    // This is an admin recompute of a still-unfrozen draft, which is exactly
    // where a new market may be built — published rows are skipped below.
    priorCtx,
  })

  // Per-TEAM current-season stats. A squad='both' player's B-Klasse minutes and
  // goals must not be counted as Kreisliga ones (wildenroth_player_team_stats).
  const playersWithStats = await attachTeamStats(supabase, players, involvesTeam1 ? '1' : '2')

  const result = computeGoalscorerOffersForMatch(
    modelMatches, match.home_team_id, match.away_team_id, wildenrothId, playersWithStats, priorCtx, xgOverride, gsCtx,
  )
  const offers = result.offers

  // Rows an admin already manually blocked/enabled/re-priced (via
  // /availability or /cancel-player) must survive a recompute — otherwise
  // "Quoten neu berechnen" (or the automatic freeze once betting opens)
  // silently reverts a manual edit back to the model's own numbers.
  const { data: existingRows } = await supabase
    .from('match_goalscorer_odds')
    .select('player_id, manually_overridden, frozen_at')
    .eq('match_id', matchId)
  const overriddenIds = new Set((existingRows ?? []).filter(r => r.manually_overridden).map(r => r.player_id))
  const alreadyFrozenIds = new Set((existingRows ?? []).filter(r => r.frozen_at).map(r => r.player_id))
  const existingIds = new Set((existingRows ?? []).map(r => r.player_id))

  const now = new Date().toISOString()
  let repriced = 0
  let priceProtected = 0
  for (const o of offers) {
    // A published price is never rewritten. Taking a player out of the squad
    // afterwards closes HIM for new bets (via /availability → `not_in_squad`)
    // and must not move anybody else's odds: the team xG was correctly split
    // across the pool that existed when the market opened, and re-normalizing
    // over a smaller pool later would silently reprice players people have
    // already bet on. The remaining players' xG then no longer sums to the full
    // team xG, which is the intended consequence, not a defect.
    const frozen = alreadyFrozenIds.has(o.player_id)
    const overridden = overriddenIds.has(o.player_id)
    // This route IS the explicit admin recompute — the one place a draft may be
    // rebuilt. The automatic market open takes a different path (see
    // goalscorerRowAction and app/(app)/tipps/page.tsx).
    const action = goalscorerRowAction({
      trigger: 'admin_recompute', exists: existingIds.has(o.player_id), frozen, manuallyOverridden: overridden,
    })
    if (frozen) { priceProtected++; continue }
    if (action === 'skip') {
      // Only (maybe) freeze it — never touch the admin's own status/is_offered/odds.
      if (allowFreeze) {
        await supabase.from('match_goalscorer_odds')
          .update({ frozen_at: now, updated_at: now })
          .eq('match_id', matchId).eq('player_id', o.player_id)
      }
      continue
    }
    await supabase.from('match_goalscorer_odds').upsert({
      match_id: matchId,
      player_id: o.player_id,
      status: 'available',
      is_offered: o.is_offered,
      is_offered_2plus: o.is_offered_2plus,
      prob_score: o.prob_score,
      prob_score_2plus: o.prob_score_2plus,
      odds_score: o.odds_score,
      odds_score_2plus: o.odds_score_2plus,
      frozen_at: allowFreeze ? now : null,
      updated_at: now,
    }, { onConflict: 'match_id,player_id' })
    repriced++
  }

  return NextResponse.json({
    success: true,
    offers: offers.length,
    frozen: allowFreeze,
    squadConfirmed,
    marketOpened,
    repriced,
    // Published rows left untouched — the point of the snapshot rule.
    priceProtected,
    // Surfaced so the admin UI can show that the parts add up to the whole.
    teamMatchXG: result.teamMatchXG,
    allocatedXG: result.allocatedXG,
    offeredXG: result.offeredXG,
    projectedMinutesTotal: result.projectedMinutesTotal,
  })
}
