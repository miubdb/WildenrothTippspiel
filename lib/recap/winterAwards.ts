import { sameScore, type AwardEntry, type AwardResult } from '@/lib/recap/halbzeitAwards'
import type { RecapReport } from '@/lib/recap/report'

/**
 * Winter-Auszeichnungen („Hinrunde 2026/27“) für den Pokalschrank. Die Gewinner stammen aus EXAKT derselben Berechnung wie
 * der Winter-Recap (`RecapReport.awards`); die Gleichstandsregel ist dieselbe wie in der Oberfläche: alle Einträge mit
 * derselben angezeigten Zahl wie Platz 1 sind gleichberechtigte Gewinner.
 */
export const WINTER_RECAP_KEY = 'hinrunde'
export const WINTER_SEASON = '26/27'
export const WINTER_LABEL = 'Hinrunde 2026/27'

export const WINTER_AWARD_KEYS = ['wildi_magnet', 'hall_der_ehre', 'hall_der_schande', 'gegenwetten', 'senkrechtstarter', 'aussenseiter_jaeger', 'kombi_pech', 'quotenfluesterer'] as const
export type WinterAwardKey = (typeof WINTER_AWARD_KEYS)[number]

const DESCRIPTION: Record<WinterAwardKey, string> = {
  wildi_magnet: 'Am meisten Wildis verdient',
  hall_der_ehre: 'Meiste Wildenroth-Spiele auf Sieg getippt – nie dagegen',
  hall_der_schande: 'Am meisten mit Wetten gegen Wildenroth gewonnen',
  gegenwetten: 'Am häufigsten gegen Wildenroth gewettet',
  senkrechtstarter: 'Am weitesten in der Rangliste nach oben geklettert',
  aussenseiter_jaeger: 'Am häufigsten Quote 5,00 oder höher getroffen',
  kombi_pech: 'Kombis, bei denen nur ein Tipp fehlte',
  quotenfluesterer: 'Höchster Tipper-IQ der Hinrunde',
}

/** Alle Gewinner eines Awards: Einträge mit demselben fachlichen Rangwert (`score`) wie Platz 1 – nie anhand gerundeter Anzeigetexte. */
export const winnersOf = (entries: AwardEntry[]): AwardEntry[] => (entries.length ? entries.filter((e) => sameScore(e, entries[0])) : [])

export interface WinterAwardRow {
  season: string
  recap_key: string
  award_key: WinterAwardKey
  user_id: string
  award_title: string
  award_icon: string
  award_description: string
  value_text: string | null
}

export function extractWinterAwards(report: RecapReport): WinterAwardRow[] {
  const by = (k: string): AwardResult | undefined => report.awards.find((a) => a.key === k)
  const defs: { key: WinterAwardKey; title: string; icon: string; entries: AwardEntry[] }[] = []
  for (const k of WINTER_AWARD_KEYS) {
    if (k === 'gegenwetten') {
      const s = by('hall_der_schande')?.second
      if (s) defs.push({ key: k, title: s.title, icon: '🔁', entries: s.entries })
    } else {
      const a = by(k)
      if (a) defs.push({ key: k, title: a.title, icon: a.icon, entries: a.entries })
    }
  }
  const out: WinterAwardRow[] = []
  const seen = new Set<string>()
  for (const d of defs) {
    for (const w of winnersOf(d.entries)) {
      const id = `${d.key}|${w.userId}`
      if (seen.has(id)) continue // nie Duplikate
      seen.add(id)
      out.push({ season: WINTER_SEASON, recap_key: WINTER_RECAP_KEY, award_key: d.key, user_id: w.userId, award_title: d.title, award_icon: d.icon, award_description: DESCRIPTION[d.key], value_text: w.value })
    }
  }
  return out
}
