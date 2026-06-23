'use client'
// ShareCard: a visually rich card for sharing recap highlights
// Designed to be screenshotted and shared on WhatsApp
// Props: type ('mvp'|'risky'|'pechvogel'|'ranking'), data object
// No external dependencies — pure Tailwind.

function fmtAmt(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export type ShareCardData = {
  matchday?: number
  // mvp / risky / pechvogel
  name?: string
  value?: string
  subtitle?: string
  // ranking
  ranking?: { name: string; balance: number }[]
}

const META: Record<string, { emoji: string; title: string; accent: string }> = {
  mvp: { emoji: '🏆', title: 'Spieltags-König', accent: 'text-yellow-300' },
  risky: { emoji: '🎲', title: 'Risky-Hit', accent: 'text-amber-300' },
  pechvogel: { emoji: '💸', title: 'Pechvogel', accent: 'text-red-200' },
  ranking: { emoji: '📊', title: 'Top 5 Rangliste', accent: 'text-white' },
}

export function ShareCard({
  type,
  data,
}: {
  type: 'mvp' | 'risky' | 'pechvogel' | 'ranking'
  data: ShareCardData
}) {
  const meta = META[type]

  return (
    <div className="w-[320px] mx-auto rounded-3xl overflow-hidden shadow-2xl bg-white">
      {/* Red gradient header — SpVgg Wildenroth branding */}
      <div className="bg-gradient-to-br from-red-600 via-red-700 to-red-900 px-5 py-5 text-white">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-lg font-black">W</div>
          <div className="leading-tight">
            <div className="font-black text-sm tracking-wide">SpVgg Wildenroth</div>
            <div className="text-red-200 text-[10px] uppercase tracking-widest">Tippspiel</div>
          </div>
          {data.matchday != null && (
            <div className="ml-auto text-right">
              <div className="text-red-200 text-[9px] uppercase tracking-wide">Spieltag</div>
              <div className="font-black text-lg">{data.matchday}</div>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-3xl">{meta.emoji}</span>
          <span className="font-black text-xl">{meta.title}</span>
        </div>
      </div>

      {/* White content area */}
      <div className="px-5 py-6">
        {type === 'ranking' ? (
          <div className="space-y-2">
            {(data.ranking ?? []).slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-sm ${
                  i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>{i + 1}</div>
                <div className="flex-1 font-bold text-gray-900 truncate">{r.name}</div>
                <div className="font-black text-red-700">{fmtAmt(r.balance)} Wildis</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center">
            <div className="text-gray-400 text-xs uppercase tracking-wide">{type === 'pechvogel' ? 'Heute ohne Glück' : 'Spieler'}</div>
            <div className="font-black text-2xl text-gray-900 mt-1 truncate">{data.name ?? '—'}</div>
            <div className="font-black text-4xl text-red-700 mt-3">{data.value ?? ''}</div>
            {data.subtitle && <div className="text-sm text-gray-600 mt-2 font-medium leading-snug">{data.subtitle}</div>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-gray-50 px-5 py-2.5 text-center">
        <span className="text-[10px] text-gray-400 uppercase tracking-widest">Wildenroth Tippspiel</span>
      </div>
    </div>
  )
}
