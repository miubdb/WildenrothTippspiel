import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { cappedPayout } from '@/lib/payout'
import { finalizeMatchdayIfDone } from '@/lib/matchdayFinalize'
import { hasStartedCombo } from '@/lib/betStart'
import { classifyCombo, isRealMatchLeg, type ComboLegAfterNeutralization, type BetStatus, type AnnulmentType } from '@/lib/matchAnnulment'

const VALID_ANNULMENT_TYPES: readonly AnnulmentType[] = ['away_no_show', 'home_no_show', 'other']

/**
 * "Spiel annullieren (Quote 1,00)" — Nichtantritt/Annullierung. GET liefert die Vorschau
 * (reine Lesung, keine Mutation); POST führt die tatsächliche Annullierung über die atomare
 * Postgres-Funktion `neutralize_match` aus (siehe supabase/match_annulment.sql).
 *
 * Die Vorschau hier MUSS exakt dieselbe Logik verwenden wie die RPC selbst — beide sind eine
 * direkte Anwendung von lib/matchAnnulment.ts#classifyCombo auf denselben Kombi-Zustand. Die
 * RPC liest/schreibt dieselben Zeilen innerhalb EINER Transaktion und ist damit die einzige
 * Stelle, die tatsächlich entscheidet; diese Route simuliert nur denselben Schritt lesend.
 *
 * WICHTIG: combo_bets hat KEINE eigene is_risky-Spalte (jedes Leg trägt denselben Wert, siehe
 * lib/risky.ts) — jeder Zugriff hier geht über bets.is_risky, nie über combo_bets.is_risky
 * (das existiert nicht und würde die Query mit einem DB-Fehler scheitern lassen).
 */

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) } as const
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) } as const
  return { error: null, actorId: user.id, actorName: profile.display_name || profile.username || user.id } as const
}

type Leg = { id: number; match_id: number; special_id: number | null; combo_id: number | null; user_id: string; stake: number | null; odds_value: number; status: BetStatus; market_type: string; is_risky: boolean }
type ComboRow = { id: number; user_id: string; stake: number; total_odds: number; status: BetStatus }

interface ComboPreviewEntry {
  comboId: number
  userId: string
  userName: string
  stake: number
  isRisky: boolean
  /** True, wenn mindestens ein wirksames Leg bereits angepfiffen/entschieden ist. */
  hasStarted?: boolean
  statusBefore: BetStatus
  oldTotalOdds: number
  oldPossiblePayout: number
  action: 'untouched' | 'fully_neutralized' | 'now_won' | 'still_pending' | 'anomaly'
  newTotalOdds: number | null
  newPossiblePayout: number | null
  refund: number | null
}

interface SinglePreviewEntry {
  betId: number
  userId: string
  userName: string
  stake: number
  oddsValue: number
  refund: number
  triggeredBy: 'match' | 'special'
}

async function loadUserNames(admin: ReturnType<typeof createAdminClient>, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const { data } = await admin.from('profiles').select('id, display_name, username').in('id', [...new Set(userIds)])
  return new Map((data ?? []).map((p) => [p.id as string, (p.display_name || p.username || p.id) as string]))
}

/** Marks every leg this annulment would neutralize (pending + a REAL selection tied to the
 *  match, see isRealMatchLeg — never a Special merely anchored there; or pending + tied to a
 *  Special being voided) and returns a NEW array — never mutates the input. */
function withSimulatedNeutralization(legs: Leg[], matchId: number, votingSpecialIds: Set<number>): ComboLegAfterNeutralization[] {
  return legs.map((l) => {
    const neutralized = l.status === 'pending' && (
      (l.match_id === matchId && isRealMatchLeg({ marketType: l.market_type })) ||
      (l.special_id != null && votingSpecialIds.has(l.special_id))
    )
    return { oddsValue: l.odds_value, status: neutralized ? 'neutralized' : l.status }
  })
}

