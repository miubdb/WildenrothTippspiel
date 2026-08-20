import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { crestPath } from '@/lib/teams'
import { fmtWildi } from '@/components/WildiIcon'

export const revalidate = 60

const CURRENT_SEASON = '26/27'

export default async function SpielerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, display_name, balance, avatar_url, bio, favorite_team, created_at, season_start_balance, eligible_for_current_season, is_admin')
    .eq('id', id)
    .single()

  if (!profile) notFound()

  // Pending stakes across ALL matches (not just settled ones) so that
  // balance + pending = the same "true" ranking value /leaderboard shows —
  // reducing a balance the moment a bet is placed would otherwise leak that
  // bet's size to anyone viewing this profile before kickoff (see
  // leaderboard/page.tsx, which this mirrors exactly to keep both pages
  // agreeing on both the displayed figure and the rank).
  const pendingStakesPerUser: Record<string, number> = {}
  {
    const adminSupa = createAdminClient()
    const { data: pendingBetRows } = await adminSupa
      .from('bets')
      .select('user_id, stake, combo_id')
      .eq('status', 'pending')
    const seenComboIds = new Set<number>()
    for (const b of pendingBetRows ?? []) {
      if (!b.combo_id) {
        pendingStakesPerUser[b.user_id] = (pendingStakesPerUser[b.user_id] ?? 0) + (b.stake ?? 0)
      } else {
        seenComboIds.add(Number(b.combo_id))
      }
    }
    if (seenComboIds.size > 0) {
      const { data: comboPendingRows } = await adminSupa
        .from('combo_bets')
        .select('user_id, stake')
        .in('id', [...seenComboIds])
      for (const c of comboPendingRows ?? []) {
        pendingStakesPerUser[c.user_id] = (pendingStakesPerUser[c.user_id] ?? 0) + c.stake
      }
    }
  }
  const displayBalance = profile.balance + (pendingStakesPerUser[profile.id] ?? 0)

  // Rank among all eligible profiles — same ranking value and tiebreak as
  // /leaderboard, so the two pages never disagree about someone's rank.
  const { data: eligibleProfiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, balance')
    .or('eligible_for_current_season.eq.true,is_admin.eq.true')

  const ranked = [...(eligibleProfiles ?? [])].sort((a, b) => {
    const balA = a.balance + (pendingStakesPerUser[a.id] ?? 0)
    const balB = b.balance + (pendingStakesPerUser[b.id] ?? 0)
    if (balB !== balA) return balB - balA
    return (a.display_name || a.username).localeCompare(b.display_name || b.username, 'de')
  })
  const rankIdx = ranked.findIndex(p => p.id === id)
  const rank = rankIdx >= 0 ? rankIdx + 1 : null
  const totalRanked = ranked.length

  // Season bets
  const { data: betsRaw } = await supabase
    .from('bets')
    .select('id, status, combo_id, season, stake, payout')
    .eq('user_id', id)

  const bets = (betsRaw ?? []).filter(b => !b.season || b.season === CURRENT_SEASON)
  const singleBets = bets.filter(b => !b.combo_id)
  const comboIds = [...new Set(bets.filter(b => b.combo_id).map(b => b.combo_id as string))]

  const comboStatuses: { status: string; stake: number; payout: number | null }[] = []
  if (comboIds.length > 0) {
    const { data: cbData } = await supabase
      .from('combo_bets')
      .select('status, season, stake, payout')
      .in('id', comboIds)
    for (const cb of (cbData ?? []).filter(c => !c.season || c.season === CURRENT_SEASON)) {
      comboStatuses.push(cb)
    }
  }

  const totalBets = singleBets.length + comboStatuses.length
  const wonBets = singleBets.filter(b => b.status === 'won').length +
    comboStatuses.filter(c => c.status === 'won').length
  const lostBets = singleBets.filter(b => b.status === 'lost').length +
    comboStatuses.filter(c => c.status === 'lost').length

  // Wettbilanz = actual betting profit/loss from settled bets only — kept
  // separate from balance-vs-start-balance, which also includes weekly pocket
  // money and any inactivity penalties (see profil/page.tsx for the same split).
  const totalStaked = singleBets.reduce((acc, b) => acc + (b.stake ?? 0), 0) +
    comboStatuses.reduce((acc, cb) => acc + (cb.stake ?? 0), 0)
  const totalPayout = singleBets.filter(b => b.status === 'won').reduce((acc, b) => acc + (b.payout ?? 0), 0) +
    comboStatuses.filter(cb => cb.status === 'won').reduce((acc, cb) => acc + (cb.payout ?? 0), 0)
  const wettbilanz = totalPayout - totalStaked

  const { data: awardsRaw } = await supabase
    .from('user_awards')
    .select('award_type, award_title, award_icon, award_description, matchday, season, value_text')
    .eq('user_id', id)
    // Season first — see the identical fix/comment in app/(app)/profil/page.tsx.
    .order('season', { ascending: false })
    .order('matchday', { ascending: false })
  const awards = awardsRaw ?? []

  // Group awards by award_type
  const awardGroupMap = new Map<string, { icon: string; title: string; description: string; count: number; latestMatchday: number; latestSeason: string; latestValueText: string | null; instances: { matchday: number; season: string; valueText: string | null }[] }>()
  for (const a of awards) {
    const existing = awardGroupMap.get(a.award_type)
    if (!existing) {
      awardGroupMap.set(a.award_type, {
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
  const groupedAwards = Array.from(awardGroupMap.entries()).map(([award_type, v]) => ({ award_type, ...v }))
  const awardTotalCount = awards.length
  const awardUniqueTypes = groupedAwards.length

  const initial = (profile.display_name || '?')[0].toUpperCase()

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Profile Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt="Avatar"
              className="w-16 h-16 rounded-full object-cover flex-shrink-0 border-2 border-white/40"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center flex-shrink-0">
              <span className="text-red-700 font-black text-2xl">{initial}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black truncate">{profile.display_name}</h1>
          </div>
        </div>
        {profile.bio && <p className="text-sm text-red-100 mt-3 italic">{profile.bio}</p>}
        <div className="flex items-center gap-3 mt-3 text-xs text-red-200">
          {profile.favorite_team && (
            <span className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={crestPath(profile.favorite_team)} alt="" className="w-4 h-4 object-contain" />
              {profile.favorite_team}
            </span>
          )}
          <span>
            Mitglied seit {new Date(profile.created_at).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* Balance / Rank / Profit */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Guthaben</div>
          <div className="text-lg font-black text-gray-900 dark:text-gray-100">
            {displayBalance.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Wildis'}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Rang</div>
          <div className="text-lg font-black text-gray-900 dark:text-gray-100">
            {rank ? `${rank}.` : '—'}
            {rank && <span className="text-xs text-gray-400 font-normal"> / {totalRanked}</span>}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Wettbilanz</div>
          <div className={`text-lg font-black ${wettbilanz > 0 ? 'text-green-600' : wettbilanz < 0 ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
            {wettbilanz >= 0 ? '+' : ''}{wettbilanz.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Wildis
          </div>
        </div>
      </div>

      {/* Bet stats */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Statistiken <span className="text-xs font-normal text-gray-400">{CURRENT_SEASON}</span></h2>
        </div>
        <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700">
          <StatCell label="Wetten" value={totalBets} />
          <StatCell label="Gewonnen" value={wonBets} color="text-green-600" />
          <StatCell label="Verloren" value={lostBets} color="text-red-600" />
        </div>
      </div>

      {/* Pokalschrank */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700 flex items-center gap-2">
          <span className="text-lg">🏆</span>
          <div>
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Pokalschrank</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {fmtWildi(awardTotalCount)} Auszeichnung{awardTotalCount !== 1 ? 'en' : ''} · {fmtWildi(awardUniqueTypes)} verschiedene
            </p>
          </div>
        </div>
        {groupedAwards.length === 0 ? (
          <div className="px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">Noch keine Auszeichnungen</div>
        ) : (
          <div className="p-3 grid grid-cols-2 gap-2">
            {groupedAwards.map((a) => (
              <details key={a.award_type} className="relative bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl px-3 py-2.5 [&_summary::-webkit-details-marker]:hidden">
                {a.count > 1 && (
                  <span className="absolute top-1.5 right-1.5 bg-red-600 text-white text-[10px] font-bold leading-none rounded-full px-1.5 py-0.5">
                    {a.count}×
                  </span>
                )}
                <summary className="flex items-center gap-2.5 cursor-pointer list-none">
                  <span className="text-2xl flex-shrink-0">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xs text-gray-900 dark:text-gray-100 leading-tight">{a.title}</div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{a.description}</div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                      Spieltag {a.latestMatchday} · {a.latestSeason}
                      {a.latestValueText && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">{a.latestValueText}</span>}
                    </div>
                  </div>
                </summary>
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
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCell({ label, value, color = 'text-gray-900 dark:text-gray-100' }: { label: string; value: number; color?: string }) {
  return (
    <div className="px-2 py-4 text-center">
      <div className={`text-xl font-black ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
