import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'

/**
 * Offizielle, vom BFV bestätigte Wertung eines annullierten Spiels — AUSSCHLIESSLICH für die
 * Fußballtabelle/Teamstatistiken (lib/matchAnnulment.ts#resultForStandings), niemals für
 * Wettabrechnung. Diese Route berührt ausschließlich `matches` — kein bets/combo_bets-Zugriff,
 * also strukturell keine Möglichkeit, Wettscheine erneut zu bearbeiten (siehe
 * supabase/match_annulment_official_score.sql#confirm_match_annulment_official_score).
 *
 * Komplett getrennt von POST .../annul: diese Route kann JEDERZEIT später aufgerufen werden,
 * sobald die BFV-Entscheidung tatsächlich feststeht — unabhängig davon, wann das Spiel
 * annulliert wurde. Beide Scores null löscht eine zuvor eingetragene Wertung wieder (z.B. bei
 * einem Tippfehler) — derselbe Aufruf dient also sowohl dem Setzen als auch dem Zurücknehmen.
 */

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) } as const
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) } as const
  return { error: null, actorId: user.id, actorName: profile.display_name || profile.username || user.id } as const
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, actorId, actorName } = await requireAdmin()
  if (error) return error

  const { id } = await params
  const matchId = parseInt(id, 10)
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: 'Ungültige Spiel-ID.' }, { status: 400 })

  let body: { homeScore?: number | null; awayScore?: number | null }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const homeScore = body.homeScore ?? null
  const awayScore = body.awayScore ?? null

  if ((homeScore == null) !== (awayScore == null)) {
    return NextResponse.json({ error: 'Beide Tore müssen zusammen angegeben (oder beide leer gelassen) werden.' }, { status: 400 })
  }
  if (homeScore != null) {
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || (awayScore as number) < 0) {
      return NextResponse.json({ error: 'Ungültiges Ergebnis.' }, { status: 400 })
    }
  }

  const admin = createAdminClient()
  const { data: result, error: rpcError } = await admin.rpc('confirm_match_annulment_official_score', {
    p_match_id: matchId, p_actor_id: actorId, p_home_score: homeScore, p_away_score: awayScore,
  })

  if (rpcError) {
    const msg = rpcError.message ?? ''
    if (msg.includes('MATCH_NOT_FOUND')) {
      return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })
    }
    if (msg.includes('MATCH_NOT_ANNULLED')) {
      return NextResponse.json({ error: 'Eine offizielle Wertung kann nur für ein bereits annulliertes Spiel hinterlegt werden.' }, { status: 409 })
    }
    console.error('confirm_match_annulment_official_score error:', rpcError)
    await logAdminAction({
      actorId, actorName, action: 'match_official_score_confirmed', objectType: 'matches', objectId: matchId,
      newValue: { homeScore, awayScore }, success: false, errorMessage: rpcError.message,
    })
    return NextResponse.json({ error: 'Fehler beim Speichern der offiziellen Wertung.' }, { status: 500 })
  }

  await logAdminAction({
    actorId, actorName, action: 'match_official_score_confirmed', objectType: 'matches', objectId: matchId,
    newValue: result,
  })

  // Betrifft ausschließlich die Fußballtabelle/Teamseiten — nie /tipps, /meine-wetten,
  // /leaderboard o.ä., da diese Route keine Wette/Guthaben je berührt.
  try {
    revalidatePath('/tabelle')
    revalidatePath('/team/wildenroth')
    revalidatePath('/team/wildenroth-ii')
    revalidatePath('/team/[teamId]', 'page')
  } catch (e) { console.error('revalidatePath after official score confirmation failed:', e) }

  return NextResponse.json({ success: true, ...result })
}
