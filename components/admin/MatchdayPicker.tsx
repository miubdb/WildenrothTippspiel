'use client'

import { Btn, selectCls } from '@/components/admin/ui'

/** Spieltag-Auswahl mit Zurück/Weiter – Reihenfolge wie im Spielplan (nicht nach BFV-Nummer). `all` fügt „Alle Spieltage“ hinzu. */
export function MatchdayPicker({ value, options, current, onChange, all }: {
  value: number | 'all' | null
  options: number[]
  /** Aktuell bearbeiteter Spieltag – wird in der Liste markiert. */
  current: number | null
  onChange: (v: number | 'all') => void
  all?: boolean
}) {
  const idx = typeof value === 'number' ? options.indexOf(value) : -1
  const label = (md: number) => (md === 999 ? 'Test' : `Spieltag ${md}`)
  return (
    <div>
      <div className="flex items-center gap-2">
        <Btn size="sm" variant="secondary" aria-label="Vorheriger Spieltag" disabled={idx <= 0} onClick={() => onChange(options[idx - 1])}>‹</Btn>
        <select aria-label="Spieltag" value={value ?? ''} className={`${selectCls} flex-1 font-semibold`}
          onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          {value == null && <option value="" disabled>Spieltag wählen</option>}
          {all && <option value="all">Alle Spieltage</option>}
          {options.map((md) => <option key={md} value={md}>{md === current ? '★ ' : ''}{label(md)}</option>)}
        </select>
        <Btn size="sm" variant="secondary" aria-label="Nächster Spieltag" disabled={idx < 0 || idx >= options.length - 1} onClick={() => onChange(options[idx + 1])}>›</Btn>
      </div>
      {current != null && value !== current && <p className="mt-1.5 text-[12px] text-gray-600">★ = aktuell bearbeiteter Spieltag ({label(current)})</p>}
    </div>
  )
}
