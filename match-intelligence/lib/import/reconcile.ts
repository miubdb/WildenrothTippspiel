/**
 * Pure reconciliation logic for provider imports (spec: idempotent sync,
 * "manuelle Korrektur wird nicht still überschrieben", conflicts surfaced
 * rather than silently resolved). No Supabase calls in here — the sync route
 * (app/api/admin/data-sources/tippspiel-sync) does the reading/writing and
 * calls these functions to decide what to write, which keeps the actual
 * decision logic unit-testable without a database.
 */

export interface FieldConflict {
  field: string
  currentValue: unknown
  incomingValue: unknown
}

export interface ReconcileResult {
  /** Fields safe to write (not manually edited, and different from the current value). */
  patch: Record<string, unknown>
  /** Fields that differ but are locked by a prior manual edit — never applied automatically. */
  conflicts: FieldConflict[]
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  // Timestamps: compare as instants, not string formatting, since Postgres
  // and the provider may render the same instant differently.
  if (looksLikeTimestamp(a) && looksLikeTimestamp(b)) {
    return new Date(a as string).getTime() === new Date(b as string).getTime()
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

function looksLikeTimestamp(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v))
}

/**
 * Compares an incoming field map against the current row. A field already
 * present in `manuallyEditedFields` is never included in the patch, even if
 * it differs — it becomes a conflict entry instead, so the caller can record
 * it (data_conflicts) rather than silently overwrite a human's correction.
 */
export function reconcileFields(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  manuallyEditedFields: readonly string[]
): ReconcileResult {
  const locked = new Set(manuallyEditedFields)
  const patch: Record<string, unknown> = {}
  const conflicts: FieldConflict[] = []

  for (const [field, incomingValue] of Object.entries(incoming)) {
    const currentValue = current[field]
    if (valuesEqual(currentValue, incomingValue)) continue

    if (locked.has(field)) {
      conflicts.push({ field, currentValue, incomingValue })
      continue
    }
    patch[field] = incomingValue
  }

  return { patch, conflicts }
}

export type SyncAction = 'create' | 'update' | 'unchanged'

/** Whether this sync should create a new row, update an existing one, or leave it alone. */
export function determineSyncAction(existed: boolean, patch: Record<string, unknown>): SyncAction {
  if (!existed) return 'create'
  return Object.keys(patch).length > 0 ? 'update' : 'unchanged'
}
