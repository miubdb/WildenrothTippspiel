import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PhaseNotice } from '@/components/PhaseNotice'

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: match } = await supabase
    .from('matches')
    .select('id, kickoff_at, home_away, status, our_score, opponent_score, matchday, teams:opponent_team_id(name)')
    .eq('id', id)
    .maybeSingle()

  if (!match) notFound()

  const opponent = (match.teams as unknown as { name: string } | null)?.name ?? 'Unbekannt'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">
          {match.home_away === 'home' ? 'Wildenroth' : opponent} vs. {match.home_away === 'home' ? opponent : 'Wildenroth'}
        </h1>
        <p className="text-sm text-slate-400">
          Spieltag {match.matchday ?? '–'} · {new Date(match.kickoff_at).toLocaleString('de-DE')} · {match.status}
        </p>
      </div>

      <PhaseNotice feature="Match-Detailseite (Übersicht, Video, Szenen, Analyse, Training, Report)" phase="Phase 2–6" />
    </div>
  )
}
