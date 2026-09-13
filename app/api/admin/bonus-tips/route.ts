import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BonusTipType } from '@/lib/bonusTips'

/**
 * Admin-CRUD für Bonus-Tipps. Schreibt über den session-scoped Client, nicht
 * den service-role Client — RLS erlaubt Admin-Insert/Update/Delete auf
 * bonus_tips bereits direkt (siehe Migration add_bonus_tips_system, Policies
 * bonus_tips_admin_*), analog zu matches_admin_insert/update/delete. Der
 * is_admin-Check hier ist zusätzliche Verteidigung in der Tiefe, nicht der
 * einzige Schutz.
 */
async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) }
  return { user }
}

export async function GET() {
  const supabase = await createClient()
  const { error } = await requireAdmin(supabase)
  if (error) return error

  const { data: tips } = await supabase
    .from('bonus_tips')
    .select('*')
    .order('created_at', { ascending: false })

  const tipIds = (tips ?? []).map(t => t.id)
  const [{ data: answers }, { data: payouts }, { data: profiles }] = await Promise.all([
    tipIds.length > 0
      ? supabase.from('bonus_tip_answers').select('bonus_tip_id, user_id, answer_key, updated_at').in('bonus_tip_id', tipIds)
      : Promise.resolve({ data: [] }),
    tipIds.length > 0
      ? supabase.from('bonus_tip_payouts').select('bonus_tip_id, user_id, amount').in('bonus_tip_id', tipIds)
      : Promise.resolve({ data: [] }),
    supabase.from('profiles').select('id, display_name, username'),
  ])

  const pMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.display_name || p.username]))

  // Pro Tipp: Teilnehmerzahl, Antwortverteilung, ausgeschüttete Wildis —
  // genau die Admin-Übersicht aus Anforderung 10.
  const tips_with_stats = (tips ?? []).map(t => {
    const tAnswers = (answers ?? []).filter(a => a.bonus_tip_id === t.id)
    const tPayouts = (payouts ?? []).filter(p => p.bonus_tip_id === t.id)
    const byKey: Record<string, number> = {}
    for (const a of tAnswers) byKey[a.answer_key] = (byKey[a.answer_key] ?? 0) + 1
    return {
      ...t,
      participant_count: tAnswers.length,
      answer_distribution: byKey,
      correct_answer_count: t.correct_option_keys
        ? tAnswers.filter(a => (t.correct_option_keys as string[]).includes(a.answer_key)).length
        : null,
      wildis_paid_out: tPayouts.reduce((a, p) => a + p.amount, 0),
      answers: tAnswers.map(a => ({ ...a, name: pMap[a.user_id] ?? 'Unbekannt' })),
    }
  })

  return NextResponse.json({ tips: tips_with_stats })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { error, user } = await requireAdmin(supabase)
  if (error) return error

  let body: {
    title?: string; description?: string; type?: BonusTipType
    scope_matchday?: number | null; scope_match_id?: number | null; period_label?: string | null
    options?: unknown[]; opens_at?: string; closes_at?: string; reward_wildis?: number
    group_key?: string | null; group_max_per_user?: number | null
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const VALID_TYPES: BonusTipType[] = ['total_goals_matchday', 'match_goals', 'highest_scoring_match', 'biggest_win_matchday', 'long_term']
  if (!body.title?.trim() || !body.description?.trim() || !body.type || !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: 'Titel, Beschreibung und ein gültiger Typ sind erforderlich.' }, { status: 400 })
  }
  if (!Array.isArray(body.options) || body.options.length < 2) {
    return NextResponse.json({ error: 'Mindestens 2 Antwortmöglichkeiten erforderlich.' }, { status: 400 })
  }
  if (!body.closes_at) {
    return NextResponse.json({ error: 'Tippschluss erforderlich.' }, { status: 400 })
  }

  const { data, error: insertError } = await supabase
    .from('bonus_tips')
    .insert({
      created_by: user!.id,
      title: body.title.trim(),
      description: body.description.trim(),
      type: body.type,
      scope_matchday: body.scope_matchday ?? null,
      scope_match_id: body.scope_match_id ?? null,
      period_label: body.period_label ?? null,
      options: body.options,
      opens_at: new Date().toISOString(),
      closes_at: body.closes_at,
      reward_wildis: body.reward_wildis ?? 100,
      group_key: body.group_key ?? null,
      group_max_per_user: body.group_max_per_user ?? null,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('bonus tip create error:', insertError)
    return NextResponse.json({ error: 'Fehler beim Erstellen.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id })
}
