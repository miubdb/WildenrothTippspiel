import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStornoChampWetteDetail } from '@/lib/awards'

/**
 * Backs the Storno-Champ detail sheet everywhere it can appear (live recap
 * preview, persisted /recap/[matchday], Pokalschrank) — one route, one
 * shared getStornoChampWetteDetail() implementation (see lib/awards.ts).
 * Cross-user read (the referenced bet/combo can belong to anyone), same
 * openness as "Alle Tipps" already has for any settled bet — only requires
 * being logged in, not being the bet's own owner.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const betIdParam = request.nextUrl.searchParams.get('betId')
  const comboIdParam = request.nextUrl.searchParams.get('comboId')
  const betId = betIdParam ? parseInt(betIdParam, 10) : null
  const comboId = comboIdParam ? parseInt(comboIdParam, 10) : null
  if (betId == null && comboId == null) {
    return NextResponse.json({ error: 'betId oder comboId erforderlich.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const detail = await getStornoChampWetteDetail(admin, { betId, comboId })
  if (!detail) {
    return NextResponse.json({ error: 'Diese stornierte Wette ist nicht mehr verfügbar.' }, { status: 404 })
  }
  return NextResponse.json({ detail })
}