type PreviewResult =
  | { notFound: true }
  | { notFound: false; error: string }
  | {
      notFound: false
      matchLabel: string
      matchStatus: string
      alreadyAnnulled: true
      annulmentType: AnnulmentType | null
      officialHomeScore: number | null
      officialAwayScore: number | null
      officialConfirmedAt: string | null
    }
  | {
      notFound: false
      matchLabel: string
      matchStatus: string
      alreadyAnnulled: false
      blocked: 'MATCH_ALREADY_FINISHED'
    }
  | {
      notFound: false
      matchLabel: string
      matchStatus: string
      alreadyAnnulled: false
      singles: SinglePreviewEntry[]
      combos: ComboPreviewEntry[]
      specials: { id: number; matchday: number; title: string }[]
      counts: { affectedSingles: number; affectedCombosTotal: number; openCombos: number; lostCombos: number; cancelledCombosUntouched: number; anomalies: number }
      totalRefund: number
      anomalyNotes: string[]
    }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function buildPreview(matchId: number): Promise<PreviewResult> {
  const admin = createAdminClient()

  const { data: match, error: matchErr } = await admin
    .from('matches')
    .select('id, status, match_date, annulled_at, annulment_reason, annulment_type, annulment_official_home_score, annulment_official_away_score, annulment_official_confirmed_at, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
    .eq('id', matchId)
    .single()
  // PGRST116 = "no rows" from .single() — a real "not found", not a DB error.
  if (matchErr && matchErr.code !== 'PGRST116') {
    return { notFound: false, error: `Spiel konnte nicht geladen werden: ${matchErr.message}` }
  }
  if (!match) return { notFound: true }

  const homeTeam = Array.isArray(match.home_team) ? match.home_team[0] : match.home_team
  const awayTeam = Array.isArray(match.away_team) ? match.away_team[0] : match.away_team
  const matchLabel = `${homeTeam?.name ?? '?'} – ${awayTeam?.name ?? '?'}`

  if (match.status === 'annulled') {
    return {
      notFound: false, matchLabel, matchStatus: match.status, alreadyAnnulled: true,
      annulmentType: (match.annulment_type as AnnulmentType | null) ?? null,
      officialHomeScore: match.annulment_official_home_score ?? null,
      officialAwayScore: match.annulment_official_away_score ?? null,
      officialConfirmedAt: match.annulment_official_confirmed_at ?? null,
    }
  }
  if (match.status === 'finished') {
    return { notFound: false, matchLabel, matchStatus: match.status, alreadyAnnulled: false, blocked: 'MATCH_ALREADY_FINISHED' }
  }

  // Active Specials that genuinely include this match (not merely anchored on it technically
  // via representative_match_id — see lib/matchAnnulment.ts#isRealMatchLeg's doc comment).
  const { data: specialsRaw, error: specialsErr } = await admin
    .from('matchday_specials')
    .select('id, matchday, title, included_match_ids')
    .eq('status', 'active')
    .contains('included_match_ids', [matchId])
  if (specialsErr) {
    return { notFound: false, error: `Spieltag-Specials konnten nicht geladen werden: ${specialsErr.message}` }
  }
  const specials = specialsRaw ?? []
  const votingSpecialIds = new Set(specials.map((s) => s.id as number))

  // Two SEPARATE queries, never one `.or('match_id.eq...,special_id.in...')` — a single OR
  // filter on match_id would also catch every matchday_special bet whose TECHNICAL anchor
  // happens to be this match, even when its own Special doesn't genuinely include it at all.
  const legSelect = 'id, match_id, special_id, combo_id, user_id, stake, odds_value, status, market_type, is_risky'
  const [{ data: realMatchLegsRaw, error: realLegsErr }, specialLegsResult] = await Promise.all([
    admin.from('bets').select(legSelect).eq('match_id', matchId).neq('market_type', 'matchday_special'),
    votingSpecialIds.size > 0
      ? admin.from('bets').select(legSelect).in('special_id', [...votingSpecialIds])
      : Promise.resolve({ data: [] as Leg[], error: null }),
  ])
  if (realLegsErr) {
    return { notFound: false, error: `Wetten auf dieses Spiel konnten nicht geladen werden: ${realLegsErr.message}` }
  }
  if (specialLegsResult.error) {
    return { notFound: false, error: `Wetten auf betroffene Spieltag-Specials konnten nicht geladen werden: ${specialLegsResult.error.message}` }
  }
  const directLegs = [...(realMatchLegsRaw ?? []), ...(specialLegsResult.data ?? [])] as Leg[]

  const singles: SinglePreviewEntry[] = directLegs
    .filter((b) => b.combo_id == null && b.status === 'pending')
    .map((b) => ({
      betId: b.id, userId: b.user_id, userName: '', stake: Number(b.stake ?? 0), oddsValue: Number(b.odds_value),
      refund: Number(b.stake ?? 0), triggeredBy: b.special_id != null ? ('special' as const) : ('match' as const),
    }))

  const comboIds = [...new Set(directLegs.filter((b) => b.combo_id != null).map((b) => b.combo_id as number))]

  let comboEntries: ComboPreviewEntry[] = []
  const anomalyNotes: string[] = []
  if (comboIds.length > 0) {
    const [{ data: comboRowsRaw, error: comboRowsErr }, { data: allLegsRaw, error: allLegsErr }] = await Promise.all([
      admin.from('combo_bets').select('id, user_id, stake, total_odds, status').in('id', comboIds),
      admin.from('bets').select('id, match_id, special_id, combo_id, odds_value, status, market_type, is_risky').in('combo_id', comboIds),
    ])
    if (comboRowsErr) {
      return { notFound: false, error: `Betroffene Kombiwetten konnten nicht geladen werden: ${comboRowsErr.message}` }
    }
    if (allLegsErr) {
      return { notFound: false, error: `Legs der betroffenen Kombiwetten konnten nicht geladen werden: ${allLegsErr.message}` }
    }
    const comboRows = (comboRowsRaw ?? []) as ComboRow[]
    const allLegs = (allLegsRaw ?? []) as Leg[]
    const legsByCombo = new Map<number, Leg[]>()
    for (const l of allLegs) {
      const arr = legsByCombo.get(l.combo_id as number) ?? []
      arr.push(l)
      legsByCombo.set(l.combo_id as number, arr)
    }

    // Für die Vorschau und die Stornierung dieselbe Definition verwenden.
    // Ein bereits gewonnenes Leg zählt als "begonnen", selbst wenn alle
    // verbleibenden, noch offenen Spiele erst morgen stattfinden.
    const relatedMatchIds = [...new Set(allLegs.map((l) => l.match_id))]
    const { data: relatedMatches, error: relatedMatchesError } = relatedMatchIds.length > 0
      ? await admin.from('matches').select('id, match_date, status').in('id', relatedMatchIds)
      : { data: [], error: null }
    if (relatedMatchesError || !relatedMatches || relatedMatches.length !== relatedMatchIds.length) {
      return { notFound: false, error: 'Spieltermine für die Stornierbarkeits-Vorschau konnten nicht vollständig geladen werden.' }
    }

    comboEntries = comboRows.map((c) => {
      const legs = legsByCombo.get(c.id) ?? []
      // combo_bets has no is_risky column of its own — any one leg reflects
      // the combo's classification (see lib/risky.ts).
      const isRisky = legs.some((l) => l.is_risky)
      const oldPossiblePayout = round2(cappedPayout(c.stake, c.total_odds, isRisky))
      if (c.status !== 'pending') {
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'untouched', newTotalOdds: null, newPossiblePayout: null, refund: null,
        }
      }
      const simulatedLegs = withSimulatedNeutralization(legs, matchId, votingSpecialIds)
      const resolution = classifyCombo(simulatedLegs)
      if (resolution.kind === 'precondition_violated_already_lost') {
        anomalyNotes.push(`Kombi #${c.id}: Status 'pending', enthält aber bereits ein verlorenes Leg — bitte manuell prüfen.`)
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'anomaly', newTotalOdds: null, newPossiblePayout: null, refund: null,
        }
      }
      if (resolution.kind === 'fully_neutralized') {
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'fully_neutralized', newTotalOdds: 1, newPossiblePayout: c.stake, refund: c.stake,
        }
      }
      if (resolution.kind === 'now_won') {
        const payout = round2(cappedPayout(c.stake, resolution.newTotalOdds, isRisky))
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'now_won', newTotalOdds: resolution.newTotalOdds, newPossiblePayout: payout, refund: null,
        }
      }
      // still_pending
      const newPossiblePayout = round2(cappedPayout(c.stake, resolution.newTotalOdds, isRisky))
      return {
        comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky,
        statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
        action: 'still_pending', newTotalOdds: resolution.newTotalOdds, newPossiblePayout, refund: null,
      }
    })
    for (const entry of comboEntries) {
      entry.hasStarted = hasStartedCombo(legsByCombo.get(entry.comboId) ?? [], relatedMatches)
    }
  }

  // Name lookup is cosmetic only (display label) — a failure here must never
  // sink the whole preview (which carries real money figures); fall back to
  // the raw user id, same as every other caller of loadUserNames-style helpers.
  const names = await loadUserNames(admin, [...singles.map((s) => s.userId), ...comboEntries.map((c) => c.userId)])
  for (const s of singles) s.userName = names.get(s.userId) ?? s.userId
  for (const c of comboEntries) c.userName = names.get(c.userId) ?? c.userId

  const openCombos = comboEntries.filter((c) => c.action === 'still_pending' || c.action === 'now_won' || c.action === 'fully_neutralized')
  const lostCombos = comboEntries.filter((c) => c.statusBefore === 'lost')
  const cancelledCombos = comboEntries.filter((c) => c.statusBefore === 'void' || c.statusBefore === 'neutralized')
  const totalRefund = round2(
    singles.reduce((a, s) => a + s.refund, 0) + comboEntries.reduce((a, c) => a + (c.refund ?? 0), 0)
  )

  return {
    notFound: false,
    matchLabel, matchStatus: match.status, alreadyAnnulled: false,
    singles, combos: comboEntries,
    specials: specials.map((s) => ({ id: s.id, matchday: s.matchday, title: s.title })),
    counts: {
      affectedSingles: singles.length,
      affectedCombosTotal: comboEntries.length,
      openCombos: openCombos.length,
      lostCombos: lostCombos.length,
      cancelledCombosUntouched: cancelledCombos.length,
      anomalies: anomalyNotes.length,
    },
    totalRefund,
    anomalyNotes,
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params
  const matchId = parseInt(id, 10)
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: 'Ungültige Spiel-ID.' }, { status: 400 })

  const preview = await buildPreview(matchId)
  if (preview.notFound) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })
  // A DB read failure must surface as an explicit error — NEVER as a 200
  // with an empty/zeroed preview that would look like "nothing is affected".
  if ('error' in preview) {
    console.error('annul preview build failed:', preview.error)
    return NextResponse.json({ error: preview.error }, { status: 500 })
  }
  return NextResponse.json(preview)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, actorId, actorName } = await requireAdmin()
  if (error) return error

  const { id } = await params
  const matchId = parseInt(id, 10)
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: 'Ungültige Spiel-ID.' }, { status: 400 })

  let body: { reason?: string; annulmentType?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const reason = (body.reason ?? '').trim()
  if (!reason) {
    return NextResponse.json({ error: 'Bitte einen Grund für die Annullierung angeben (z.B. "Nichtantritt der Gastmannschaft").' }, { status: 400 })
  }
  // Strukturierte Auswahl ist PFLICHT und wird nie vorausgewählt (siehe
  // components/admin/MatchAnnulmentPanel.tsx) — der Admin muss sie bewusst treffen.
  const annulmentType = body.annulmentType as AnnulmentType | undefined
  if (!annulmentType || !VALID_ANNULMENT_TYPES.includes(annulmentType)) {
    return NextResponse.json(
      { error: 'Bitte angeben: Nichtantritt Gastmannschaft, Nichtantritt Heimmannschaft oder Anderer Grund.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data: result, error: rpcError } = await admin.rpc('neutralize_match', {
    p_match_id: matchId, p_actor_id: actorId, p_reason: reason, p_annulment_type: annulmentType,
  })

  if (rpcError) {
    const msg = rpcError.message ?? ''
    if (msg.includes('MATCH_NOT_FOUND')) {
      return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })
    }
    if (msg.includes('MATCH_ALREADY_FINISHED')) {
      return NextResponse.json(
        { error: 'Dieses Spiel wurde bereits normal abgerechnet (Ergebnis eingetragen) — eine Annullierung ist über diese Funktion nicht möglich.' },
        { status: 409 }
      )
    }
    console.error('neutralize_match error:', rpcError)
    await logAdminAction({
      actorId, actorName, action: 'match_annulment', objectType: 'matches', objectId: matchId,
      newValue: { reason, annulmentType }, success: false, errorMessage: rpcError.message,
    })
    return NextResponse.json({ error: 'Fehler bei der Annullierung.' }, { status: 500 })
  }

  await logAdminAction({
    actorId, actorName, action: 'match_annulment', objectType: 'matches', objectId: matchId,
    newValue: { reason, annulmentType, ...result },
  })

  // Annulling a match is "this match's story is over" (see lib/matchdayFinalize.ts's
  // 'annulled' treatment, same as 'postponed') — it can be the LAST thing standing
  // between a Spieltag and its recap/awards/pocket-money/inactivity-penalty, exactly
  // like a normal settlement (app/api/admin/settle/route.ts) or a goalscorer settlement
  // can be. Never lets a push/awards failure appear as if the annulment itself (balances
  // already final above) had failed.
  try {
    await finalizeMatchdayIfDone(admin, matchId)
  } catch (e) { console.error('finalizeMatchdayIfDone after match annulment failed:', e) }

  try {
    revalidatePath('/tipps')
    revalidatePath('/leaderboard')
    revalidatePath('/spieler/[id]', 'page')
    revalidatePath('/profil')
  } catch (e) { console.error('revalidatePath after match annulment failed:', e) }

  return NextResponse.json({ success: true, ...result })
}
