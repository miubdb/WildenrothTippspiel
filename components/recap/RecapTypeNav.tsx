import Link from 'next/link'

/** Umschalter zwischen Recap-Typen. Neue Typen (Monat, Rückrunde, Saison, „Meine Hinrunde") hier ergänzen –
 *  sie erscheinen nur, wenn `available` wahr ist. Reine Links (Direktlinks, Zurück-Taste funktioniert). */
export type RecapTypeId = 'spieltag' | 'hinrunde'
const TYPES: { id: RecapTypeId; label: string; href: string }[] = [
  { id: 'spieltag', label: 'Spieltag', href: '/recap' },
  { id: 'hinrunde', label: 'Hinrunde', href: '/recap/hinrunde' },
]

export function RecapTypeNav({ current, available }: { current: RecapTypeId; available: Partial<Record<RecapTypeId, boolean>> }) {
  const items = TYPES.filter((t) => t.id === 'spieltag' || available[t.id])
  if (items.length < 2) return null
  return (
    <nav aria-label="Recap-Typ" className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-1">
      {items.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === current ? 'page' : undefined}
          className={`flex-1 text-center rounded-lg py-2 text-sm font-bold transition-colors ${t.id === current ? 'bg-white dark:bg-gray-700 text-red-700 dark:text-red-300 shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
