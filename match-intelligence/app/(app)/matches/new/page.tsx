import { redirect } from 'next/navigation'
import { getCurrentMembership } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createMatch } from '../actions'

export default async function NewMatchPage() {
  const membership = await getCurrentMembership()
  if (!membership) redirect('/login')

  const supabase = await createClient()

  let squadsQuery = supabase.from('squads').select('id, name').eq('org_id', membership.orgId).eq('is_active', true)
  if (!membership.isOrgAdmin) squadsQuery = squadsQuery.in('id', membership.squadIds)
  const { data: squads } = await squadsQuery.order('name')

  const [{ data: teams }, { data: competitions }, { data: seasons }] = await Promise.all([
    supabase.from('teams').select('id, name').eq('org_id', membership.orgId).eq('is_own_club', false).order('name'),
    supabase.from('competitions').select('id, name').eq('org_id', membership.orgId).order('name'),
    supabase.from('seasons').select('id, name, is_current').eq('org_id', membership.orgId).order('start_date', { ascending: false }),
  ])

  if (!squads || squads.length === 0) {
    return <p className="text-slate-400">Keine bearbeitbare Mannschaft vorhanden.</p>
  }

  const currentSeasonId = seasons?.find((s) => s.is_current)?.id

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold text-white">Spiel manuell anlegen</h1>
      <form action={createMatch} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div>
          <label className="block text-xs text-slate-400">Mannschaft</label>
          <select name="squadId" required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
            {squads.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400">Saison</label>
          <select name="seasonId" required defaultValue={currentSeasonId} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
            {(seasons ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400">Gegner</label>
          <select name="opponentTeamId" required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
            <option value="">— wählen —</option>
            {(teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Neuer Gegner? Aktuell nur über die Datenbank/Import — Team-Verwaltung folgt in Phase 3.</p>
        </div>
        <div>
          <label className="block text-xs text-slate-400">Wettbewerb (optional)</label>
          <select name="competitionId" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
            <option value="">— keiner —</option>
            {(competitions ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400">Heim/Auswärts</label>
            <select name="homeAway" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="home">Heim</option>
              <option value="away">Auswärts</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400">Spieltag (optional)</label>
            <input name="matchday" type="number" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400">Datum/Uhrzeit</label>
          <input name="kickoffAt" type="datetime-local" required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        </div>
        <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          Spiel anlegen
        </button>
      </form>
    </div>
  )
}
