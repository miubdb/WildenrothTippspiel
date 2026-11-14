import type { Match } from '@/types'
import { buildEffectiveMatchdayIndex, recapMatchdayOf } from '@/lib/season'
import type { RecapBetRow, RecapMatchRow } from '@/lib/recap/slips'
import { isPendingBetBlockingFinalization, type CompletionSpecial } from '@/lib/matchdayFinishReadiness'

/**
 * Wann ist ein Recap-Zeitraum „bereit"? Dieselbe Regel wie lib/matchdayFinalize.ts#finalizeMatchdayIfDone,
 * nur für einen ganzen Zeitraum: JEDER Recap-Spieltag (effektive Zuordnung inkl. Nachholspielen,
 * Wildenroth II, Topspielen) hat mind. ein Spiel, alle nicht verschobenen/annullierten Spiele sind
 * beendet, und es gibt keine offene Wette mehr auf diese Spiele. Offene Wetten auf
 * verschobene/annullierte Partien warten auf deren eigene Abrechnung und
 * blockieren den ursprünglichen Zeitraum NICHT; echte offene Specials werden
 * anhand ihrer included_match_ids geprüft. Niemals nach Datum allein.
 *
 * „Bereit" ist NICHT „sichtbar": öffentlich wird ein Recap erst nach manueller Admin-Freigabe
 * (app_settings.recap_published_<key>) — siehe `recapVisibility`.
 */

export interface MatchdayReadiness {
  matchday: number; matches: number; finished: number; postponed: number; annulled: number
  notFinished: number
  /** Nur tatsächlich blockierende offene Wettzeilen – nicht verschobene. */
  openBetRows: number
  /** Noch offene Tipps, die ausschließlich auf verschobene/annullierte Spiele warten. */
  deferredBetRows: number
  complete: boolean
}
export interface RangeReadiness { ready: boolean; matchdays: MatchdayReadiness[]; blockers: string[] }

type ReadinessBet = Pick<RecapBetRow, 'match_id' | 'status' | 'season'> & Partial<Pick<RecapBetRow, 'market_type' | 'special_id'>>

/** Same underlying per-bet rule as the Spieltag finalizer (never a second, divergent definition).
 * Missing Special references block as a precaution.
 */
export function computeRangeReadiness(
  matches: RecapMatchRow[],
  bets: ReadinessBet[],
  from: number,
  to: number,
  season = '26/27',
  specials: CompletionSpecial[] = [],
): RangeReadiness {
  const idx = buildEffectiveMatchdayIndex(matches as unknown as Match[])
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const specialById = new Map(specials.map((s) => [s.id, s]))
  const openByMatch = new Map<number, { blocking: number; deferred: number }>()
  for (const b of bets) {
    if (b.season !== season || b.status !== 'pending' || b.match_id == null) continue
    const pending = {
      match_id: b.match_id, status: b.status,
      market_type: b.market_type ?? 'unknown',
      special_id: b.special_id ?? null,
    }
    const isBlocking = isPendingBetBlockingFinalization(pending, matchById, specialById)
    const count = openByMatch.get(b.match_id) ?? { blocking: 0, deferred: 0 }
    if (isBlocking) count.blocking++
    else count.deferred++
    openByMatch.set(b.match_id, count)
  }
  const byMd = new Map<number, RecapMatchRow[]>()
  for (const m of matches) {
    const md = recapMatchdayOf(m as unknown as Match, idx)
    if (md == null || md >= 900 || md < from || md > to) continue
    ;(byMd.get(md) ?? byMd.set(md, []).get(md)!).push(m)
  }
  const rows: MatchdayReadiness[] = []
  const blockers: string[] = []
  for (let md = from; md <= to; md++) {
    const ms = byMd.get(md) ?? []
    const relevant = ms.filter((m) => m.status !== 'postponed' && m.status !== 'annulled')
    const finished = relevant.filter((m) => m.status === 'finished').length
    const open = ms.reduce((a, m) => a + (openByMatch.get(m.id)?.blocking ?? 0), 0)
    const deferred = ms.reduce((a, m) => a + (openByMatch.get(m.id)?.deferred ?? 0), 0)
    const complete = ms.length > 0 && relevant.length > 0 && finished === relevant.length && open === 0
    rows.push({ matchday: md, matches: ms.length, finished, postponed: ms.filter((m) => m.status === 'postponed').length,
      annulled: ms.filter((m) => m.status === 'annulled').length,
      notFinished: relevant.length - finished, openBetRows: open, deferredBetRows: deferred, complete })
    if (ms.length === 0) blockers.push(`Spieltag ${md}: keine Spiele gefunden`)
    else if (!complete) blockers.push(`Spieltag ${md}: ${relevant.length - finished} Spiel(e) offen, ${open} offene Wettzeile(n)`)
  }
  return { ready: rows.length > 0 && rows.every((r) => r.complete), matchdays: rows, blockers }
}

export type RecapVisibility = 'hidden_not_ready' | 'ready_unpublished' | 'published'
/** Sichtbarkeit für Mitglieder; Admins sehen „bereit" immer als Vorschau (Aufrufer entscheidet). */
export function recapVisibility(ready: boolean, publishedSetting: string | null | undefined): RecapVisibility {
  if (!ready) return 'hidden_not_ready'
  return publishedSetting === 'true' ? 'published' : 'ready_unpublished'
}

export const HINRUNDE = { key: 'hinrunde', from: 1, to: 16, title: 'Hinrunden-Recap', settingKey: 'recap_published_hinrunde' } as const

/**
 * Darf der Bericht (die Auswertung selbst, nicht nur die Hülle) an diesen Betrachter gehen?
 * Einzige Stelle der Zugriffsentscheidung – wird serverseitig in loadHinrundeState VOR dem Berechnen
 * ausgewertet, damit unveröffentlichte Zahlen nie in die Antwort an normale Mitglieder gelangen.
 * Mitglieder: nur veröffentlicht (setzt „bereit" voraus). Admins: Vorschau, sobald mind. ein Spieltag fertig ist.
 */
export function canViewRecapReport(visibility: RecapVisibility, isAdmin: boolean, completedUpTo: number): boolean {
  if (visibility === 'published') return true
  return isAdmin && completedUpTo > 0
}
