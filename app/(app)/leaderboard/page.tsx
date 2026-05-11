import { createClient } from '@/lib/supabase/server'

export const revalidate = 120

export default async function LeaderboardPage() {
  const supabase = await createClient()

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, balance')
    .order('balance', { ascending: false })

  const { data: { user } } = await supabase.auth.getUser()

  const STARTING_BALANCE = 1000

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm mb-4">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide mb-1">
          Saison 2024/25
        </div>
        <h1 className="text-2xl font-black">Rangliste</h1>
        <p className="text-red-200 text-sm mt-1">
          {profiles?.length ?? 0} Teilnehmer · Startkapital 1.000€
        </p>
      </div>

      {/* Top 3 Podium */}
      {profiles && profiles.length >= 3 && (
        <div className="flex items-end justify-center gap-3 mb-5 px-2">
          {/* 2nd place */}
          <PodiumCard
            rank={2}
            profile={profiles[1]}
            isCurrentUser={profiles[1].id === user?.id}
            startingBalance={STARTING_BALANCE}
            height="h-24"
          />
          {/* 1st place */}
          <PodiumCard
            rank={1}
            profile={profiles[0]}
            isCurrentUser={profiles[0].id === user?.id}
            startingBalance={STARTING_BALANCE}
            height="h-32"
            featured
          />
          {/* 3rd place */}
          <PodiumCard
            rank={3}
            profile={profiles[2]}
            isCurrentUser={profiles[2].id === user?.id}
            startingBalance={STARTING_BALANCE}
            height="h-20"
          />
        </div>
      )}

      {/* Full Leaderboard */}
      <div className="space-y-2">
        {(profiles ?? []).map((profile, idx) => {
          const rank = idx + 1
          const profit = profile.balance - STARTING_BALANCE
          const isMe = profile.id === user?.id
          const isTop3 = rank <= 3

          return (
            <div
              key={profile.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                isMe
                  ? 'bg-red-50 border-red-200 shadow-sm'
                  : 'bg-white border-gray-100 hover:border-gray-200'
              }`}
            >
              {/* Rank */}
              <div className="w-8 flex-shrink-0 text-center">
                {isTop3 ? (
                  <span className="text-lg">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span>
                ) : (
                  <span className="text-sm font-bold text-gray-400">{rank}</span>
                )}
              </div>

              {/* Avatar */}
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${
                  isMe ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {(profile.display_name || profile.username || '?')[0].toUpperCase()}
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 truncate text-sm">
                  {profile.display_name || profile.username}
                  {isMe && (
                    <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">
                      Du
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400">@{profile.username}</div>
              </div>

              {/* Balance & Profit */}
              <div className="text-right flex-shrink-0">
                <div className="font-bold text-gray-900 text-sm">
                  {profile.balance.toLocaleString('de-DE', {
                    style: 'currency',
                    currency: 'EUR',
                    minimumFractionDigits: 2,
                  })}
                </div>
                <div
                  className={`text-xs font-medium ${
                    profit > 0
                      ? 'text-green-600'
                      : profit < 0
                      ? 'text-red-600'
                      : 'text-gray-400'
                  }`}
                >
                  {profit >= 0 ? '+' : ''}
                  {profit.toLocaleString('de-DE', {
                    style: 'currency',
                    currency: 'EUR',
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {(!profiles || profiles.length === 0) && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🏆</div>
          <div className="font-medium">Noch keine Teilnehmer</div>
        </div>
      )}
    </div>
  )
}

function PodiumCard({
  rank,
  profile,
  isCurrentUser,
  startingBalance,
  height,
  featured = false,
}: {
  rank: number
  profile: { id: string; username: string; display_name: string; balance: number }
  isCurrentUser: boolean
  startingBalance: number
  height: string
  featured?: boolean
}) {
  const profit = profile.balance - startingBalance
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'

  return (
    <div className={`flex-1 flex flex-col items-center`}>
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg mb-2 ${
          isCurrentUser ? 'bg-red-700 text-white ring-2 ring-red-300' : 'bg-gray-200 text-gray-700'
        } ${featured ? 'w-14 h-14 text-xl' : ''}`}
      >
        {(profile.display_name || profile.username || '?')[0].toUpperCase()}
      </div>
      <div className="text-center mb-1">
        <div className="text-xs font-semibold text-gray-800 truncate max-w-20">
          {profile.display_name || profile.username}
        </div>
        <div
          className={`text-xs font-medium ${
            profit >= 0 ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {profit >= 0 ? '+' : ''}
          {profit.toFixed(0)}€
        </div>
      </div>
      <div
        className={`${height} w-full rounded-t-xl flex items-end justify-center pb-2 ${
          rank === 1
            ? 'bg-yellow-100 border-2 border-yellow-300'
            : rank === 2
            ? 'bg-gray-100 border-2 border-gray-300'
            : 'bg-orange-50 border-2 border-orange-200'
        }`}
      >
        <span className="text-2xl">{medal}</span>
      </div>
    </div>
  )
}
