import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { SNAPSHOT_ENC } from '@/lib/recap/snapshot.enc'
import type { RecapBetRow, RecapComboRow, RecapMatchRow } from '@/lib/recap/slips'

/**
 * Verschlüsselter, pseudonymisierter Snapshot der echten Hinrunde (Stand siehe `builtAt`) für die Datenbank-freie
 * Vorschau. Das Repo ist öffentlich, daher liegt hier NUR Chiffretext (AES-256-GCM); ohne den Schlüssel (steckt nur im
 * Vorschau-Link, nie im Repo) ist nichts lesbar. Gebaut von scripts/build-recap-snapshot.mjs aus einem
 * schreibgeschützten Produktions-Export. Es gibt keinerlei Datenbankverbindung und keinen Schreibzugriff.
 */
export interface SnapshotData {
  version: number
  builtAt: string
  matches: RecapMatchRow[]
  bets: RecapBetRow[]
  combos: RecapComboRow[]
  profiles: { id: string; display_name: string | null; username: string | null; avatar_url: string | null; deleted_at: string | null }[]
  teams: { id: number; name: string }[]
  players: { id: number; name: string; squad?: string }[]
}

export function decryptSnapshot(keyHex: string | undefined | null): SnapshotData | null {
  // Sicherheitsnetz: In jeder Umgebung mit Datenbank-Konfiguration (Production, Preview des Hauptprojekts) wird NIE ein Snapshot
  // geladen – er ist nur für das separate, datenbankfreie Test-Deployment gedacht.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) return null
  try {
    const f = SNAPSHOT_ENC
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(f.iv, 'base64'))
    d.setAuthTag(Buffer.from(f.tag, 'base64'))
    const plain = Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()])
    return JSON.parse(zlib.gunzipSync(plain).toString('utf8')) as SnapshotData
  } catch {
    return null
  }
}
