import Link from 'next/link'
import { getCurrentMembership } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createSquad, createSeason } from './actions'

export default async function SquadsPage() {
  const membership = await getCurrentMembership()
  if (!membership) return null
  const supabase = await createClient()

  let squadsQuery = supabase.from('squads').select('id, name, level, is_active').eq('org_id', membership.orgId).order('name')
  if (!membership.isOrgAdmin && membership.squadIds.length > 0) squadsQuery = squadsQuery.in('id', membership.squadIds)
  const { data: squads } = await squadsQuery

  const { data: seasons } = await supabase.from('seasons').select('id, name, is_current').eq('org_id', membership.orgId).order('start_date', { ascending: false })

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-white">Mannschaften</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(squads ?? []).map((squad) => (
          <Link
            key={squad.id}
            href={`/squads/${squad.id}`}
            className="rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-emerald-700"
          >
            <p className="font-medium text-white">{squad.name}</p>
            <p className="text-sm text-slate-400">{squad.level ?? 'Keine Liga hinterlegt'}</p>
            {!squad.is_active && <p className="mt-1 text-xs text-amber-500">inaktiv</p>}
          </Link>
        ))}
        {(!squads || squads.length === 0) && <p className="text-sm text-slate-500">Keine Mannschaft angelegt.</p>}
      </div>

      {membership.isOrgAdmin && (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Neue Mannschaft</h2>
            <form action={createSquad} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400">Name</label>
                <input name="name" required placeholder="z. B. SpVgg Wildenroth II" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Liga (optional)</label>
                <input name="level" placeholder="z. B. B-Klasse" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
              </div>
              <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                Anlegen
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Saisons</h2>
            <ul className="mb-4 space-y-1 text-sm text-slate-300">
              {(seasons ?? []).map((s) => (
                <li key={s.id}>
                  {s.name} {s.is_current && <span className="text-emerald-400">(aktuell)</span>}
                </li>
              ))}
              {(!seasons || seasons.length === 0) && <li className="text-slate-500">Keine Saison angelegt.</li>}
            </ul>
            <form action={createSeason} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400">Name</label>
                <input name="name" required placeholder="z. B. 2027/2028" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Startdatum</label>
                <input name="startDate" type="date" required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="makeCurrent" className="rounded border-slate-700 bg-slate-950" />
                Als aktuelle Saison setzen
              </label>
              <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                Saison anlegen
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
