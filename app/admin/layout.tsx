import Link from 'next/link'
import { AdminForceLight } from '@/components/AdminForceLight'
import { ConfirmProvider } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminForceLight />
      <div className="sticky top-0 z-50 bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center gap-3 safe-top">
        <Link
          href="/tipps"
          className="flex min-h-[40px] items-center gap-1.5 text-gray-300 hover:text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Zurück zur App
        </Link>
        <span className="text-gray-600 text-sm">|</span>
        <span className="text-gray-400 text-sm">Admin</span>
      </div>
      {/* ConfirmProvider muss ein ECHTER VORFAHRE von AdminPage sein, nicht von ihr selbst
          gerendert — sonst liest useConfirm() in AdminPages eigenem Komponentenkörper den
          Context-Default (async () => false) statt des echten Providers (genau dieser Bug
          wurde in der Review gefunden und hier behoben: Provider jetzt im Layout, eine Ebene
          über page.tsx, nicht mehr innerhalb von page.tsx' eigenem return). */}
      <ConfirmProvider>
        <div style={{ colorScheme: 'light' }}>{children}</div>
      </ConfirmProvider>
    </>
  )
}
