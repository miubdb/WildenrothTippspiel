import { PhaseNotice } from '@/components/PhaseNotice'

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Berichte</h1>
      <PhaseNotice feature="Post-Match- und Scouting-Berichte inkl. PDF-Export" phase="Phase 6" />
    </div>
  )
}
