import Image from 'next/image'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BetSlipProvider } from '@/context/BetSlipContext'
import { BottomNav } from '@/components/BottomNav'

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username, balance')
    .eq('id', user.id)
    .single()

  const displayName = profile?.display_name || profile?.username || 'Spieler'
  const balance = profile?.balance ?? 0

  return (
    <BetSlipProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
        {/* Top Header */}
        <header className="bg-red-700 text-white sticky top-0 z-40 safe-top shadow-lg">
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
            <div className="text-right">
              <span className="text-red-200 text-xs block">Guthaben</span>
              <span className="font-bold text-sm">
                {balance.toLocaleString('de-DE', {
                  style: 'currency',
                  currency: 'EUR',
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pb-20 max-w-lg mx-auto w-full">
          {children}
        </main>

        <BottomNav />
      </div>
    </BetSlipProvider>
  )
}

