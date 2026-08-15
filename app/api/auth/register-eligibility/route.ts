import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildEffectiveMatchdayIndex, startingBalanceForRegistration, STARTING_BALANCE } from '@/lib/season'
import type { Match } from '@/types'

const SEASON_START = '2026-08-01'
const TEST_MATCHDAY = 999

type PlayerRole = 'team1' | 'team2' | 'both' | 'fan'
const VALID_ROLES: PlayerRole[] = ['team1', 'team2', 'both', 'fan']

/** Called right after a successful sign-up.
 *  Sets is_wildenroth/is_wildenroth_ii from the registration's single-choice
 *  role selection (validated server-side — an unrecognized or missing value
 *  safely falls back to 'fan', never trusted as-is from the client), and
 *  always marks the new user as eligible — nobody is blocked from betting
 *  purely for registering late. Instead, late registration graduates the
 *  starting balance down (see lib/season.ts#startingBalanceForRegistration):
 *  full 1000 before Spieltag 1's last kickoff, 950 after it, 900 after
 *  Spieltag 2's, then -20 per further Spieltag. An admin can still manually
 *  set eligible_for_current_season=false for any user (Verwaltung tab). */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let role: PlayerRole = 'fan'
  try {
    const body = await req.json()
    if (VALID_ROLES.includes(body.role)) role = body.role
  } catch { /* body is optional, defaults to 'fan' */ }

  const isWildenroth = role === 'team1' || role === 'both'
  const isWildenrothII = role === 'team2' || role === 'both'

  const admin = createAdminClient()

  const { data: seasonMatchesRaw } = await admin
    .from('matches')
    .select('id, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday')
    .or(`match_date.gte.${SEASON_START},matchday.eq.${TEST_MATCHDAY}`)
  const seasonMatches = (seasonMatchesRaw ?? []) as Match[]
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  // user.created_at (set by Supabase auth at sign-up) is the canonical
  // registration instant — more precise than "now" in this handler, which
  // runs a moment after signUp() actually created the account.
  const registeredAt = user.created_at ? new Date(user.created_at) : new Date()
  const startingBalance = startingBalanceForRegistration(registeredAt, seasonMatches, mdIndex)

  // Both role flags are always written explicitly (not just the true case)
  // so a registration can never leave a stale/default flag from a previous
  // state. eligible_for_current_season is always true — see doc comment.
  const updates: Record<string, unknown> = {
    is_wildenroth: isWildenroth,
    is_wildenroth_ii: isWildenrothII,
    eligible_for_current_season: true,
  }
  // Only override the trigger-assigned default balance when the graduated
  // rule actually reduces it — never overwrite it back UP to 1000, in case
  // this route were ever somehow called twice for the same user.
  if (startingBalance < STARTING_BALANCE) {
    updates.balance = startingBalance
    updates.season_start_balance = startingBalance
  }

  await admin.from('profiles').update(updates).eq('id', user.id)

  return NextResponse.json({ ok: true, eligible: true, startingBalance })
}
