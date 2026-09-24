import Link from 'next/link'
import { getCurrentMembership } from '@/lib/auth'
import { resolveCurrentSquad } from '@/lib/squad'
import { createClient } from '@/lib/supabase/server'

function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

export default async function DashboardPage() {
  const membership = await getCurrentMembership()
  if (!membership) return null

  const squad = await resolveCurrentSquad(membership)
  const supabase = await createClient()

  if (!squad) {
    return (
      <DashboardCard title="Keine Mannschaft zugeordnet">
        <p className="text-slate-300">
          Für dieses Konto ist noch keine Mannschaft sichtbar. Ein Admin muss zunächst eine Squad-Mitgliedschaft anlegen.
        </p>
      </DashboardCard>
    )
  }

  const nowIso = new Date().toISOString()

  const [{ data: nextMatch }, { data: lastMatch }, { data: openScenes }, { data: recentNotes }] = await Promise.all([
    supabase
      .from('matches')
      .select('id, kickoff_at, home_away, opponent_team_id, matchday, teams:opponent_team_id(name)')
      .eq('squad_id', squad.id)
      .gte('kickoff_at', nowIso)
      .order('kickoff_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('matches')
      .select('id, kickoff_at, home_away, our_score, opponent_score, opponent_team_id, teams:opponent_team_id(name)')
      .eq('squad_id', squad.id)
      .eq('status', 'finished')
      .order('kickoff_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('scenes')
      .select('id, match_id, status, matches!inner(squad_id)')
      .eq('matches.squad_id', squad.id)
      .in('status', ['candidate', 'ai_observed', 'needs_review']),
    supabase
      .from('trainer_notes')
      .select('id, note_text, minute, created_at, matches!inner(squad_id)')
      .eq('matches.squad_id', squad.id)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{squad.name}</h1>
        <p className="text-sm text-slate-400">{squad.level ?? 'Saison-Dashboard'}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DashboardCard title="Nächstes Spiel">
          {nextMatch ? (
            <div>
              <p className="text-lg text-white">
                {nextMatch.home_away === 'home' ? 'vs.' : 'bei'}{' '}
                {(nextMatch.teams as unknown as { name: string } | null)?.name ?? 'Unbekannt'}
              </p>
              <p className="text-sm text-slate-400">{new Date(nextMatch.kickoff_at).toLocaleString('de-DE')}</p>
              <Link href={`/matches/${nextMatch.id}`} className="mt-3 inline-block text-sm text-emerald-400 hover:underline">
                Gegner-Scouting ansehen →
              </Link>
            </div>
          ) : (
            <p className="text-slate-400">Kein bevorstehendes Spiel geplant.</p>
          )}
        </DashboardCard>

        <DashboardCard title="Letztes Spiel">
          {lastMatch ? (
            <div>
              <p className="text-lg text-white">
                {lastMatch.home_away === 'home'
                  ? `${lastMatch.our_score ?? '–'}:${lastMatch.opponent_score ?? '–'}`
                  : `${lastMatch.opponent_score ?? '–'}:${lastMatch.our_score ?? '–'}`}{' '}
                {(lastMatch.teams as unknown as { name: string } | null)?.name ?? ''}
              </p>
              <Link href={`/matches/${lastMatch.id}`} className="mt-3 inline-block text-sm text-emerald-400 hover:underline">
                Post-Match-Analyse →
              </Link>
            </div>
          ) : (
            <p className="text-slate-400">Noch kein abgeschlossenes Spiel erfasst.</p>
          )}
        </DashboardCard>

        <DashboardCard title="Offene Review-Szenen">
          <p className="text-3xl font-semibold text-white">{openScenes?.length ?? 0}</p>
          <Link href="/scenes?filter=review" className="mt-2 inline-block text-sm text-emerald-400 hover:underline">
            Zur Szenen-Review →
          </Link>
        </DashboardCard>
      </div>

      <DashboardCard title="Letzte Trainer-Notizen">
        {recentNotes && recentNotes.length > 0 ? (
          <ul className="space-y-2">
            {recentNotes.map((note) => (
              <li key={note.id} className="text-sm text-slate-300">
                <span className="mr-2 font-mono text-slate-500">{note.minute}&apos;</span>
                {note.note_text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400">Noch keine Trainer-Notizen erfasst.</p>
        )}
      </DashboardCard>

      <p className="text-xs text-slate-600">
        Alle Trends und Kennzahlen zeigen standardmäßig nur trainerverifizierte Daten (trainer_verified /
        trainer_corrected). Ungeprüfte KI-Daten können pro Ansicht bewusst eingeblendet werden.
      </p>
    </div>
  )
}
