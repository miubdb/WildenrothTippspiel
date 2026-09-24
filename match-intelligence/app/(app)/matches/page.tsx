import Link from 'next/link'
import { getCurrentMembership } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

interface MatchesSearchParams {
  seasonId?: string
  squadId?: string
  competitionId?: string
  opponentTeamId?: string
  homeAway?: string
  when?: 'played' | 'upcoming'
}

export default async function MatchesPage({ searchParams }: { searchParams: Promise<MatchesSearchParams> }) {
  const filters = await searchParams
  const membership = await getCurrentMembership()
  if (!membership) return null

  const supabase = await createClient()

  const [{ data: squads }, { data: seasons }, { data: competitions }, { data: opponents }] = await Promise.all([
    supabase.from('squads').select('id, name').eq('org_id', membership.orgId).order('name'),
    supabase.from('seasons').select('id, name, is_current').eq('org_id', membership.orgId).order('start_date', { ascending: false }),
    supabase.from('competitions').select('id, name').eq('org_id', membership.orgId).order('name'),
    supabase.from('teams').select('id, name').eq('org_id', membership.orgId).eq('is_own_club', false).order('name'),
  ])

  const visibleSquadIds = membership.isOrgAdmin ? (squads ?? []).map((s) => s.id) : membership.squadIds
  const effectiveSeasonId = filters.seasonId ?? seasons?.find((s) => s.is_current)?.id

  let query = supabase
    .from('matches')
    .select('id, kickoff_at, home_away, status, our_score, opponent_score, matchday, squad:squad_id(name), competition:competition_id(name), opponent:opponent_team_id(name)')
    .in('squad_id', visibleSquadIds.length > 0 ? visibleSquadIds : ['00000000-0000-0000-0000-000000000000'])

  if (effectiveSeasonId) query = query.eq('season_id', effectiveSeasonId)
  if (filters.squadId) query = query.eq('squad_id', filters.squadId)
  if (filters.competitionId) query = query.eq('competition_id', filters.competitionId)
  if (filters.opponentTeamId) query = query.eq('opponent_team_id', filters.opponentTeamId)
  if (filters.homeAway === 'home' || filters.homeAway === 'away') query = query.eq('home_away', filters.homeAway)
  if (filters.when === 'played') query = query.eq('status', 'finished')
  if (filters.when === 'upcoming') query = query.in('status', ['scheduled', 'live'])

  const { data: matches } = await query.order('kickoff_at', { ascending: false })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Spiele</h1>
        <Link href="/matches/new" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          + Spiel anlegen
        </Link>
      </div>

      <form className="flex flex-wrap gap-2 text-sm">
        <select name="seasonId" defaultValue={effectiveSeasonId ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          {(seasons ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="squadId" defaultValue={filters.squadId ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          <option value="">Alle Mannschaften</option>
          {(squads ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="competitionId" defaultValue={filters.competitionId ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          <option value="">Alle Wettbewerbe</option>
          {(competitions ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="opponentTeamId" defaultValue={filters.opponentTeamId ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          <option value="">Alle Gegner</option>
          {(opponents ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select name="homeAway" defaultValue={filters.homeAway ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          <option value="">Heim/Auswärts</option>
          <option value="home">Heim</option>
          <option value="away">Auswärts</option>
        </select>
        <select name="when" defaultValue={filters.when ?? ''} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
          <option value="">Alle</option>
          <option value="played">Gespielt</option>
          <option value="upcoming">Kommend</option>
        </select>
        <button type="submit" className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">
          Filtern
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="px-4 py-3">Spieltag</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Mannschaft</th>
              <th className="px-4 py-3">Gegner</th>
              <th className="px-4 py-3">Wettbewerb</th>
              <th className="px-4 py-3">Ergebnis</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {(matches ?? []).map((m) => {
              const opponent = (m.opponent as unknown as { name: string } | null)?.name ?? 'Unbekannt'
              const squadName = (m.squad as unknown as { name: string } | null)?.name ?? ''
              const competitionName = (m.competition as unknown as { name: string } | null)?.name ?? '–'
              const result =
                m.our_score !== null && m.opponent_score !== null
                  ? m.home_away === 'home'
                    ? `${m.our_score}:${m.opponent_score}`
                    : `${m.opponent_score}:${m.our_score}`
                  : '–'
              return (
                <tr key={m.id} className="text-slate-200 hover:bg-slate-900/60">
                  <td className="px-4 py-3">{m.matchday ?? '–'}</td>
                  <td className="px-4 py-3">{new Date(m.kickoff_at).toLocaleDateString('de-DE')}</td>
                  <td className="px-4 py-3">{squadName}</td>
                  <td className="px-4 py-3">
                    <Link href={`/matches/${m.id}`} className="hover:underline">
                      {m.home_away === 'home' ? 'vs.' : 'bei'} {opponent}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{competitionName}</td>
                  <td className="px-4 py-3">{result}</td>
                  <td className="px-4 py-3 capitalize text-slate-400">{m.status}</td>
                </tr>
              )
            })}
            {(!matches || matches.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Keine Spiele gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
