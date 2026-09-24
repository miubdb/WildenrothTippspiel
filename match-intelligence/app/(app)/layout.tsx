import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentMembership } from '@/lib/auth'
import { signOut } from '../(auth)/actions'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/matches', label: 'Spiele' },
  { href: '/squads', label: 'Mannschaften' },
  { href: '/players', label: 'Spieler' },
  { href: '/scouting', label: 'Gegner-Scouting' },
  { href: '/scenes', label: 'Szenendatenbank' },
  { href: '/trends', label: 'Saisontrends' },
  { href: '/reports', label: 'Berichte' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const membership = await getCurrentMembership()
  if (!membership) redirect('/login')

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col justify-between border-b border-slate-800 bg-slate-900 p-4 md:w-60 md:border-b-0 md:border-r">
        <div>
          <div className="mb-6 px-2">
            <p className="text-sm font-semibold text-emerald-400">Wildenroth</p>
            <p className="text-xs text-slate-400">Match Intelligence</p>
          </div>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            {membership.isOrgAdmin && (
              <Link
                href="/admin"
                className="block rounded-md px-3 py-2 text-sm text-amber-400 transition hover:bg-slate-800"
              >
                Admin
              </Link>
            )}
          </nav>
        </div>
        <div className="mt-6 border-t border-slate-800 pt-4">
          <p className="px-2 text-sm text-slate-300">{membership.profile.displayName}</p>
          <p className="px-2 text-xs text-slate-500">
            {membership.isOrgAdmin ? 'Admin' : membership.roles.join(', ')}
          </p>
          <form action={signOut}>
            <button type="submit" className="mt-2 w-full rounded-md px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800">
              Abmelden
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 bg-slate-950 p-4 md:p-8">{children}</main>
    </div>
  )
}
