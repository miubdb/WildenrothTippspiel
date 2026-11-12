import Link from 'next/link'

export function DemoNav({ current, me }: { current: 'spieltag' | 'winter'; me?: string }) {
  const q = me ? `?me=${me}` : ''
  const item = (id: 'spieltag' | 'winter', label: string, href: string) => (
    <Link key={id} href={href} aria-current={id === current ? 'page' : undefined}
      className={`flex-1 text-center rounded-lg py-2 text-sm font-bold transition-colors ${id === current ? 'bg-white dark:bg-gray-700 text-red-700 dark:text-red-300 shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}>{label}</Link>
  )
  return (
    <div className="space-y-2">
      <Link href={`/recap-demo${q}`} className="text-sm font-semibold text-red-700 dark:text-red-300">← Alle Recaps</Link>
      <nav aria-label="Recap-Typ" className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-1">{item('spieltag', 'Spieltag', `/recap-demo/spieltag/15${q}`)}{item('winter', 'Winter-Recap', `/recap-demo/winter${q}`)}</nav>
    </div>
  )
}
