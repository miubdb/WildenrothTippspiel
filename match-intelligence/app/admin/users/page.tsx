import { PhaseNotice } from '@/components/PhaseNotice'

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Benutzer</h1>
      <PhaseNotice feature="Benutzer- und Rollenverwaltung (memberships)" phase="Phase 2" />
    </div>
  )
}
