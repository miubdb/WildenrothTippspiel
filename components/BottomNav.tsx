'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { navBadgeLabel, type NavBetState } from '@/components/navBetState'

type Item = { href: string; label: string; match: string[]; icon: (p: { className?: string }) => React.ReactElement }

const svg = (d: string) => function Icon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

const WETTEN = svg('M3 9a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v6a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2V9zM9 7v10')
const RANG = svg('M5 20V12M12 20V5M19 20v-9')
const LIGA = svg('M4 5h16v14H4zM4 10h16M4 15h16M9 5v14')
const PROFIL = svg('M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4.5 21a7.5 7.5 0 0 1 15 0')

// Fünf feste Punkte. Unterseiten leuchten beim passenden Hauptpunkt (z. B. /team/x unter „Liga“).
const LEFT: Item[] = [
  { href: '/meine-wetten', label: 'Meine Wetten', match: ['/meine-wetten'], icon: WETTEN },
  { href: '/leaderboard', label: 'Rangliste', match: ['/leaderboard', '/spieler', '/recap'], icon: RANG },
]
const RIGHT: Item[] = [
  { href: '/tabelle', label: 'Liga', match: ['/tabelle', '/team', '/kader', '/liga-stats', '/ergebnis'], icon: LIGA },
  { href: '/profil', label: 'Profil', match: ['/profil', '/umfrage', '/willkommen', '/anleitung'], icon: PROFIL },
]

const isActive = (pathname: string, match: string[]) => match.some((m) => pathname === m || pathname.startsWith(m + '/'))

function NavLink({ item, pathname, badge, badgeLabel, pendingHref, onPick }: { item: Item; pathname: string; badge?: number; badgeLabel?: string; pendingHref: string | null; onPick: (href: string) => void}) {
  // Antippen färbt den Punkt SOFORT ein (optimistisch), ohne auf den Server zu warten; bei Ankunft übernimmt der echte Pfad.
  const active = pendingHref ? pendingHref === item.href : isActive(pathname, item.match)
  const Icon = item.icon
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} onClick={() => onPick(item.href)}
      className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 pt-2.5 pb-1.5 text-[11px] font-semibold transition-colors ${active ? 'text-red-700 dark:text-red-400' : 'text-gray-400 dark:text-gray-500 active:text-gray-600 dark:active:text-gray-300'}`}>
      {active && <span className="absolute top-0 h-[3px] w-7 rounded-b-full bg-red-700 dark:bg-red-400" />}
      <span className="relative">
        <Icon className="h-6 w-6" />
        {badge != null && badge > 0 && (
          <span role="img" aria-label={badgeLabel ?? `${badge} platzierte ${badge === 1 ? 'Wette' : 'Wetten'}`}
            className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white dark:border-gray-900 bg-red-700 px-1 font-display text-[11px] font-bold leading-none text-white">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      <span className="max-w-full truncate leading-none">{item.label}</span>
    </Link>
  )
}

export function BottomNav({ navBets = null }: { navBets?: NavBetState | null }) {
  const pathname = usePathname()
  // Optimistischer aktiver Punkt: gilt nur, solange der Pfad beim Antippen noch derselbe ist (danach zeigt der echte Pfad die Wahrheit).
  const [pick, setPick] = useState<{ href: string; from: string } | null>(null)
  const pendingHref = pick && pick.from === pathname ? pick.href : null
  const onPick = (href: string) => setPick({ href, from: pathname })
  // KEIN automatisches Vorwärmen der Hauptseiten (in einer früheren Version getestet und
  // zurückgenommen — kostete ≈30 % mehr Datenbankabfragen für mehrere gleichzeitige
  // Vollseiten-Berechnungen, nur um einen Klick zu beschleunigen). Die Links prefetchen
  // weiterhin nur ihr eigenes Ladegerüst (Next.js-Standardverhalten).
  const tippenActive = pendingHref ? pendingHref === '/tipps' : pathname === '/tipps' || pathname.startsWith('/tipps/')
  return (
    <nav aria-label="Hauptnavigation" className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-[0_-4px_18px_rgba(0,0,0,0.06)]">
      {/* Seitenabstand mind. 16 px bzw. Safe-Area: abgerundete iPhone-Ecken und Notch/Landscape schneiden nichts ab */}
      <div className="relative mx-auto flex max-w-lg items-stretch pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        {LEFT.map((it) => <NavLink key={it.href} item={it} pathname={pathname} badge={it.href === '/meine-wetten' && navBets ? navBets.normal + navBets.risky : undefined} badgeLabel={it.href === '/meine-wetten' ? navBadgeLabel(navBets) : undefined} pendingHref={pendingHref} onPick={onPick} />)}
        {/* Mittelpunkt: Tippen mit dem Wildi-Coin, leicht über die Leiste schwebend */}
        <Link href="/tipps" aria-label="Tippen" aria-current={tippenActive ? 'page' : undefined} onClick={() => onPick('/tipps')}
          className="relative flex min-w-0 flex-1 flex-col items-center justify-end pb-1.5 text-[11px] font-semibold">
          <span className={`absolute -top-7 flex h-[62px] w-[62px] items-center justify-center rounded-full border-[4px] border-white dark:border-gray-900 bg-white dark:bg-gray-900 shadow-[0_4px_14px_rgba(0,0,0,0.22)] transition-transform active:scale-95 ${tippenActive ? 'ring-2 ring-red-700 dark:ring-red-400' : ''}`}>
            <Image src="/wildi-coin.png" alt="" width={56} height={56} priority className="h-[52px] w-[52px] rounded-full object-cover" />
          </span>
          <span className={tippenActive ? 'text-red-700 dark:text-red-400 leading-none' : 'text-gray-400 dark:text-gray-500 leading-none'}>Tippen</span>
        </Link>
        {RIGHT.map((it) => <NavLink key={it.href} item={it} pathname={pathname} pendingHref={pendingHref} onPick={onPick} />)}
      </div>
    </nav>
  )
}
