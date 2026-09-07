import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PushSubscribeButton } from '@/components/PushSubscribeButton'
import { ProfileEditForm } from '@/components/ProfileEditForm'
import { BetHistoryWithCancel } from '@/components/BetHistoryWithCancel'
import { ThemeToggle } from '@/components/ThemeToggle'
import { DeleteAccountButton } from '@/components/DeleteAccountButton'
import { fmtWildi, WildiIcon } from '@/components/WildiIcon'
import { AvatarLightbox } from '@/components/AvatarLightbox'
import { PlayerBetSummary, PlayerRealizedBalance, PlayerStatsTiles, BalanceHistoryChart } from '@/components/PlayerBetStatsCard'
import { computeUserBetStats, computeBalanceHistory, STATS_CURRENT_SEASON, STATS_PREV_SEASON } from '@/lib/betStats'

export const revalidate = 60

export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>
}) {
  const { highlight } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const CURRENT_SEASON = STATS_CURRENT_SEASON
  const PREV_SEASON = STATS_PREV_SEASON

  const { data: awardsRaw } = await supabase
    .from('user_awards')
    .select('award_type, award_title, award_icon, award_description, matchday, season, value, value_text')
    .eq('user_id', user.id)
    // Season first, then matchday — matchday numbers reset every season, so
    // ordering by matchday alone can rank a higher-numbered Spieltag from a
    // PRIOR season ahead of a lower-numbered one from the current season,
    // making the Pokalschrank's "latest" badge season-wrong. Season strings
    // sort correctly lexically ("25/26" < "26/27").
    .order('season', { ascending: false })
    .order('matchday', { ascending: false })
  const awards = awardsRaw ?? []

  const { data: betsRaw } = await supabase
    .from('bets')
    .select(
      `id, market_type, selection, stake, odds_value, status, payout, created_at, combo_id, season, is_risky,
       match:matches(id, matchday, match_date, home_score, away_score, status,
         home_team:teams!matches_home_team_id_fkey(name, short_name),
         away_team:teams!matches_away_team_id_fkey(name, short_name)
       )`
    )
    .eq('user_id', user.id)
    .neq('status', 'void')
    .order('created_at', { ascending: false })
    .limit(120)

  const allBets = (betsRaw ?? []).map(b => ({
    ...b,
    match: (() => {
      const m = Array.isArray(b.match) ? b.match[0] : b.match
      if (!m) return null
      return {
        ...m,
        home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
        away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
      }
    })(),
  }))

  // Split by season: current = '26/27' (or unknown) + TEST, prev = '25/26'
  const bets = allBets.filter(b => !b.season || b.season === CURRENT_SEASON || b.season === 'TEST')
  const prevBets = allBets.filter(b => b.season === PREV_SEASON)

  // Fetch combo_bets metadata — current season
  const comboIds = [...new Set(bets.filter(b => b.combo_id).map(b => b.combo_id as string))]
  const comboBetsMap = new Map<string, { id: string; stake: number; total_odds: number; status: string; payout: number | null }>()
  if (comboIds.length > 0) {
    const { data: cbData } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout')
      .in('id', comboIds)
    for (const cb of cbData ?? []) comboBetsMap.set(cb.id, cb)
  }

  // Fetch combo_bets metadata — previous season
  const prevComboIds = [...new Set(prevBets.filter(b => b.combo_id).map(b => b.combo_id as string))]
  const prevComboBetsMap = new Map<string, { id: string; stake: number; total_odds: number; status: string; payout: number | null }>()
  if (prevComboIds.length > 0) {
    const { data: pcbData } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout')
      .in('id', prevComboIds)
    for (const cb of pcbData ?? []) prevComboBetsMap.set(cb.id, cb)
  }

  // Wildenroth roster for goalscorer bet labels
  const { data: rosterRows } = await supabase
    .from('wildenroth_players')
    .select('id, name')
  const playerNameMap: Record<number, string> = Object.fromEntries((rosterRows ?? []).map(r => [r.id, r.name]))

  // Determine per-matchday deadline for cancel eligibility
  const betMatchdays = [...new Set(bets.filter(b => b.match?.matchday).map(b => b.match!.matchday))]
  const matchdayDeadlinesPassed: Record<number, boolean> = {}
  if (betMatchdays.length > 0) {
    const { data: scheduledFirst } = await supabase
      .from('matches')
      .select('matchday, match_date')
      .eq('status', 'scheduled')
      .in('matchday', betMatchdays)
      .order('match_date', { ascending: true })
    const firstByMd = new Map<number, string>()
    for (const m of scheduledFirst ?? []) {
      if (!firstByMd.has(m.matchday)) firstByMd.set(m.matchday, m.match_date)
    }
    for (const md of betMatchdays) {
      const firstDate = firstByMd.get(md)
      matchdayDeadlinesPassed[md] = !firstDate || new Date(firstDate) <= new Date()
    }
  }

  // Build ordered display items (singles in order; combos inserted at position of their first leg)
  type SingleItem = { kind: 'single'; bet: typeof bets[0] }
  type ComboItem = { kind: 'combo'; comboId: string; legs: typeof bets[0][]; cb: typeof comboBetsMap extends Map<string, infer V> ? V : never | undefined }
  type HistoryItem = SingleItem | ComboItem

  const seenCombos = new Set<string>()
  const historyItems: HistoryItem[] = []
  for (const bet of bets) {
    if (!bet.combo_id) {
      historyItems.push({ kind: 'single', bet })
    } else if (!seenCombos.has(bet.combo_id)) {
      seenCombos.add(bet.combo_id)
      const legs = bets.filter(b => b.combo_id === bet.combo_id)
      historyItems.push({ kind: 'combo', comboId: bet.combo_id, legs, cb: comboBetsMap.get(bet.combo_id) as never })
    }
  }

  // Zentrale Statistik-Schicht (lib/betStats.ts) — einzige Quelle für
  // Wett-Kennzahlen, dieselbe Funktion wie auf einem fremden Spielerprofil.
  const stats = await computeUserBetStats(supabase, user.id, CURRENT_SEASON)
  // "Wettbilanz" = realisierte Bilanz aus abgeschlossenen Wettscheinen — NICHT
  // dasselbe wie balance-vs-start, das auch Taschengeld/Strafen enthält.
  const wettbilanz = stats.realizedNet
  const profit = profile.balance - (profile.season_start_balance ?? 1000)
  const sonstigeBuchungen = profit - wettbilanz

  const balancePoints = await computeBalanceHistory(supabase, user.id, profile.balance, profile.season_start_balance ?? 1000, CURRENT_SEASON)

  // Previous season quick stats (singles + combos)
  const prevSingleBets = prevBets.filter(b => !b.combo_id)
  const prevSingleWon = prevSingleBets.filter(b => b.status === 'won').length
  const prevSingleLost = prevSingleBets.filter(b => b.status === 'lost').length
  const prevComboWon = [...prevComboBetsMap.values()].filter(cb => cb.status === 'won').length
  const prevComboLost = [...prevComboBetsMap.values()].filter(cb => cb.status === 'lost').length
  const prevWon = prevSingleWon + prevComboWon
  const prevLost = prevSingleLost + prevComboLost
  const prevTotalBets = prevSingleBets.length + prevComboBetsMap.size
  const prevStaked = prevSingleBets.reduce((acc, b) => acc + (b.stake ?? 0), 0)
    + [...prevComboBetsMap.values()].reduce((acc, cb) => acc + cb.stake, 0)
  const prevPayout = prevSingleBets.filter(b => b.status === 'won').reduce((acc, b) => acc + (b.payout ?? 0), 0)
    + [...prevComboBetsMap.values()].filter(cb => cb.status === 'won').reduce((acc, cb) => acc + (cb.payout ?? 0), 0)
  const prevProfit = prevPayout - prevStaked

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Profile Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <AvatarLightbox
            avatarUrl={profile.avatar_url}
            initial={(profile.display_name || '?')[0].toUpperCase()}
            size={64}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black truncate">
              {profile.display_name}
            </h1>
            <p className="text-red-200 text-xs mt-0.5">{user.email}</p>
          </div>
        </div>
        {profile.bio && (
          <p className="text-sm text-red-100 mt-3 italic">{profile.bio}</p>
        )}
        <div className="flex items-center gap-3 mt-3 text-xs text-red-200">
          {profile.favorite_team && (
            <span>Lieblingsverein: {profile.favorite_team}</span>
          )}
          <span>
            Mitglied seit {new Date(profile.created_at).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Guthaben <span className="text-[10px]">26/27</span></div>
          <div className="text-xl font-black text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
            {fmtWildi(profile.balance)} Wildis <WildiIcon size={20} />
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Aktueller Kontostand</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Wettbilanz <span className="text-[10px]">26/27</span></div>
          <div className={`text-xl font-black ${wettbilanz > 0 ? 'text-green-600' : wettbilanz < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {wettbilanz >= 0 ? '+' : ''}{fmtWildi(wettbilanz) + ' Wildis'}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Netto-Gewinn/-Verlust nur aus abgeschlossenen Wetten</div>
        </div>
      </div>

      {sonstigeBuchungen !== 0 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 px-1 -mt-2">
          Taschengeld &amp; Sonstiges (nicht Teil der Wettbilanz): {sonstigeBuchungen >= 0 ? '+' : ''}{fmtWildi(sonstigeBuchungen)} Wildis
        </div>
      )}

      <PlayerBetSummary stats={stats} isOwnProfile={true} />
      <PlayerRealizedBalance stats={stats} isOwnProfile={true} />
      <PlayerStatsTiles stats={stats} />

      {/* Balance Chart */}
      {balancePoints.length >= 2 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-gray-100">Guthaben-Verlauf</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Startguthaben bis heute</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${wettbilanz >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {wettbilanz >= 0 ? '+' : ''}{fmtWildi(wettbilanz)} Wildis Wettbilanz
            </span>
          </div>
          <div className="px-4 py-3">
            <BalanceHistoryChart points={balancePoints} currentLabel="Aktuell" />
          </div>
        </div>
      )}

      {/* Pokalschrank */}
      {(() => {
        // Group awards by award_type
        const groupMap = new Map<string, { icon: string; title: string; description: string; count: number; latestMatchday: number; latestSeason: string; latestValueText: string | null; instances: { matchday: number; season: string; valueText: string | null }[] }>()
        for (const a of awards) {
          const existing = groupMap.get(a.award_type)
          if (!existing) {
            groupMap.set(a.award_type, {
              icon: a.award_icon,
              title: a.award_title,
              description: a.award_description,
              count: 1,
              latestMatchday: a.matchday,
              latestSeason: a.season,
              latestValueText: a.value_text ?? null,
              instances: [{ matchday: a.matchday, season: a.season, valueText: a.value_text ?? null }],
            })
          } else {
            existing.count++
            existing.instances.push({ matchday: a.matchday, season: a.season, valueText: a.value_text ?? null })
          }
        }
        const grouped = Array.from(groupMap.entries()).map(([award_type, v]) => ({ award_type, ...v }))
        const totalCount = awards.length
        const uniqueTypes = grouped.length
        return (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700 flex items-center gap-2">
              <span className="text-lg">🏆</span>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-gray-100">Pokalschrank</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {fmtWildi(totalCount)} Auszeichnung{totalCount !== 1 ? 'en' : ''} · {fmtWildi(uniqueTypes)} {uniqueTypes !== 1 ? 'Arten' : 'Art'}
                </p>
              </div>
            </div>
            {grouped.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-3xl mb-2">🎯</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Noch keine Awards — kämpf um deinen ersten!</div>
              </div>
            ) : (
              <div className="p-3 grid grid-cols-2 gap-2">
                {grouped.map((a) => (
                  <div key={a.award_type} className="relative bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl px-3 py-2.5">
                    {a.count > 1 && (
                      <span className="absolute top-1.5 right-1.5 bg-red-600 text-white text-[10px] font-bold leading-none rounded-full px-1.5 py-0.5">
                        {a.count}×
                      </span>
                    )}
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl flex-shrink-0">{a.icon}</span>
                      <div className={`flex-1 min-w-0 ${a.count > 1 ? 'pr-7' : ''}`}>
                        <div className="font-bold text-xs text-gray-900 dark:text-gray-100 leading-tight">{a.title}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{a.description}</div>
                        {a.count === 1 && (
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                            Spieltag {a.latestMatchday} · {a.latestSeason}
                            {a.latestValueText && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">{a.latestValueText}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    {a.count > 1 && (
                      <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800/50 space-y-1">
                        {a.instances.map((inst, i) => (
                          <div key={i} className="text-[10px] text-gray-500 dark:text-gray-400 flex justify-between">
                            <span>Spieltag {inst.matchday} · {inst.season}</span>
                            {inst.valueText && <span className="font-semibold text-amber-700 dark:text-amber-400">{inst.valueText}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* Theme Toggle */}
      <ThemeToggle />

      {/* Push Notifications */}
      <PushSubscribeButton />

      {/* Bet History */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Wetthistorie</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Letzte {historyItems.length} Einträge</p>
        </div>

        {historyItems.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-sm">Noch keine Wetten platziert</div>
          </div>
        ) : (
          <BetHistoryWithCancel items={historyItems as never} matchdayDeadlinesPassed={matchdayDeadlinesPassed} playerNameMap={playerNameMap} highlightDedupeKey={highlight} />
        )}
      </div>

      {/* Profile Edit */}
      <ProfileEditForm
        userId={user.id}
        displayName={profile.display_name}
        email={user.email ?? ''}
        avatarUrl={profile.avatar_url ?? null}
        bio={profile.bio ?? null}
        favoriteTeam={profile.favorite_team ?? null}
      />

      {/* Previous season summary — at the bottom, collapsed by default */}
      {prevBets.length > 0 && (
        <details className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-gray-600 dark:text-gray-300 list-none flex items-center justify-between">
            <span>Letzte Saison 25/26</span>
            <span className="text-xs text-gray-400">{prevTotalBets} Wetten ▼</span>
          </summary>
          <div className="px-4 pb-4 pt-1 grid grid-cols-2 gap-3">
            <div className="bg-white dark:bg-gray-700 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Gewonnen / Verloren</div>
              <div className="font-black text-sm text-gray-800 dark:text-gray-100">{prevWon}W / {prevLost}V</div>
            </div>
            <div className="bg-white dark:bg-gray-700 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Ergebnis 25/26</div>
              <div className={`font-black text-sm ${prevProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {prevProfit >= 0 ? '+' : ''}{fmtWildi(prevProfit) + ' Wildis'}
              </div>
            </div>
            <div className="col-span-2 bg-white dark:bg-gray-700 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Eingesetzt / Ausgezahlt</div>
              <div className="font-bold text-sm text-gray-800 dark:text-gray-100">
                {fmtWildi(prevStaked) + ' Wildis'} / {fmtWildi(prevPayout) + ' Wildis'}
              </div>
            </div>
          </div>
        </details>
      )}

      <SignOutButton />
      <DeleteAccountButton />
    </div>
  )
}

function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="POST">
      <button
        type="submit"
        className="w-full py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl transition-colors text-sm"
      >
        Abmelden
      </button>
    </form>
  )
}
