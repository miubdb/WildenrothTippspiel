import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentMembership } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeMatchDataQuality, type QualityFlag } from '@/lib/dataQuality'
import { PhaseNotice } from '@/components/PhaseNotice'
import { updateMatchResult } from '../actions'

const TABS = [
  { key: 'uebersicht', label: 'Übersicht' },
  { key: 'scouting', label: 'Gegner-Scouting' },
  { key: 'notizen', label: 'Notizen' },
  { key: 'video', label: 'Video' },
  { key: 'szenen', label: 'Szenen' },
  { key: 'analyse', label: 'Analyse' },
  { key: 'training', label: 'Training' },
  { key: 'report', label: 'Report' },
] as const

type TabKey = (typeof TABS)[number]['key']

const QUALITY_LABEL: Record<QualityFlag, string> = { complete: '✅', partial: '⚠️ teilweise', missing: '❌' }

export default async function MatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab: tabParam } = await searchParams
  const activeTab: TabKey = (TABS.find((t) => t.key === tabParam)?.key ?? 'uebersicht') as TabKey

  const membership = await getCurrentMembership()
  if (!membership) return null

  const supabase = await createClient()
  const { data: match } = await supabase
    .from('matches')
    .select(
      'id, squad_id, kickoff_at, home_away, status, our_score, opponent_score, matchday, manually_edited_fields, squad:squad_id(name), opponent:opponent_team_id(name), competition:competition_id(name)'
    )
    .eq('id', id)
    .maybeSingle()

  if (!match) notFound()

  const canEdit = membership.isOrgAdmin || membership.squadIds.includes(match.squad_id)
  const opponent = (match.opponent as unknown as { name: string } | null)?.name ?? 'Unbekannt'
  const squadName = (match.squad as unknown as { name: string } | null)?.name ?? ''
  const competitionName = (match.competition as unknown as { name: string } | null)?.name ?? null

  const { data: sourceImport } = await supabase
    .from('source_imports')
    .select('source_identifier, imported_at, last_synced_at, data_source:data_source_id(name, source_type)')
    .eq('entity_type', 'matches')
    .eq('entity_id', id)
    .maybeSingle()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">
          {match.home_away === 'home' ? squadName : opponent} vs. {match.home_away === 'home' ? opponent : squadName}
        </h1>
        <p className="text-sm text-slate-400">
          {squadName} · Spieltag {match.matchday ?? '–'} · {new Date(match.kickoff_at).toLocaleString('de-DE')}
          {competitionName ? ` · ${competitionName}` : ''} · {match.status}
        </p>
        {sourceImport && (
          <p className="mt-1 text-xs text-slate-600">
            Quelle: {(sourceImport.data_source as unknown as { name: string } | null)?.name ?? sourceImport.source_identifier} · zuletzt
            synchronisiert {sourceImport.last_synced_at ? new Date(sourceImport.last_synced_at).toLocaleString('de-DE') : '–'}
          </p>
        )}
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-slate-800 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/matches/${id}?tab=${t.key}`}
            className={`rounded-t-md px-3 py-2 ${
              activeTab === t.key ? 'border-b-2 border-emerald-500 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {activeTab === 'uebersicht' ? (
        <UebersichtTab matchId={id} match={match} canEdit={canEdit} squadName={squadName} />
      ) : (
        <PhaseNotice feature={TABS.find((t) => t.key === activeTab)!.label} phase={phaseFor(activeTab)} />
      )}
    </div>
  )
}

function phaseFor(tab: TabKey): string {
  if (tab === 'scouting') return 'Phase 3'
  if (tab === 'notizen' || tab === 'video' || tab === 'szenen') return 'Phase 4'
  if (tab === 'analyse') return 'Phase 5'
  return 'Phase 6' // training, report
}

