import { HINRUNDE } from '@/lib/recap/availability'
import { WINTER_RECAP_KEY, WINTER_SEASON, type WinterAwardRow } from '@/lib/recap/winterAwards'

/** Minimale Client-Schnittstelle (Service-Role-Client; in Tests durch ein Fake ersetzbar). */
export interface WinterAwardsClient {
  from(table: string): any // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** Ersetzt die Winter-Auszeichnungen atomar (eine Transaktion in der DB-Funktion): wiederholtes Veröffentlichen erzeugt keine Duplikate. */
export async function replaceWinterAwards(admin: WinterAwardsClient, rows: WinterAwardRow[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.rpc('replace_winter_awards', { p_season: WINTER_SEASON, p_recap: WINTER_RECAP_KEY, p_rows: rows })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export interface VisibleWinterAward { award_key: string; award_title: string; award_icon: string; award_description: string; value_text: string | null }

/** Sichtbar NUR, solange der Winter-Recap veröffentlicht ist (Zurückziehen blendet die Pokale sofort aus; gespeicherte Zeilen bleiben unverändert). */
export async function loadVisibleWinterAwards(admin: WinterAwardsClient, userId: string): Promise<VisibleWinterAward[]> {
  const { data: setting } = await admin.from('app_settings').select('value').eq('key', HINRUNDE.settingKey).maybeSingle()
  if (setting?.value !== 'true') return []
  const { data, error } = await admin.from('winter_awards').select('award_key, award_title, award_icon, award_description, value_text').eq('user_id', userId).eq('season', WINTER_SEASON).eq('recap_key', WINTER_RECAP_KEY).order('id', { ascending: true })
  if (error || !data) return []
  return data as VisibleWinterAward[]
}
