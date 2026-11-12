import { NextResponse } from 'next/server'
import { databaseKind, isSimulationAllowed, supabaseRef } from '@/lib/recap/environmentGuard'

/**
 * Verbindungsnachweis ohne Geheimnisse: zeigt nur Umgebung, Projekt-Kennung der verbundenen Supabase-Datenbank und ob
 * die Test-Simulation erlaubt ist. Keine Schlüssel, keine Daten. (Die Projekt-Kennung steht ohnehin in jeder
 * NEXT_PUBLIC_SUPABASE_URL im Browser.)
 */
export const dynamic = 'force-dynamic'
export function GET() {
  const ref = supabaseRef()
  return NextResponse.json({ vercelEnv: process.env.VERCEL_ENV ?? null, database: { ref, kind: databaseKind(ref) }, simulationAllowed: isSimulationAllowed() }, { headers: { 'Cache-Control': 'no-store' } })
}
