import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecapReport } from '@/lib/recap/report'
import type { PersonalTips } from '@/lib/recap/bestTips'
import type { RangeReadiness } from '@/lib/recap/availability'
import { HINRUNDE } from '@/lib/recap/availability'
import { RECAP_SEASON } from '@/lib/recap/slips'
import type { WinterAwardRow } from '@/lib/recap/winterAwards'

/**
 * Immutable, service-role-only historical report. The public page never
 * receives other users' personal_by_user dictionary: only the requesting
 * viewer's own PersonalTips are selected on the server.
 */
export interface FrozenWinterRecap {
  season: string
  recap_key: string
  report: RecapReport
  personal_by_user: Record<string, PersonalTips>
  readiness: RangeReadiness
  created_at: string
}
export interface WinterRecapCandidate {
  report: RecapReport
  personal_by_user: Record<string, PersonalTips>
  readiness: RangeReadiness
  award_rows: WinterAwardRow[]
}

export function validFrozenWinterRecap(value: unknown): value is FrozenWinterRecap {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Partial<FrozenWinterRecap>
  return s.season === RECAP_SEASON && s.recap_key === HINRUNDE.key
    && s.report?.version === '1'
    && s.report?.range?.from === HINRUNDE.from && s.report?.range?.to === HINRUNDE.to
    && s.readiness?.ready === true && Array.isArray(s.readiness.matchdays)
    && typeof s.personal_by_user === 'object' && s.personal_by_user !== null
    && !Array.isArray(s.personal_by_user)
}

/** Only the requesting user's private cards leave the server. */
export function frozenViewForUser(snapshot: FrozenWinterRecap, viewerId: string): {
  report: RecapReport
  personal: PersonalTips | null
  readiness: RangeReadiness
} {
  return {
    report: snapshot.report,
    personal: snapshot.personal_by_user[viewerId] ?? null,
    readiness: snapshot.readiness,
  }
}

export async function loadFrozenWinterRecap(admin: SupabaseClient): Promise<FrozenWinterRecap | null> {
  const { data, error } = await admin.from('recap_snapshots')
    .select('season, recap_key, report, personal_by_user, readiness, created_at')
    .eq('season', RECAP_SEASON).eq('recap_key', HINRUNDE.key).maybeSingle()
  if (error) throw new Error(`Winter-Recap-Snapshot konnte nicht gelesen werden: ${error.message}`)
  if (!data) return null
  if (!validFrozenWinterRecap(data)) throw new Error('Winter-Recap-Snapshot ist ungültig – Veröffentlichung gesperrt.')
  return data
}

/**
 * One database transaction:
 *  1. insert historical snapshot once (ON CONFLICT DO NOTHING, never update);
 *  2. derive winter awards from the SAME stored snapshot;
 *  3. publish the setting.
 * Re-publish after withdrawal passes null to reuse the existing immutable data.
 */
export async function publishFrozenWinterRecap(
  admin: SupabaseClient,
  candidate: WinterRecapCandidate | null,
): Promise<number> {
  const { data, error } = await admin.rpc('publish_frozen_winter_recap', {
    p_season: RECAP_SEASON,
    p_recap: HINRUNDE.key,
    p_report: candidate?.report ?? null,
    p_personal: candidate?.personal_by_user ?? null,
    p_readiness: candidate?.readiness ?? null,
    p_awards: candidate?.award_rows ?? null,
  })
  if (error) throw new Error(`Winter-Recap konnte nicht atomar veröffentlicht werden: ${error.message}`)
  if (typeof data !== 'number' || data < 0) throw new Error('Keine gültige Rückmeldung zur Winter-Recap-Freigabe.')
  return data
}
