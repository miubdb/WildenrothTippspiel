import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fmtWildi } from '@/components/WildiIcon'
import {
  computeUserBetStats,
  computeAllUsersBetStats,
  getUserSlipDetails,
  STATS_CURRENT_SEASON,
  MIN_SETTLED_FOR_STATS_CARD,
} from '@/lib/betStats'

export const revalidate = 30

const GLOBAL_METRICS = new Set([
  'trefferquote', 'bester-gewinn', 'avg-quote', 'hoechste-gewonnene-quote',
  'avg-gewinnquote', 'gewinnserie', 'verlustserie',
])
const PERSONAL_METRICS = new Set(['lieblingsmarkt', 'kombi-anteil', 'risky-bilanz', 'form'])

const METRIC_TITLE: Record<string, string> = {
  'trefferquote': 'Trefferquote — Rangliste',
  'bester-gewinn': 'Bester Gewinn — Rangliste',
  'avg-quote': 'Ø Quote — Rangliste',
  'hoechste-gewonnene-quote': 'Höchste gewonnene Quote — Rangliste',
  'avg-gewinnquote': 'Ø Gewinnquote — Rangliste',
  'gewinnserie': 'Längste Gewinnserie — Rangliste',
  'verlustserie': 'Längste Verlustserie — Rangliste',
  'lieblingsmarkt': 'Lieblingsmarkt',
  'kombi-anteil': 'Kombi-Anteil',
  'risky-bilanz': 'Risky-Bilanz',
  'form': 'Form der letzten Wetten',
}

function oddsFmt(o: number) {
  return `@${o.toFixed(2).replace('.', ',')}`
}

export default async function PlayerStatDetailPage({
  params,
}: {
  params: Promise<{ id: string; metric: string }>
}) {
  const { id, metric } = await params
  if (!GLOBAL_METRICS.has(metric) && !PERSONAL_METRICS.has(metric)) notFound()

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', id)
    .single()
  if (!profile) notFound()
  const playerName = profile.display_name || profile.username

  const title = METRIC_TITLE[metric] ?? metric

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <Link href={`/spieler/${id}`} className="text-xs font-semibold text-red-700 dark:text-red-400 hover:underline">
          ← Zurück zu {playerName}
        </Link>
        <h1 className="text-lg font-black text-gray-900 dark:text-gray-100 mt-1">{title}</h1>
      </div>

      {GLOBAL_METRICS.has(metric)
        ? await renderGlobalRanking(metric, id)
        : await renderPersonalDetail(metric, id, playerName)}
    </div>
  )
}

async function renderGlobalRanking(metric: string, highlightId: string) {
  const supabase = await createClient()
  const [{ data: eligibleProfiles }, allStats] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name')
      .or('eligible_for_current_season.eq.true,is_admin.eq.true')
      .is('deleted_at', null),
    computeAllUsersBetStats(supabase, STATS_CURRENT_SEASON),
  ])

  type Row = { id: string; name: string; primary: string; sub: string; sortVal: number }
  const rows: Row[] = []
  for (const p of eligibleProfiles ?? []) {
    const s = allStats.get(p.id)
    if (!s) continue
    const name = p.display_name || p.username
    if (metric === 'trefferquote') {
      if (s.settledCount < MIN_SETTLED_FOR_STATS_CARD || s.hitRate == null) continue
      rows.push({ id: p.id, name, primary: `${s.hitRate} %`, sub: `${s.won}/${s.settledCount} Wetten`, sortVal: s.hitRate * 100000 + s.settledCount })
    } else if (metric === 'bester-gewinn') {
      if (s.bestWinAmount == null) continue
      const d = s.bestWinDetail
      rows.push({ id: p.id, name, primary: `+${fmtWildi(s.bestWinAmount)} Wildis`, sub: d ? `${d.label} · ${oddsFmt(d.odds)} · Einsatz ${fmtWildi(d.stake)}` : '', sortVal: s.bestWinAmount })
    } else if (metric === 'avg-quote') {
      if (s.avgOdds == null) continue
      rows.push({ id: p.id, name, primary: oddsFmt(s.avgOdds), sub: 'abgeschlossene Scheine', sortVal: s.avgOdds })
    } else if (metric === 'hoechste-gewonnene-quote') {
      if (s.highestWonOdds == null) continue
      rows.push({ id: p.id, name, primary: oddsFmt(s.highestWonOdds), sub: 'bester Treffer', sortVal: s.highestWonOdds })
    } else if (metric === 'avg-gewinnquote') {
      if (s.avgWinningOdds == null) continue
      rows.push({ id: p.id, name, primary: oddsFmt(s.avgWinningOdds), sub: 'Ø Quote gewonnener Scheine', sortVal: s.avgWinningOdds })
    } else if (metric === 'gewinnserie') {
      if (s.longestWinStreak.length < 2) continue
      const ended = s.longestWinStreak.endedAt ? new Date(s.longestWinStreak.endedAt).toLocaleDateString('de-DE') : null
      rows.push({ id: p.id, name, primary: `${s.longestWinStreak.length}×`, sub: ended ? `zuletzt endete sie am ${ended}` : 'in Folge gewonnen', sortVal: s.longestWinStreak.length })
    } else if (metric === 'verlustserie') {
      if (s.longestLossStreak.length < 2) continue
      const ended = s.longestLossStreak.endedAt ? new Date(s.longestLossStreak.endedAt).toLocaleDateString('de-DE') : null
      rows.push({ id: p.id, name, primary: `${s.longestLossStreak.length}×`, sub: ended ? `zuletzt endete sie am ${ended}` : 'in Folge verloren', sortVal: s.longestLossStreak.length })
    }
  }
  rows.sort((a, b) => b.sortVal - a.sortVal)

  if (rows.length === 0) {
    return <EmptyState text="Noch keine ausreichende Datenbasis für diese Rangliste." />
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
      {rows.map((r, i) => (
        <Link
          key={r.id}
          href={`/spieler/${r.id}`}
          className={`flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors ${r.id === highlightId ? 'bg-red-50 dark:bg-red-900/10' : ''}`}
        >
          <span className="w-6 text-xs font-bold text-gray-400 dark:text-gray-500 flex-shrink-0">{i + 1}</span>
          <span className={`flex-1 min-w-0 truncate text-sm ${r.id === highlightId ? 'font-black text-red-700 dark:text-red-400' : 'font-semibold text-gray-800 dark:text-gray-200'}`}>{r.name}</span>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">{r.primary}</div>
            {r.sub && <div className="text-[10px] text-gray-400 dark:text-gray-500">{r.sub}</div>}
          </div>
        </Link>
      ))}
    </div>
  )
}

