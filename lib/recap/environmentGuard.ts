import { isPreviewEnvironment } from '@/lib/recap/simulation'

/**
 * Schutz vor Verwechslung der Datenbanken. Die Kennungen sind keine Geheimnisse (stehen in jeder öffentlichen
 * Supabase-URL); Zugangsschlüssel kommen hier nie vor.
 */
export const PRODUCTION_SUPABASE_REF = 'mpyqtymkdhxuannqhtvp'
export const SANDBOX_SUPABASE_REF = 'aspbgawbqwfntvlqtcvl'

/** Projekt-Kennung aus NEXT_PUBLIC_SUPABASE_URL (erstes Host-Label) oder null. */
export function supabaseRef(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!url) return null
  try { return new URL(url).hostname.split('.')[0] || null } catch { return null }
}

export type DatabaseKind = 'production' | 'sandbox' | 'other' | 'none'
export function databaseKind(ref: string | null = supabaseRef()): DatabaseKind {
  if (!ref) return 'none'
  if (ref === PRODUCTION_SUPABASE_REF) return 'production'
  if (ref === SANDBOX_SUPABASE_REF) return 'sandbox'
  return 'other'
}

/**
 * Die Test-Simulation von Spieltag 16 ist nur erlaubt, wenn (1) die Umgebung eine Vorschau/Entwicklung ist UND
 * (2) die verbundene Datenbank NICHT die produktive ist. Damit kann sie weder in Production noch in einer Vorschau
 * laufen, die versehentlich an die produktive Datenbank angeschlossen wurde.
 */
export function isSimulationAllowed(): boolean {
  return isPreviewEnvironment() && databaseKind() !== 'production'
}
