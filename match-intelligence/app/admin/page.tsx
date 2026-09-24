import { PhaseNotice } from '@/components/PhaseNotice'

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Admin</h1>
      <PhaseNotice feature="Benutzer-, Mannschafts- und Datenquellenverwaltung" phase="Phase 2" />
    </div>
  )
}
