import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { crestPath } from '@/lib/teams'
import { fmtWildi } from '@/components/WildiIcon'

export const revalidate = 60

const CURRENT_SEASON = '26/27'
const STARTING_BALANCE = 1000

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

  // Rank among all eligible profiles (ordered by balance desc)
  const { data: eligibleProfiles } = await supabase
    .from('profiles')
    .select('id, balance')
    .or('eligible_for_current_season.eq.true,is_admin.eq.true')
    .order('balance', { ascending: false })

  const ranked = eligibleProfiles ?? []
  const rankIdx = ranked.findIndex(p => p.id === id)
  const rank = rankIdx >= 0 ? rankIdx + 1 : null
  const totalRanked = ranked.length

  // Season bets
  const { data: betsRaw } = await supabase
    .from('bets')
    .select('id, status, combo_id, season')
    .eq('user_id', id)

  const bets = (betsRaw ?? []).filter(b => !b.season || b.season === CURRENT_SEASON)
  const singleBets = bets.filter(b => !b.combo_id)
  const comboIds = [...new Set(bets.filter(b => b.combo_id).map(b => b.combo_id as string))]

  const comboStatuses: { status: string }[] = []
  if (comboIds.length > 0) {
    const { data: cbData } = await supabase
      .from('combo_bets')
      .select('status, season')
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

  const { data: awardsRaw } = await supabase
    .from('user_awards')
    .select('award_type, award_title, award_icon, award_description, matchday, season, value_text')
    .eq('user_id', id)
    .order('matchday', { ascending: false })
  const awards = awardsRaw ?? []

  // Group awards by award_type
  const awardGroupMap = new Map<string, { icon: string; title: string; description: string; count: number; latestMatchday: number; latestSeason: string; latestValueText: string | null }>()
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
      })
    } else {
      existing.count++
    }
  }
  const groupedAwards = Array.from(awardGroupMap.entries()).map(([award_type, v]) => ({ award_type, ...v }))
  const awardTotalCount = awards.length
  const awardUniqueTypes = groupedAwards.length

  const profit = profile.balance - (profile.season_start_balance ?? STARTING_BALANCE)
  const initial = (profile.display_name || profile.username || '?')[0].toUpperCase()

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
            <h1 className="text-xl font-black truncate">{profile.display_name || profile.username}</h1>
            <p className="text-red-200 text-sm">@{profile.username}</p>
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
            {profile.balance.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Wildis'}
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
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Gewinn/Verlust</div>
          <div className={`text-lg font-black ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
            {profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Wildis
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
              <div key={a.award_type} className="relative bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                {a.count > 1 && (
                  <span className="absolute top-1.5 right-1.5 bg-red-600 text-white text-[10px] font-bold leading-none rounded-full px-1.5 py-0.5">
                    {a.count}×
                  </span>
                )}
                <span className="text-2xl flex-shrink-0">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs text-gray-900 dark:text-gray-100 leading-tight">{a.title}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{a.description}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    ST {a.latestMatchday} · {a.latestSeason}
                    {a.latestValueText && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">{a.latestValueText}</span>}
                  </div>
                </div>
              </div>
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
