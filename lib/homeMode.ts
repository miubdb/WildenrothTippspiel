/**
 * Startseiten-Modus der Tippen-Seite.
 *
 * In der Winterpause (keine Tipps möglich) zeigt /tipps statt der Spieltags-
 * Ansicht eine reduzierte Pausen-Startseite: Winter-Recap, Umfrage, letzter
 * Spieltags-Recap, Ausblick auf die Rückrunde. Die normale Spieltags-Ansicht
 * bleibt unverändert im Code und ist jederzeit über /tipps?matchday=<N>
 * erreichbar; der Modus entscheidet nur, was /tipps OHNE Parameter zeigt.
 *
 * Steuerung über app_settings.home_mode:
 *   - fehlt / 'auto' → automatisch: Pausen-Startseite, solange die Saison
 *     läuft, der Winter-Recap veröffentlicht ist und der nächste Anstoß mehr
 *     als WINTER_BREAK_MIN_GAP_DAYS Tage entfernt ist. Schaltet sich vor der
 *     Rückrunde also von selbst zurück.
 *   - 'winter' → Pausen-Startseite erzwingen
 *   - 'normal' → normale Spieltags-Ansicht erzwingen
 */
export const HOME_MODE_KEY = 'home_mode'
export type HomeModeSetting = 'auto' | 'winter' | 'normal'
export const HOME_MODE_SETTINGS: HomeModeSetting[] = ['auto', 'winter', 'normal']

/** Ab dieser Lücke bis zum nächsten Anstoß gilt automatisch „Pause". Deutlich
 *  länger als jede normale Spieltags-Pause, damit nie ein Wettfenster verdeckt wird. */
export const WINTER_BREAK_MIN_GAP_DAYS = 14

export function resolveHomeModeSetting(raw: string | null | undefined): HomeModeSetting {
  return raw === 'winter' || raw === 'normal' ? raw : 'auto'
}

export function isWinterBreakHome(opts: {
  setting: HomeModeSetting
  seasonStarted: boolean
  winterRecapPublished: boolean
  nextKickoff: Date | null
  now?: Date
}): boolean {
  if (opts.setting === 'winter') return true
  if (opts.setting === 'normal') return false
  if (!opts.seasonStarted || !opts.winterRecapPublished) return false
  if (!opts.nextKickoff) return true
  const now = opts.now ?? new Date()
  return opts.nextKickoff.getTime() - now.getTime() > WINTER_BREAK_MIN_GAP_DAYS * 24 * 60 * 60 * 1000
}
