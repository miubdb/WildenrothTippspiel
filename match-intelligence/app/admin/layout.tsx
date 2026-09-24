import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentMembership } from '@/lib/auth'

/**
 * Real admin gate: re-checks `memberships` server-side (RLS-scoped, so this
 * can never be fooled by client state), not a JWT claim. proxy.ts only does
 * an optimistic pre-check for UX; this is the actual boundary for page
 * rendering, and every /api/admin/* route re-checks again itself, since the
 * proxy does not run in front of API routes either.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) redirect('/dashboard')

  return (
    <div className="space-y-6">
      <nav className="flex gap-4 border-b border-slate-800 pb-3 text-sm">
        <Link href="/admin" className="text-slate-300 hover:text-white">Übersicht</Link>
        <Link href="/admin/users" className="text-slate-300 hover:text-white">Benutzer</Link>
        <Link href="/squads" className="text-slate-300 hover:text-white">Mannschaften</Link>
        <Link href="/settings/data-sources" className="text-slate-300 hover:text-white">Datenquellen</Link>
      </nav>
      {children}
    </div>
  )
}
