import { getCurrentMembership } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createPlayer, updatePlayer } from './actions'

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ squadId?: string; seasonId?: string }> }) {
  const { squadId, seasonId } = await searchParams
  const membership = await getCurrentMembership()
  if (!membership) return null

  const supabase = await createClient()

  const [{ data: squads }, { data: seasons }, { data: players }] = await Promise.all([
    supabase.from('squads').select('id, name').eq('org_id', membership.orgId).order('name'),
    supabase.from('seasons').select('id, name, is_current').eq('org_id', membership.orgId).order('start_date', { ascending: false }),
    supabase.from('players').select('id, first_name, last_name, birth_year, is_goalkeeper, is_active, external_ids').eq('org_id', membership.orgId).order('last_name'),
  ])

  const effectiveSeasonId = seasonId ?? seasons?.find((s) => s.is_current)?.id

  let membershipsByPlayer = new Map<string, { squadName: string; jerseyNumber: number | null }[]>()
  if (effectiveSeasonId) {
    let query = supabase
      .from('player_squad_memberships')
      .select('player_id, jersey_number, squad:squad_id(id, name)')
      .eq('season_id', effectiveSeasonId)
    if (squadId) query = query.eq('squad_id', squadId)
    const { data: rows } = await query
    membershipsByPlayer = new Map()
    for (const row of rows ?? []) {
      const squad = row.squad as unknown as { id: string; name: string } | null
      if (!squad) continue
      const list = membershipsByPlayer.get(row.player_id) ?? []
      list.push({ squadName: squad.name, jerseyNumber: row.jersey_number })
      membershipsByPlayer.set(row.player_id, list)
    }
  }

  const visiblePlayers = (players ?? []).filter((p) => !squadId || membershipsByPlayer.has(p.id))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Spieler</h1>

      <form className="flex flex-wrap gap-3 text-sm">
        <select name="squadId" defaultValue={squadId ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          <option value="">Alle Mannschaften</option>
          {(squads ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="seasonId" defaultValue={effectiveSeasonId ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          {(seasons ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.is_current ? '(aktuell)' : ''}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">
          Filtern
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Jahrgang</th>
              <th className="px-4 py-3">Torwart</th>
              <th className="px-4 py-3">Mannschaft(en) / #</th>
              <th className="px-4 py-3">Status</th>
              {membership.isOrgAdmin && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950 text-slate-200">
            {visiblePlayers.map((p) => {
              const memberships = membershipsByPlayer.get(p.id) ?? []
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    {p.first_name} {p.last_name}
                  </td>
                  <td className="px-4 py-3">{p.birth_year ?? '–'}</td>
                  <td className="px-4 py-3">{p.is_goalkeeper ? 'Ja' : 'Nein'}</td>
                  <td className="px-4 py-3">
                    {memberships.length > 0
                      ? memberships.map((m) => `${m.squadName}${m.jerseyNumber ? ` (#${m.jerseyNumber})` : ''}`).join(', ')
                      : '–'}
                  </td>
                  <td className="px-4 py-3">{p.is_active ? 'aktiv' : 'inaktiv'}</td>
                  {membership.isOrgAdmin && (
                    <td className="px-4 py-3">
                      <details>
                        <summary className="cursor-pointer text-emerald-400">bearbeiten</summary>
                        <form action={updatePlayer.bind(null, p.id)} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-800 bg-slate-900 p-3">
                          <input name="firstName" defaultValue={p.first_name} placeholder="Vorname" className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs" />
                          <input name="lastName" defaultValue={p.last_name} placeholder="Nachname" className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs" />
                          <input name="birthYear" type="number" defaultValue={p.birth_year ?? ''} placeholder="Jahrgang" className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs" />
                          <label className="flex items-center gap-1 text-xs text-slate-300">
                            <input type="checkbox" name="isGoalkeeper" defaultChecked={p.is_goalkeeper} /> TW
                          </label>
                          <label className="flex items-center gap-1 text-xs text-slate-300">
                            <input type="checkbox" name="isActive" defaultChecked={p.is_active} /> aktiv
                          </label>
                          <button type="submit" className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500">
                            Speichern
                          </button>
                        </form>
                      </details>
                    </td>
                  )}
                </tr>
              )
            })}
            {visiblePlayers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Keine Spieler gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {membership.isOrgAdmin && (
        <details className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-300">Neuen Spieler anlegen</summary>
          <form action={createPlayer} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-400">Vorname</label>
              <input name="firstName" required className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Nachname</label>
              <input name="lastName" required className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Jahrgang</label>
              <input name="birthYear" type="number" className="mt-1 w-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
              <input type="checkbox" name="isGoalkeeper" className="rounded border-slate-700 bg-slate-950" />
              Torwart
            </label>
            <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              Anlegen
            </button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Um den Spieler einer Mannschaft/Saison mit Rückennummer zuzuordnen: Mannschaft öffnen → &quot;Spieler zum Kader
            hinzufügen&quot;.
          </p>
        </details>
      )}
    </div>
  )
}