async function renderPersonalDetail(metric: string, id: string, playerName: string) {
  const supabase = await createClient()

  if (metric === 'lieblingsmarkt') {
    const stats = await computeUserBetStats(supabase, id, STATS_CURRENT_SEASON)
    if (stats.marketBreakdown.length === 0) return <EmptyState text={`${playerName} hat noch keine Tipps abgegeben.`} />
    const totalTicks = stats.marketBreakdown.reduce((a, m) => a + m.ticks, 0)
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
        {stats.marketBreakdown.map(m => (
          <div key={m.marketType} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{m.label}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{m.ticks}× · {Math.round((m.ticks / totalTicks) * 100)} %</span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {m.hitRate != null ? `${m.hitRate} % Trefferquote (${m.won}/${m.won + m.lost})` : `${m.pending} offen, noch keine Trefferquote`}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (metric === 'kombi-anteil') {
    const stats = await computeUserBetStats(supabase, id, STATS_CURRENT_SEASON)
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Einzelwetten" value={String(stats.totalSlips - stats.comboSlips)} />
          <MiniStat label="Kombiwetten" value={String(stats.comboSlips)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Kombi-Anteil" value={stats.comboRate != null ? `${stats.comboRate} %` : '–'} />
          <MiniStat label="Trefferquote Einzel / Kombi" value={`${stats.singleHitRate ?? '–'}% / ${stats.comboHitRate ?? '–'}%`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Ø Quote Einzel" value={stats.avgOddsSingle != null ? oddsFmt(stats.avgOddsSingle) : '–'} />
          <MiniStat label="Ø Gesamtquote Kombi" value={stats.avgOddsCombo != null ? oddsFmt(stats.avgOddsCombo) : '–'} />
        </div>
      </div>
    )
  }

  if (metric === 'risky-bilanz') {
    const [stats, slips] = await Promise.all([
      computeUserBetStats(supabase, id, STATS_CURRENT_SEASON),
      getUserSlipDetails(supabase, id, STATS_CURRENT_SEASON),
    ])
    const risky = slips.filter(s => s.isRisky).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const total = stats.riskyWon + stats.riskyLost
    return (
      <div className="space-y-3">
        {total > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Gesamtbilanz</span>
            <span className={`text-sm font-black ${stats.riskyWon > stats.riskyLost ? 'text-green-600' : 'text-red-600'}`}>
              {stats.riskyWon} S / {stats.riskyLost} N · {Math.round((stats.riskyWon / total) * 100)} %
            </span>
          </div>
        )}
        {risky.length === 0 ? (
          <EmptyState text={`${playerName} hat noch keine Risky-Wette platziert.`} />
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
            {risky.map((r, i) => (
              <SlipRow key={i} slip={r} />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (metric === 'form') {
    const slips = await getUserSlipDetails(supabase, id, STATS_CURRENT_SEASON)
    const settled = slips.filter(s => s.status !== 'pending').slice(-10).reverse()
    if (settled.length === 0) return <EmptyState text={`${playerName} hat noch keine abgeschlossene Wette.`} />
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
        {settled.map((r, i) => (
          <SlipRow key={i} slip={r} />
        ))}
      </div>
    )
  }

  return null
}

function SlipRow({ slip }: { slip: { matchday: number | null; label: string; odds: number; stake: number; status: string; net: number | null; isCombo: boolean } }) {
  const statusColor = slip.status === 'won' ? 'text-green-600' : slip.status === 'lost' ? 'text-red-600' : 'text-amber-600'
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
          {slip.matchday != null && <span className="text-gray-400 dark:text-gray-500 font-normal mr-1">ST {slip.matchday} ·</span>}
          {slip.label}
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500">{oddsFmt(slip.odds)} · Einsatz {fmtWildi(slip.stake)} Wildis</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`text-sm font-black ${statusColor}`}>
          {slip.status === 'pending' ? 'offen' : slip.status === 'won' ? `+${fmtWildi(slip.net ?? 0)}` : fmtWildi(slip.net ?? 0)}
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-3 py-2.5">
      <div className="text-[10px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-sm font-black text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 text-center text-sm text-gray-400 dark:text-gray-500">
      {text}
    </div>
  )
}
