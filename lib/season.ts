import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Returns Monday 12:00 Europe/Berlin of the week containing refDate.
 * Single source of truth for the "betting opens Monday noon" rule — do not
 * reimplement this elsewhere. Uses Date.UTC (not raw day-of-month subtraction)
 * so month/year boundaries (e.g. day 1 minus 2 days) resolve correctly instead
 * of producing an invalid date string like "2026-07--1".
 */
export function bettingOpenTime(refDate: Date): Date {
  const berlinDate = refDate.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
  const [y, m, d] = berlinDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1
  const mondayStr = new Date(Date.UTC(y, m - 1, d - daysBack)).toISOString().slice(0, 10)
  // Determine Berlin UTC offset at Monday noon and convert to UTC
  const probe = new Date(`${mondayStr}T12:00:00Z`)
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(probe),
    10
  )
  const utcHour = 24 - berlinHour
  return new Date(`${mondayStr}T${String(utcHour).padStart(2, '0')}:00:00Z`)
}

/** Returns true if the current season has started.
 *  Priority: app_settings.season_started=true  OR  first matchday-1 match has kicked off */
export async function isSeasonStarted(supabase: SupabaseClient): Promise<boolean> {
  // Check admin flag first
  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'season_started')
    .single()
  if (setting?.value === 'true') return true

  // Fallback: first match of matchday 1 in the current (26/27) season
  const { data: firstMatch } = await supabase
    .from('matches')
    .select('match_date')
    .eq('matchday', 1)
    .gte('match_date', '2026-08-01')
    .order('match_date', { ascending: true })
    .limit(1)
    .single()
  if (!firstMatch) return false
  return new Date(firstMatch.match_date) <= new Date()
}
