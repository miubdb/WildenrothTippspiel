'use client'

import { useEffect } from 'react'

/**
 * Der Admin-Bereich ist ein reines Arbeitswerkzeug und bewusst nur im hellen Erscheinungsbild gestaltet
 * (dichte Formulare, Tabellen, Farbcodes). Solange er offen ist, wird die Dunkel-Klasse unterdrückt und beim
 * Verlassen entsprechend der gewählten Einstellung wiederhergestellt.
 */
export function AdminForceLight() {
  useEffect(() => {
    const html = document.documentElement
    const wasDark = html.classList.contains('dark')
    html.classList.remove('dark')
    const obs = new MutationObserver(() => { if (html.classList.contains('dark')) html.classList.remove('dark') })
    obs.observe(html, { attributes: true, attributeFilter: ['class'] })
    return () => {
      obs.disconnect()
      if (wasDark || localStorage.getItem('theme') === 'dark') html.classList.add('dark')
    }
  }, [])
  return null
}
