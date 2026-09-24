import { PhaseNotice } from '@/components/PhaseNotice'

export default function AdminDataSourcesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Datenquellen</h1>
      <PhaseNotice feature="Datenquellen- und Veo-Verbindungsverwaltung" phase="Phase 2/4" />
    </div>
  )
}
