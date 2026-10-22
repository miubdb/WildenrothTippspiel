import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Admin 3.0, Punkt 9: Änderungshistorie / Admin-Audit-Log. Schreibt ausschließlich über den
 * Service-Role-Client (wie jede andere Admin-Mutation in diesem Projekt) in `public.audit_log` —
 * siehe `supabase/admin3_audit_log.sql` für Tabelle + RLS (nur Admins dürfen lesen, nur
 * Service-Role darf schreiben; kein Pfad für `authenticated`).
 *
 * WICHTIG — Umgebungs-Hinweis: Diese Tabelle existiert noch NICHT in der Sandbox-Datenbank. Die
 * Migration liegt bereit (siehe oben), konnte in dieser Umgebung aber nicht ausgeführt werden
 * (kein schreibender Supabase-Zugriff verfügbar — nur ein rein lesendes MCP-Tool auf einem
 * anderen Projekt). Bis die Migration angewendet ist, schlägt jeder `logAdminAction`-Aufruf mit
 * "relation does not exist" fehl; das wird hier bewusst nur geloggt (console.error), NIE als
 * Fehler der eigentlichen Admin-Aktion nach außen gereicht — ein Audit-Log-Ausfall darf eine
 * sonst erfolgreiche Aktion (z. B. eine Guthabenänderung) nicht blockieren oder als
 * fehlgeschlagen melden. Nach Anwendung der Migration braucht es keinen Code-Wechsel: die
 * Inserts beginnen automatisch zu funktionieren.
 */

export type AuditAction =
  | 'balance_adjust' | 'user_eligibility_change' | 'user_role_change' | 'user_delete' | 'user_restore'
  | 'odds_override_set' | 'odds_override_reset' | 'betting_window_change' | 'topspiel_toggle'
  | 'settlement' | 'season_start_toggle' | 'season_reset' | 'survey_reset' | 'survey_mode_change'
  | 'survey_response_delete' | 'checklist_confirmation' | 'match_annulment' | 'match_official_score_confirmed'

export interface AuditLogEntry {
  actorId: string
  actorName: string
  action: AuditAction
  objectType: string
  objectId?: string | number | null
  oldValue?: unknown
  newValue?: unknown
  success?: boolean
  errorMessage?: string | null
}

/** Best-effort — wirft nie, damit ein Logging-Ausfall nie eine sonst erfolgreiche Admin-Aktion
 *  als fehlgeschlagen erscheinen lässt. Ruft man NACH der eigentlichen Mutation auf (erfolgreich
 *  oder nicht), niemals davor — die Zeile beschreibt, was tatsächlich passiert ist. */
export async function logAdminAction(entry: AuditLogEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('audit_log').insert({
      actor_id: entry.actorId,
      actor_name: entry.actorName,
      action: entry.action,
      object_type: entry.objectType,
      object_id: entry.objectId != null ? String(entry.objectId) : null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      success: entry.success ?? true,
      error_message: entry.errorMessage ?? null,
    })
    if (error) console.error('audit_log insert failed:', error.message, entry.action)
  } catch (e) {
    console.error('audit_log insert threw:', e, entry.action)
  }
}
