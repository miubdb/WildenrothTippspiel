import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { cappedPayout } from '@/lib/payout'
import { classifyCombo, type ComboLegAfterNeutralization, type BetStatus } from '@/lib/matchAnnulment'

/**
 * "Spiel annullieren (Quote 1,00)" — Nichtantritt/Annullierung. GET liefert die Vorschau
 * (reine Lesung, keine Mutation); POST führt die tatsächliche Annullierung über die atomare
 * Postgres-Funktion `neutralize_match` aus (siehe supabase/match_annulment.sql).
 *
 * Die Vorschau hier MUSS exakt dieselbe Logik verwenden wie die RPC selbst — beide sind eine
 * direkte Anwendung von lib/matchAnnulment.ts#classifyCombo auf denselben Kombi-Zustand. Die
 * RPC liest/schreibt dieselben Zeilen innerhalb EINER Transaktion und ist damit die einzige
 * Stelle, die tatsächlich entscheidet; diese Route simuliert nur denselben Schritt lesend.
 */

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) } as const
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) } as const
  return { error: null, actorId: user.id, actorName: profile.display_name || profile.username || user.id } as const
}

type Leg = { id: number; match_id: number; special_id: number | null; odds_value: number; status: BetStatus; combo_id: number | null }
type ComboRow = { id: number; user_id: string; stake: number; total_odds: number; status: BetStatus; is_risky: boolean }