async function UebersichtTab({
  matchId,
  match,
  canEdit,
  squadName,
}: {
  matchId: string
  match: { id: string; our_score: number | null; opponent_score: number | null; status: string; kickoff_at: string }
  canEdit: boolean
  squadName: string
}) {
  const supabase = await createClient()

  const { data: lineups } = await supabase.from('match_lineups').select('id, side, formation').eq('match_id', matchId)
  const lineupIds = (lineups ?? []).map((l) => l.id)

  const { data: lineupPlayers } = lineupIds.length
    ? await supabase
        .from('lineup_players')
        .select('id, lineup_id, player_id, raw_player_name, jersey_number, is_starting, is_captain, minutes_played, goals, assists, yellow_cards, red_card_minute, player:player_id(first_name, last_name)')
        .in('lineup_id', lineupIds)
    : { data: [] }

  const { count: eventCount } = await supabase.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', matchId)
  const { count: recordingCount } = await supabase.from('recordings').select('id', { count: 'exact', head: true }).eq('match_id', matchId)

  const ownLineup = lineups?.find((l) => l.side === 'own')
  const opponentLineup = lineups?.find((l) => l.side === 'opponent')
  const ownPlayers = (lineupPlayers ?? []).filter((p) => p.lineup_id === ownLineup?.id)
  const opponentPlayers = (lineupPlayers ?? []).filter((p) => p.lineup_id === opponentLineup?.id)

  const quality = computeMatchDataQuality({
    hasResult: match.our_score !== null && match.opponent_score !== null,
    matchEventCount: eventCount ?? 0,
    ownLineupCount: ownPlayers.length,
    opponentLineupCount: opponentPlayers.length,
    ownLineupIdentifiedCount: ownPlayers.filter((p) => p.player_id !== null).length,
    recordingCount: recordingCount ?? 0,
  })

  const boundUpdateResult = updateMatchResult.bind(null, matchId)

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Datenqualität</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm text-slate-300 sm:grid-cols-5">
          <li>Ergebnis {QUALITY_LABEL[quality.result]}</li>
          <li>Events {QUALITY_LABEL[quality.events]}</li>
          <li>Aufstellung {QUALITY_LABEL[quality.lineup]}</li>
          <li>Spielerzuordnung {QUALITY_LABEL[quality.playerIdentification]}</li>
          <li>Video {QUALITY_LABEL[quality.video]}</li>
        </ul>
      </section>

      {canEdit && (
        <details className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-300">Ergebnis / Status korrigieren</summary>
          <form action={boundUpdateResult} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-400">Tore eigene Mannschaft</label>
              <input name="ourScore" type="number" defaultValue={match.our_score ?? ''} className="mt-1 w-24 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Tore Gegner</label>
              <input name="opponentScore" type="number" defaultValue={match.opponent_score ?? ''} className="mt-1 w-24 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Status</label>
              <select name="status" defaultValue={match.status} className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                <option value="scheduled">scheduled</option>
                <option value="live">live</option>
                <option value="finished">finished</option>
                <option value="postponed">postponed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Anstoß</label>
              <input
                name="kickoffAt"
                type="datetime-local"
                defaultValue={new Date(match.kickoff_at).toISOString().slice(0, 16)}
                className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              Speichern
            </button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Geänderte Felder werden als manuell korrigiert markiert — ein späterer Tippspiel-Sync überschreibt sie nicht mehr
            automatisch, sondern zeigt einen Konflikt an.
          </p>
        </details>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <LineupCard title={squadName || 'Eigene Mannschaft'} formation={ownLineup?.formation ?? null} players={ownPlayers} />
        <LineupCard title="Gegner" formation={opponentLineup?.formation ?? null} players={opponentPlayers} />
      </div>
    </div>
  )
}

function LineupCard({
  title,
  formation,
  players,
}: {
  title: string
  formation: string | null
  players: {
    id: string
    is_starting: boolean | null
    is_captain: boolean
    jersey_number: number | null
    minutes_played: number | null
    goals: number
    assists: number
    yellow_cards: number
    red_card_minute: number | null
    raw_player_name: string | null
    player: unknown
  }[]
}) {
  const starters = players.filter((p) => p.is_starting === true)
  const bench = players.filter((p) => p.is_starting === false)
  const unknown = players.filter((p) => p.is_starting === null)

  function nameOf(p: (typeof players)[number]) {
    const linked = p.player as { first_name: string; last_name: string } | null
    if (linked) return `${linked.first_name} ${linked.last_name}`
    return p.raw_player_name ?? 'Unbekannt'
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">Formation: {formation ?? 'Formation unbekannt'}</p>

      {players.length === 0 ? (
        <p className="text-sm text-slate-500">Keine Aufstellung erfasst.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {starters.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">Startelf</p>
              <ul className="space-y-0.5 text-slate-300">
                {starters.map((p) => (
                  <li key={p.id}>
                    {p.jersey_number ? `#${p.jersey_number} ` : ''}
                    {nameOf(p)}
                    {p.is_captain ? ' (C)' : ''}
                    {p.goals > 0 ? ` · ${p.goals} Tor(e)` : ''}
                    {p.yellow_cards > 0 ? ' · Gelb' : ''}
                    {p.red_card_minute !== null ? ` · Rot (${p.red_card_minute}')` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bench.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">Bank</p>
              <ul className="space-y-0.5 text-slate-400">
                {bench.map((p) => (
                  <li key={p.id}>
                    {nameOf(p)}
                    {p.minutes_played ? ` · eingewechselt (${p.minutes_played}′ gespielt)` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unknown.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">Ohne Start/Bank-Angabe</p>
              <ul className="space-y-0.5 text-slate-500">
                {unknown.map((p) => (
                  <li key={p.id}>{nameOf(p)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
