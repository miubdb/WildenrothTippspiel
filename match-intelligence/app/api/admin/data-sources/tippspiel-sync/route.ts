import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'
import { runTippspielSync } from '@/lib/import/tippspielSync'

/**
 * POST { squadId } → runs one Tippspiel sync for that squad and returns the
 * summary (spec: "Datenquellen → Wildenroth Tippspiel → Synchronisieren").
 * Admin-only — re-checked here explicitly since proxy.ts does not run in
 * front of /api/* routes (see CLAUDE.md convention this project follows).
 */
export async function POST(request: Request) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const squadId = body?.squadId
  if (typeof squadId !== 'string') {
    return NextResponse.json({ error: 'squadId fehlt.' }, { status: 400 })
  }

  const supabase = await createClient()
  const summary = await runTippspielSync(supabase, { orgId: membership.orgId, squadId, startedBy: membership.profile.id })

  if (summary.error) {
    return NextResponse.json({ error: summary.error }, { status: 422 })
  }

  return NextResponse.json(summary)
}
