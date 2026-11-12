'use client'

/** Fängt u. a. einen ungültigen/abgelaufenen Schlüssel ab: klare Meldung statt (irreführender) Musterdaten. */
export default function DemoError() {
  return (
    <div className="px-4 py-6">
      <div role="alert" className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/30 dark:border-red-700 p-4 text-sm text-red-900 dark:text-red-100">
        Die echten Wildenroth-Daten konnten nicht geladen werden (Schlüssel ungültig oder abgelaufen). Es werden bewusst keine Musterdaten angezeigt. Bitte den Vorschau-Link neu öffnen.
      </div>
    </div>
  )
}