interface ComboPreviewEntry {
  comboId: number
  userId: string
  userName: string
  stake: number
  isRisky: boolean
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

/** Marks every leg this annulment would neutralize (pending + tied to the match, or pending +
 *  tied to a Special being voided) and returns a NEW array — never mutates the input. */
function withSimulatedNeutralization(legs: Leg[], matchId: number, votingSpecialIds: Set<number>): ComboLegAfterNeutralization[] {
  return legs.map((l) => {
    const neutralized = l.status === 'pending' && (l.match_id === matchId || (l.special_id != null && votingSpecialIds.has(l.special_id)))
    return { oddsValue: l.odds_value, status: neutralized ? 'neutralized' : l.status }
  })
}

async function buildPreview(matchId: number) {
  const admin = createAdminClient()

  const { data: match } = await admin
    .from('matches')
    .select('id, status, match_date, annulled_at, annulment_reason, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
    .eq('id', matchId)
    .single()
  if (!match) return { notFound: true as const }

  const homeTeam = Array.isArray(match.home_team) ? match.home_team[0] : match.home_team
  const awayTeam = Array.isArray(match.away_team) ? match.away_team[0] : match.away_team
  const matchLabel = `${homeTeam?.name ?? '?'} – ${awayTeam?.name ?? '?'}`

  if (match.status === 'annulled') {
    return { notFound: false as const, matchLabel, matchStatus: match.status, alreadyAnnulled: true as const }
  }
  if (match.status === 'finished') {
    return { notFound: false as const, matchLabel, matchStatus: match.status, blocked: 'MATCH_ALREADY_FINISHED' as const }
  }

  // Active Specials that genuinely include this match (not merely anchored on it technically).
  const { data: specialsRaw } = await admin
    .from('matchday_specials')
    .select('id, matchday, title, included_match_ids')
    .eq('status', 'active')
    .contains('included_match_ids', [matchId])
  const specials = specialsRaw ?? []
  const votingSpecialIds = new Set(specials.map((s) => s.id as number))

  // Every PENDING single/combo-leg directly tied to this match, plus every
  // pending single/combo-leg of a Special being voided (special_id set).
  const orFilter = votingSpecialIds.size > 0
    ? `match_id.eq.${matchId},special_id.in.(${[...votingSpecialIds].join(',')})`
    : `match_id.eq.${matchId}`
  const { data: directLegsRaw } = await admin
    .from('bets')
    .select('id, match_id, special_id, combo_id, user_id, stake, odds_value, status')
    .or(orFilter)
  const directLegs = directLegsRaw ?? []

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
    const [{ data: comboRowsRaw }, { data: allLegsRaw }] = await Promise.all([
      admin.from('combo_bets').select('id, user_id, stake, total_odds, status, is_risky').in('id', comboIds),
      admin.from('bets').select('id, match_id, special_id, combo_id, odds_value, status').in('combo_id', comboIds),
    ])
    const comboRows = (comboRowsRaw ?? []) as ComboRow[]
    const allLegs = (allLegsRaw ?? []) as Leg[]
    const legsByCombo = new Map<number, Leg[]>()
    for (const l of allLegs) {
      const arr = legsByCombo.get(l.combo_id as number) ?? []
      arr.push(l)
      legsByCombo.set(l.combo_id as number, arr)
    }

    comboEntries = comboRows.map((c) => {
      const legs = legsByCombo.get(c.id) ?? []
      const oldPossiblePayout = round2(cappedPayout(c.stake, c.total_odds, c.is_risky))
      if (c.status !== 'pending') {
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky: c.is_risky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'untouched', newTotalOdds: null, newPossiblePayout: null, refund: null,
        }
      }
      const simulatedLegs = withSimulatedNeutralization(legs, matchId, votingSpecialIds)
      const resolution = classifyCombo(simulatedLegs)
      if (resolution.kind === 'precondition_violated_already_lost') {
        anomalyNotes.push(`Kombi #${c.id}: Status 'pending', enthält aber bereits ein verlorenes Leg — bitte manuell prüfen.`)
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky: c.is_risky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'anomaly', newTotalOdds: null, newPossiblePayout: null, refund: null,
        }
      }
      if (resolution.kind === 'fully_neutralized') {
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky: c.is_risky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'fully_neutralized', newTotalOdds: 1, newPossiblePayout: c.stake, refund: c.stake,
        }
      }
      if (resolution.kind === 'now_won') {
        const payout = round2(cappedPayout(c.stake, resolution.newTotalOdds, c.is_risky))
        return {
          comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky: c.is_risky,
          statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
          action: 'now_won', newTotalOdds: resolution.newTotalOdds, newPossiblePayout: payout, refund: null,
        }
      }
      // still_pending
      const newPossiblePayout = round2(cappedPayout(c.stake, resolution.newTotalOdds, c.is_risky))
      return {
        comboId: c.id, userId: c.user_id, userName: '', stake: c.stake, isRisky: c.is_risky,
        statusBefore: c.status, oldTotalOdds: c.total_odds, oldPossiblePayout,
        action: 'still_pending', newTotalOdds: resolution.newTotalOdds, newPossiblePayout, refund: null,
      }
    })
  }

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
    notFound: false as const,
    matchLabel, matchStatus: match.status, alreadyAnnulled: false as const,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params
  const matchId = parseInt(id, 10)
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: 'Ungültige Spiel-ID.' }, { status: 400 })

  const preview = await buildPreview(matchId)
  if (preview.notFound) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })
  return NextResponse.json(preview)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, actorId, actorName } = await requireAdmin()
  if (error) return error

  const { id } = await params
  const matchId = parseInt(id, 10)
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: 'Ungültige Spiel-ID.' }, { status: 400 })

  let body: { reason?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const reason = (body.reason ?? '').trim()
  if (!reason) {
    return NextResponse.json({ error: 'Bitte einen Grund für die Annullierung angeben (z.B. "Nichtantritt der Gastmannschaft").' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: result, error: rpcError } = await admin.rpc('neutralize_match', {
    p_match_id: matchId, p_actor_id: actorId, p_reason: reason,
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
      newValue: { reason }, success: false, errorMessage: rpcError.message,
    })
    return NextResponse.json({ error: 'Fehler bei der Annullierung.' }, { status: 500 })
  }

  await logAdminAction({
    actorId, actorName, action: 'match_annulment', objectType: 'matches', objectId: matchId,
    newValue: { reason, ...result },
  })

  try {
    revalidatePath('/tipps')
    revalidatePath('/leaderboard')
    revalidatePath('/spieler/[id]', 'page')
    revalidatePath('/profil')
  } catch (e) { console.error('revalidatePath after match annulment failed:', e) }

  return NextResponse.json({ success: true, ...result })
}
