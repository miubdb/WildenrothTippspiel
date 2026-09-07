import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TeamLogo } from '@/components/TeamLogo'
import { computeLeaguePlayerLeaderboard, type LeaguePlayerMetric, type LeaguePlayerEntry } from '@/lib/leagueStats'

export const revalidate = 60

const TABS: { key: LeaguePlayerMetric; label: string; emoji: string; unit: string; morePlural: string }[] = [
  { key: 'goals', label: 'Torschützen', emoji: '⚽', unit: 'Tore', morePlural: 'Torschützen' },
  { key: 'assists', label: 'Vorlagen', emoji: '🎯', unit: 'Vorlagen', morePlural: 'Spieler mit mindestens einer Vorlage' },
  { key: 'scorer', label: 'Scorer', emoji: '🌟', unit: 'Punkte', morePlural: 'Spieler mit Scorerpunkten' },
  { key: 'appearances', label: 'Einsätze', emoji: '👕', unit: 'Sp.', morePlural: 'Spieler mit mindestens einem Einsatz' },
  { key: 'minutes', label: 'Minuten', emoji: '⏱', unit: 'Min.', morePlural: 'Spieler mit Einsatzminuten' },
  { key: 'yellow_cards', label: 'Gelbe Karten', emoji: '🟨', unit: 'Gelb', morePlural: 'Spieler mit Gelber Karte' },
  { key: 'red_cards', label: 'Rote Karten', emoji: '🟥', unit: 'Rot', morePlural: 'Spieler mit Roter Karte' },
]

const DEFAULT_LIMIT = 15

function PlayerRow({ e, i, unit }: { e: LeaguePlayerEntry; i: number; unit: string }) {
  return (
    <div className="flex items-center px-4 py-2.5 gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
        i === 0 ? 'bg-yellow-400 text-white' : i === 1 ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200' : i === 2 ? 'bg-amber-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
      }`}>
        {i + 1}
      </div>
      <TeamLogo name={e.teamName} size="sm" className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex items-center gap-1">
          {e.playerName}
          {e.isUncertain && <span title="Abgekürzt erfasst, Zuordnung unsicher" className="text-xs">❓</span>}
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{e.teamName}</div>
      </div>
      <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{e.value}</div>
      <div className="text-xs text-gray-400 dark:text-gray-500 w-10 text-right">{unit}</div>
    </div>
  )
}

export default async function LigaStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; all?: string }>
}) {
  const { tab, all: showAllParam } = await searchParams
  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0]
  const showAll = showAllParam === '1'

  const supabase = await createClient()
  const { entries, all } = await computeLeaguePlayerLeaderboard(supabase, activeTab.key, DEFAULT_LIMIT)
  const remaining = all.length - entries.length

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">Saison 26/27</div>
        <div className="text-2xl font-black mt-0.5">Liga-Stats</div>
        <div className="text-red-200 text-sm mt-1">Kreisliga Gruppe 2 · aus den erfassten Spielberichten</div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/liga-stats?tab=${t.key}`}
            className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              t.key === activeTab.key
                ? 'bg-red-700 text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
            }`}
          >
            {t.emoji} {t.label}
          </Link>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">{activeTab.emoji} {activeTab.label}</h2>
          {activeTab.key === 'assists' && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Vorlagen basieren auf den bei FuPa erfassten Spielberichten. TSV Altenstadt erfasst dort aktuell keine Vorlagen.
            </p>
          )}
        </div>
        {all.length > 0 ? (
          <>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {(showAll ? all : entries).map((e, i) => (
                <PlayerRow key={`${e.teamName}::${e.playerName}`} e={e} i={i} unit={activeTab.unit} />
              ))}
            </div>
            {!showAll && remaining > 0 && (
              <Link
                href={`/liga-stats?tab=${activeTab.key}&all=1`}
                className="block px-4 py-3 text-center text-xs font-semibold text-red-700 dark:text-red-400 border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                Weitere {remaining} {activeTab.morePlural} — alle anzeigen
              </Link>
            )}
            {showAll && remaining > 0 && (
              <Link
                href={`/liga-stats?tab=${activeTab.key}`}
                className="block px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                Weniger anzeigen
              </Link>
            )}
          </>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Noch keine Daten für diese Kategorie.</div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 px-1">
        Basis: erfasste Spielberichte der Kreisliga Gruppe 2, Saison 26/27.
      </p>
    </div>
  )
}
