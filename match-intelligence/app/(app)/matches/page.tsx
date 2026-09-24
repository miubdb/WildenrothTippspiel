import Link from 'next/link'
import { getCurrentMembership } from '@/lib/auth'
import { resolveCurrentSquad } from '@/lib/squad'
import { createClient } from '@/lib/supabase/server'

export default async function MatchesPage() {
  const membership = await getCurrentMembership()
  if (!membership) return null
  const squad = await resolveCurrentSquad(membership)
  if (!squad) return <p className="text-slate-400">Keine Mannschaft zugeordnet.</p>

  const supabase = await createClient()
  const { data: matches } = await supabase
    .from('matches')
    .select('id, kickoff_at, home_away, status, our_score, opponent_score, matchday, teams:opponent_team_id(name)')
    .eq('squad_id', squad.id)
    .order('kickoff_at', { ascending: false })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-white">Spiele — {squad.name}</h1>
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="px-4 py-3">Spieltag</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Gegner</th>
              <th className="px-4 py-3">Ergebnis</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {(matches ?? []).map((m) => {
              const opponent = (m.teams as unknown as { name: string } | null)?.name ?? 'Unbekannt'
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
                  <td className="px-4 py-3">
                    <Link href={`/matches/${m.id}`} className="hover:underline">
                      {m.home_away === 'home' ? 'vs.' : 'bei'} {opponent}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{result}</td>
                  <td className="px-4 py-3 capitalize text-slate-400">{m.status}</td>
                </tr>
              )
            })}
            {(!matches || matches.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Noch keine Spiele erfasst.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
