import Image from 'next/image'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BetSlipProvider } from '@/context/BetSlipContext'
import { BottomNav } from '@/components/BottomNav'
import { PushSync } from '@/components/PushSync'
import { ScrollToTopOnNavigate } from '@/components/ScrollToTopOnNavigate'
import { WildiIcon, fmtWildi } from '@/components/WildiIcon'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, username, balance, is_admin')
    .eq('id', user.id)
    .single()

  if (profileError) {
    // A logged-in user always has a profiles row (checked at signup) — a
    // failed fetch here is a transient error (RLS hiccup, timeout), not a
    // real "no profile" state. Balance itself CAN legitimately be low or
    // even 0 through betting losses (only season_start_balance is floored
    // at 800, not the running balance) — so silently defaulting to 0 on a
    // fetch error is indistinguishable from a real low balance, which is
    // exactly the ambiguity that caused a "my Wildis are gone" report.
    // Showing an explicit placeholder instead of guessing a number avoids
    // that. Logging it server-side leaves a trail if this recurs.
    console.error('Failed to load profile for header balance:', user.id, profileError)
  }

  const displayName = profile?.display_name || profile?.username || 'Spieler'
  const balance = profile?.balance

  return (
    <BetSlipProvider>
      {/* h-dvh (a hard cap, not min-h-screen's minimum) plus main's min-h-0 below
          is required together for #app-main's overflow-y-auto to actually bound
          and scroll internally — a flex item defaults to min-height:auto, which
          lets it grow past its flex-1 share to fit long content (a long table
          page) regardless of the parent's height. Without both, that growth
          pushes this wrapper (and so the document) taller than the viewport, the
          window ends up as the real scroll container instead of #app-main, and
          BottomNav's position:fixed — anchored to the viewport — visually drifts
          with that window scroll on some mobile engines, sometimes only settling
          back down after a full reload. */}
      <div className="h-dvh bg-gray-50 dark:bg-gray-900 flex flex-col">
        {/* Top Header */}
        <header className="bg-gradient-to-r from-red-700 to-red-800 text-white sticky top-0 z-40 safe-top shadow-lg">
          <div className="flex items-center justify-between px-4 py-3 max-w-lg mx-auto">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center overflow-hidden shadow-sm flex-shrink-0">
                <Image src="/icon-192.png" alt="SpVgg Wildenroth" width={36} height={36} className="object-contain" />
              </div>
              <div>
                <span className="font-bold text-sm leading-tight block">Wildenroth</span>
                <span className="text-red-200 text-xs leading-tight">Tippspiel</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-black/15 rounded-full pl-3 pr-1.5 py-1">
              <span className="font-bold text-sm tabular-nums">{balance != null ? fmtWildi(balance) : '—'}</span>
              <WildiIcon size={22} />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main id="app-main" className="flex-1 min-h-0 overflow-y-auto pb-20 max-w-lg mx-auto w-full">
          {children}
        </main>

        <Suspense fallback={null}>
          <ScrollToTopOnNavigate />
        </Suspense>
        <PushSync />
        <BottomNav isAdmin={profile?.is_admin ?? false} />
      </div>
    </BetSlipProvider>
  )
}

