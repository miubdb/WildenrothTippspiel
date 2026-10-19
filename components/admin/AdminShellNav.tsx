'use client'

import { cx } from '@/components/ui'
import { ADMIN_TAB_ICONS, AdminTabBadge } from '@/components/admin/ui'

/**
 * Echtes Desktop-/Mobile-Grundgerüst aus dem alten, verworfenen Admin-Redesign übernommen
 * (dort components/admin/AdminShell.tsx) — nur der Navigationsteil, nicht dessen eigene
 * Datenhaltung (useAdminMatches/useAdminUsers/usePendingBetCounts entfallen bewusst; `tab` und
 * der Verwaltungs-Badge-Zähler kommen weiterhin aus AdminPage, wie seit Schritt 1). Desktop:
 * feste Seitenleiste mit Beschreibung + Untermenüs je Bereich. Mobil: feste Leiste unten mit
 * allen fünf Bereichen. Beide steuern denselben `tab`-Zustand.
 *
 * Die Untermenüs (`subs`) sind Sprungmarken auf Abschnitts-IDs innerhalb des jeweils aktiven
 * Tabs (`document.getElementById`). Für Ergebnisse gibt es bewusst keine — schon im alten
 * Redesign leer, weil die Filter dort die Rolle übernehmen. Für die anderen vier Tabs
 * (Spieltag/Quoten/Verwaltung/Umfrage) ist inzwischen jede hier gelistete `id` auch tatsächlich
 * ein `<Section id="…">`/`id="…"` in der jeweiligen Tab-Fläche — alle fünf Tabs sind
 * durchgestaltet, kein Sprungziel ins Leere mehr.
 */

export type AdminTab = 'ergebnisse' | 'spieltag' | 'quoten' | 'verwaltung' | 'umfrage'

type TabDef = { id: AdminTab; label: string; desc: string; subs: { id: string; label: string }[] }

const TABS: TabDef[] = [
  { id: 'ergebnisse', label: 'Ergebnisse', desc: 'Ergebnisse eintragen und Wetten abrechnen', subs: [] },
  { id: 'spieltag', label: 'Spieltag', desc: 'Spiele, Tipps der Spieler, Topspiel, Torschützen', subs: [
    { id: 'sp-spiele', label: 'Spiele' }, { id: 'sp-tipps', label: 'Tipps' }, { id: 'sp-topspiel', label: 'Topspiel' }, { id: 'sp-torschuetzen', label: 'Torschützen & Verfügbarkeit' },
  ] },
  { id: 'quoten', label: 'Quoten', desc: 'Neu berechnen, Vorschau, manuell überschreiben', subs: [
    { id: 'qu-berechnung', label: 'Neu berechnen' }, { id: 'qu-vorschau', label: 'Vorschau & Überschreiben' },
  ] },
  { id: 'verwaltung', label: 'Verwaltung', desc: 'Spieler, Kader & Transfers, Saison, Technik & Tests, Bonus-Tipps, Specials', subs: [
    { id: 'vw-spieler', label: 'Spieler' }, { id: 'vw-kader', label: 'Kader & Transfers' }, { id: 'vw-saison', label: 'Saison' },
    { id: 'vw-sonstiges', label: 'Technik & Tests' }, { id: 'vw-bonus', label: 'Bonus-Tipps' }, { id: 'vw-specials', label: 'Specials' },
  ] },
  { id: 'umfrage', label: 'Umfrage', desc: 'Antworten, Auswertungen, Sichtbarkeit', subs: [
    { id: 'uf-sichtbarkeit', label: 'Sichtbarkeit' }, { id: 'uf-uebersicht', label: 'Übersicht' },
    { id: 'uf-fragen', label: 'Je Frage' }, { id: 'uf-antworten', label: 'Einzelantworten' }, { id: 'uf-danger', label: 'Reset' },
  ] },
]

/** Springt zu einem Abschnitt der aktuellen Seite und klappt ihn dabei auf (falls <details>). */
function jumpTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (el instanceof HTMLDetailsElement) el.open = true
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function AdminShellNav({ tab, onTabChange, newUserCount }: {
  tab: AdminTab
  onTabChange: (t: AdminTab) => void
  newUserCount: number
}) {
  const current = TABS.find((t) => t.id === tab)!

  return (
    <>
      {/* Desktop: Seitenleiste mit Bereichen und ihren Unterabschnitten */}
      <aside className="hidden lg:block lg:w-[260px] lg:flex-shrink-0">
        <nav aria-label="Admin-Bereiche" className="sticky top-16 space-y-1">
          {TABS.map((t) => {
            const Icon = ADMIN_TAB_ICONS[t.id]
            const active = tab === t.id
            return (
              <div key={t.id}>
                <button type="button" id={`admin-tab-${t.id}`} role="tab" aria-selected={active} aria-current={active ? 'page' : undefined} onClick={() => onTabChange(t.id)}
                  className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors', active ? 'bg-red-700 text-white shadow' : 'text-gray-800 hover:bg-gray-100')}>
                  <Icon className="h-6 w-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-bold leading-5">{t.label}</span>
                    <span className={cx('block text-[12px] leading-4', active ? 'text-red-50' : 'text-gray-600')}>{t.desc}</span>
                  </span>
                  {t.id === 'verwaltung' && <AdminTabBadge n={newUserCount} />}
                </button>
                {active && t.subs.length > 0 && (
                  <ul className="mb-2 ml-6 mt-1 space-y-0.5 border-l-2 border-gray-300 pl-3">
                    {t.subs.map((s) => (
                      <li key={s.id}><button type="button" onClick={() => jumpTo(s.id)} className="min-h-[36px] w-full rounded-lg px-2 text-left text-[14px] font-semibold text-gray-700 hover:bg-gray-100">{s.label}</button></li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>
      </aside>

      {/* Mobil: Unterabschnitte als umbrechende Sprungmarken (kein seitliches Scrollen) */}
      {current.subs.length > 0 && (
        <nav aria-label={`Abschnitte in ${current.label}`} className="mb-4 flex flex-wrap gap-2 lg:hidden">
          {current.subs.map((s) => (
            <button key={s.id} type="button" onClick={() => jumpTo(s.id)} className="min-h-[40px] rounded-full border-2 border-gray-300 bg-white px-3.5 text-[14px] font-bold text-gray-800 active:bg-gray-100">{s.label}</button>
          ))}
        </nav>
      )}

      {/* Mobil: feste Tab-Leiste unten – alle fünf Bereiche mit vollem Namen, aktiver Bereich klar markiert, Safe-Area berücksichtigt */}
      <nav aria-label="Admin-Bereiche" className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-300 bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.08)] lg:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-5 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {TABS.map((t) => {
            const Icon = ADMIN_TAB_ICONS[t.id]
            const active = tab === t.id
            return (
              <button key={t.id} type="button" role="tab" aria-selected={active} aria-current={active ? 'page' : undefined} onClick={() => onTabChange(t.id)}
                className={cx('relative flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-1 px-0.5 pt-1.5 text-[11px] font-bold tracking-tight transition-colors', active ? 'text-red-700' : 'text-gray-600 active:text-gray-900')}>
                {active && <span aria-hidden className="absolute top-0 h-[3px] w-9 rounded-b-full bg-red-700" />}
                <span className="relative">
                  <Icon className="h-6 w-6" />
                  {t.id === 'verwaltung' && <AdminTabBadge n={newUserCount} className="absolute -right-3 -top-1.5 border-2 border-white" />}
                </span>
                <span className="whitespace-nowrap leading-none">{t.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
