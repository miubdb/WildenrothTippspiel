import { redirect } from 'next/navigation'
import { getCurrentMembership } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createTippspielDataSource, setSquadTeamName, resolveConflict } from './actions'
import { SyncButton } from './SyncButton'

export default async function DataSourcesSettingsPage() {
  const membership = await getCurrentMembership()
  if (!membership) redirect('/login')
  if (!membership.isOrgAdmin) {
    return <p className="text-slate-400">Nur für Admins.</p>
  }

  const supabase = await createClient()

  const [{ data: dataSources }, { data: squads }, { data: openConflicts }] = await Promise.all([
    supabase.from('data_sources').select('id, source_type, name, config, is_active').eq('org_id', membership.orgId).order('source_type'),
    supabase.from('squads').select('id, name').eq('org_id', membership.orgId).eq('is_active', true).order('name'),
    supabase
      .from('data_conflicts')
      .select('id, entity_type, entity_id, field_name, conflicting_values, created_at')
      .is('resolved_at', null)
      .order('created_at', { ascending: false }),
  ])

  const tippspielSource = dataSources?.find((d) => d.source_type === 'wildenroth_tippspiel')
  const ownTeamNamesBySquad = ((tippspielSource?.config ?? {}) as { ownTeamNamesBySquad?: Record<string, string[]> }).ownTeamNamesBySquad ?? {}

  let syncRuns: { id: string; status: string; matches_created: number; matches_updated: number; matches_unchanged: number; conflicts_created: number; started_at: string; finished_at: string | null }[] = []
  if (tippspielSource) {
    const { data } = await supabase
      .from('sync_runs')
      .select('id, status, matches_created, matches_updated, matches_unchanged, conflicts_created, started_at, finished_at')
      .eq('data_source_id', tippspielSource.id)
      .order('started_at', { ascending: false })
      .limit(10)
    syncRuns = data ?? []
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-white">Datenquellen</h1>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Wildenroth Tippspiel (read-only)</h2>

        {!tippspielSource ? (
          <form action={createTippspielDataSource}>
            <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              Tippspiel-Datenquelle anlegen
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              {(squads ?? []).map((squad) => {
                const currentName = ownTeamNamesBySquad[squad.id]?.[0] ?? ''
                const boundSetName = setSquadTeamName.bind(null, tippspielSource.id, squad.id)
                return (
                  <div key={squad.id} className="flex flex-col gap-2 border-b border-slate-800 pb-4 last:border-0 sm:flex-row sm:items-end sm:justify-between">
                    <form action={async (formData: FormData) => {
                      'use server'
                      await boundSetName(String(formData.get('teamName') ?? ''))
                    }} className="flex items-end gap-2">
                      <div>
                        <label className="block text-xs text-slate-400">Team-Name im Tippspiel für &quot;{squad.name}&quot;</label>
                        <input
                          name="teamName"
                          defaultValue={currentName}
                          placeholder="z. B. SpVgg Wildenroth"
                          className="mt-1 w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <button type="submit" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
                        Speichern
                      </button>
                    </form>
                    {currentName ? <SyncButton squadId={squad.id} squadName={squad.name} /> : <p className="text-xs text-slate-600">Team-Name zuerst speichern.</p>}
                  </div>
                )
              })}
              {(!squads || squads.length === 0) && <p className="text-sm text-slate-500">Keine Mannschaft angelegt.</p>}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Letzte Syncs</h3>
              {syncRuns.length === 0 ? (
                <p className="text-sm text-slate-500">Noch kein Sync durchgeführt.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-4">Gestartet</th>
                      <th className="py-1 pr-4">Status</th>
                      <th className="py-1 pr-4">Neu</th>
                      <th className="py-1 pr-4">Aktualisiert</th>
                      <th className="py-1 pr-4">Unverändert</th>
                      <th className="py-1 pr-4">Konflikte</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {syncRuns.map((run) => (
                      <tr key={run.id} className="border-t border-slate-800">
                        <td className="py-1.5 pr-4">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                        <td className="py-1.5 pr-4 capitalize">{run.status}</td>
                        <td className="py-1.5 pr-4">{run.matches_created}</td>
                        <td className="py-1.5 pr-4">{run.matches_updated}</td>
                        <td className="py-1.5 pr-4">{run.matches_unchanged}</td>
                        <td className="py-1.5 pr-4">{run.conflicts_created}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Offene Datenkonflikte ({openConflicts?.length ?? 0})
        </h2>
        {!openConflicts || openConflicts.length === 0 ? (
          <p className="text-sm text-slate-500">Keine offenen Konflikte.</p>
        ) : (
          <ul className="space-y-3">
            {openConflicts.map((conflict) => {
              const values = conflict.conflicting_values as unknown as { source: string; value: unknown }[]
              const current = values.find((v) => v.source === 'manual')?.value
              const imported = values.find((v) => v.source === 'wildenroth_tippspiel')?.value
              const boundResolve = resolveConflict.bind(null, conflict.id)
              return (
                <li key={conflict.id} className="rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm">
                  <p className="text-amber-200">
                    {conflict.entity_type}.{conflict.field_name}: manuell = <code>{JSON.stringify(current)}</code>, Tippspiel ={' '}
                    <code>{JSON.stringify(imported)}</code>
                  </p>
                  <div className="mt-2 flex gap-2">
                    <form action={async () => { 'use server'; await boundResolve('keep_current') }}>
                      <button type="submit" className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800">
                        Manuellen Wert behalten
                      </button>
                    </form>
                    <form action={async () => { 'use server'; await boundResolve('accept_import') }}>
                      <button type="submit" className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800">
                        Tippspiel-Wert übernehmen
                      </button>
                    </form>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
