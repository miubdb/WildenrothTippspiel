import { notFound } from 'next/navigation'
import { getCurrentMembership } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { addPlayerToSquad, updateSquad } from '../actions'

export default async function SquadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  if (!membership) return null

  const supabase = await createClient()
  const { data: squad } = await supabase.from('squads').select('id, org_id, name, level, is_active').eq('id', id).maybeSingle()
  if (!squad) notFound()

  const canEdit = membership.isOrgAdmin

  const { data: season } = await supabase.from('seasons').select('id, name').eq('org_id', squad.org_id).eq('is_current', true).maybeSingle()

  const { data: memberships } = season
    ? await supabase
        .from('player_squad_memberships')
        .select('id, jersey_number, position, status, player:player_id(id, first_name, last_name, is_goalkeeper, is_active)')
        .eq('squad_id', squad.id)
        .eq('season_id', season.id)
        .order('jersey_number', { ascending: true, nullsFirst: false })
    : { data: null }

  const { data: allPlayers } = await supabase.from('players').select('id, first_name, last_name').eq('org_id', squad.org_id).order('last_name')

  const boundAddPlayer = season ? addPlayerToSquad.bind(null, squad.id, season.id) : null
  const boundUpdateSquad = updateSquad.bind(null, squad.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{squad.name}</h1>
        <p className="text-sm text-slate-400">{squad.level ?? 'Keine Liga hinterlegt'}</p>
      </div>

      {canEdit && (
        <details className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-300">Mannschaft bearbeiten</summary>
          <form action={boundUpdateSquad} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-400">Name</label>
              <input name="name" defaultValue={squad.name} className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Liga</label>
              <input name="level" defaultValue={squad.level ?? ''} className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
              <input type="checkbox" name="isActive" defaultChecked={squad.is_active} className="rounded border-slate-700 bg-slate-950" />
              Aktiv
            </label>
            <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              Speichern
            </button>
          </form>
        </details>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Kader {season ? `— ${season.name}` : ''}
        </h2>

        {!season ? (
          <p className="text-sm text-slate-500">Keine aktuelle Saison konfiguriert.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-4">#</th>
                  <th className="py-1 pr-4">Name</th>
                  <th className="py-1 pr-4">Position</th>
                  <th className="py-1 pr-4">Torwart</th>
                  <th className="py-1 pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {(memberships ?? []).map((m) => {
                  const player = m.player as unknown as { first_name: string; last_name: string; is_goalkeeper: boolean } | null
                  return (
                    <tr key={m.id} className="border-t border-slate-800">
                      <td className="py-1.5 pr-4">{m.jersey_number ?? '–'}</td>
                      <td className="py-1.5 pr-4">{player ? `${player.first_name} ${player.last_name}` : 'Unbekannt'}</td>
                      <td className="py-1.5 pr-4">{m.position ?? '–'}</td>
                      <td className="py-1.5 pr-4">{player?.is_goalkeeper ? 'Ja' : 'Nein'}</td>
                      <td className="py-1.5 pr-4">{m.status}</td>
                    </tr>
                  )
                })}
                {(!memberships || memberships.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-500">
                      Noch kein Spieler für diese Saison zugeordnet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {canEdit && boundAddPlayer && (
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-semibold text-slate-300">Spieler zum Kader hinzufügen</summary>
                <form action={boundAddPlayer} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-400">Bestehenden Spieler wählen</label>
                    <select name="existingPlayerId" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                      <option value="">— neuen Spieler anlegen —</option>
                      {(allPlayers ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.first_name} {p.last_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400">Vorname (falls neu)</label>
                      <input name="firstName" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">Nachname (falls neu)</label>
                      <input name="lastName" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400">Rückennummer (diese Saison)</label>
                    <input name="jerseyNumber" type="number" min={1} max={99} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400">Position</label>
                    <input name="position" placeholder="z. B. Abwehr" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" name="isGoalkeeper" className="rounded border-slate-700 bg-slate-950" />
                    Torwart (nur bei neuem Spieler)
                  </label>
                  <div className="sm:col-span-2">
                    <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                      Hinzufügen
                    </button>
                  </div>
                </form>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  )
}
