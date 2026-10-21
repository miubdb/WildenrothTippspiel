'use client'

import { useCallback, useEffect, useState } from 'react'
import { Btn, EmptyNote, LoadingBlock, Notice, Panel, selectCls } from '@/components/admin/ui'
import type { AuditAction } from '@/lib/auditLog'

/** Admin 3.0, Punkt 9: Mehr → System & Wartung → Änderungshistorie. Rein lesend
 *  (/api/admin/audit-log), Schreiben passiert ausschließlich serverseitig über
 *  lib/auditLog.ts an den jeweiligen Admin-Aktionen selbst. */

interface AuditEntry {
  id: number
  created_at: string
  actor_id: string
  actor_name: string
  action: AuditAction
  object_type: string
  object_id: string | null
  old_value: unknown
  new_value: unknown
  success: boolean
  error_message: string | null
}

const ACTION_LABEL: Record<AuditAction, string> = {
  balance_adjust: 'Guthaben geändert',
  user_eligibility_change: 'Freischaltung/Sperrung',
  user_role_change: 'Spielerrolle geändert',
  user_delete: 'Account gelöscht',
  user_restore: 'Account reaktiviert',
  odds_override_set: 'Quote überschrieben',
  odds_override_reset: 'Überschreibung zurückgesetzt',
  betting_window_change: 'Wettfreigabe geändert',
  topspiel_toggle: 'Topspiel-Auswahl',
  settlement: 'Spiel abgerechnet',
  season_start_toggle: 'Saisonstart-Flag',
  season_reset: 'Saison-Reset',
  survey_reset: 'Umfrage-Reset',
  survey_mode_change: 'Umfrage-Sichtbarkeit',
  survey_response_delete: 'Umfrageantwort gelöscht',
  checklist_confirmation: 'Spieltag-Cockpit bestätigt',
  match_annulment: 'Spiel annulliert (Nichtantritt)',
}

function fmt(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [migrationPending, setMigrationPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : ''
      const res = await fetch(`/api/admin/audit-log${qs}`)
      const json = await res.json()
      if (res.ok) {
        setEntries(json.entries)
        setMigrationPending(!!json.migrationPending)
      } else {
        setError(json.error ?? 'Laden fehlgeschlagen.')
      }
    } catch {
      setError('Netzwerkfehler.')
    } finally {
      setLoading(false)
    }
  }, [actionFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial + filter-change fetch, same pattern used throughout
    void load()
  }, [load])

  if (migrationPending) {
    return (
      <Notice tone="open">
        Die Tabelle <code>audit_log</code> existiert in dieser Umgebung noch nicht — die Migration
        (<code>supabase/admin3_audit_log.sql</code>) muss erst angewendet werden. Admin-Aktionen
        funktionieren schon jetzt normal; es wird nur noch nichts protokolliert.
      </Notice>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className={`flex-1 ${selectCls}`}>
          <option value="">Alle Aktionen</option>
          {Object.entries(ACTION_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <Btn size="sm" variant="secondary" onClick={load} disabled={loading}>{loading ? 'Lädt …' : 'Aktualisieren'}</Btn>
      </div>

      {error && <Notice tone="critical" action={<Btn size="sm" onClick={load}>Erneut laden</Btn>}>{error}</Notice>}
      {loading && !entries && <LoadingBlock label="Protokoll wird geladen …" />}
      {entries && entries.length === 0 && <EmptyNote>Noch keine protokollierten Aktionen{actionFilter ? ' für diesen Filter' : ''}.</EmptyNote>}

      {entries && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e) => (
            <Panel key={e.id} tone={e.success ? undefined : 'critical'} className="space-y-1 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[14px] font-semibold text-gray-900">{ACTION_LABEL[e.action] ?? e.action}</div>
                <div className="shrink-0 text-[12px] text-gray-500">
                  {new Date(e.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className="text-[13px] text-gray-600">
                {e.actor_name} · {e.object_type}{e.object_id ? ` #${e.object_id}` : ''}
                {!e.success && <span className="font-semibold text-red-700"> · fehlgeschlagen</span>}
              </div>
              {(e.old_value != null || e.new_value != null) && (
                <div className="text-[12px] text-gray-500">
                  {e.old_value != null && <>vorher: <span className="font-mono">{fmt(e.old_value)}</span>{' '}</>}
                  {e.new_value != null && <>→ neu: <span className="font-mono">{fmt(e.new_value)}</span></>}
                </div>
              )}
              {e.error_message && <div className="text-[12px] text-red-700">{e.error_message}</div>}
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
