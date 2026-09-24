import { PhaseNotice } from '@/components/PhaseNotice'

export default function ScoutingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Gegner-Scouting</h1>
      <PhaseNotice feature="Automatischer Gegner-Scouting-Bericht" phase="Phase 3" />
    </div>
  )
}
