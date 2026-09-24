import { PhaseNotice } from '@/components/PhaseNotice'

export default function AdminSquadsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Mannschaften</h1>
      <PhaseNotice feature="Mannschafts-, Kader- und Saisonverwaltung" phase="Phase 2" />
    </div>
  )
}
