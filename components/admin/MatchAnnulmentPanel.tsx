'use client'

import { useState } from 'react'
import { Btn, Field, Notice, Pill, inputCls } from '@/components/admin/ui'

/**
 * "Spiel annullieren (Quote 1,00)" — Nichtantritt/Annullierung. Mounted inside
 * PostponedMatchCard (components/admin/ResultCards.tsx) for a match whose
 * status is 'postponed' and will never get a real kickoff/result.
 *
 * Flow: Grund eingeben → Vorschau laden (GET, rein lesend) → prüfen → erst
 * nach explizitem Klick auf "Jetzt annullieren" wird tatsächlich ausgeführt
 * (POST, über die atomare RPC neutralize_match — siehe supabase/match_annulment.sql).
 */

interface SinglePreview { betId: number; userId: string; userName: string; stake: number; oddsValue: number; refund: number; triggeredBy: 'match' | 'special' }
interface ComboPreview {
  comboId: number; userId: string; userName: string; stake: number; isRisky: boolean
  statusBefore: 'pending' | 'won' | 'lost' | 'void' | 'neutralized'
  oldTotalOdds: number; oldPossiblePayout: number
  action: 'untouched' | 'fully_neutralized' | 'now_won' | 'still_pending' | 'anomaly'
  newTotalOdds: number | null; newPossiblePayout: number | null; refund: number | null
}
interface Preview {
  matchLabel: string
  matchStatus: string
  alreadyAnnulled: boolean
  blocked?: string
  singles?: SinglePreview[]
  combos?: ComboPreview[]
  specials?: { id: number; matchday: number; title: string }[]
  counts?: { affectedSingles: number; affectedCombosTotal: number; openCombos: number; lostCombos: number; cancelledCombosUntouched: number; anomalies: number }
  totalRefund?: number
  anomalyNotes?: string[]
}

function fmt(n: number) { return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtOdds(n: number) { return n.toFixed(2).replace('.', ',') }

const ACTION_LABEL: Record<ComboPreview['action'], string> = {
  untouched: 'Unverändert (schon entschieden/storniert)',
  fully_neutralized: 'Komplett neutralisiert — voller Einsatz erstattet',
  now_won: 'Gewinnt NUR durch die Annullierung',
  still_pending: 'Bleibt offen — neue Gesamtquote',
  anomaly: '⚠️ Anomalie — bitte manuell prüfen',
}

export function MatchAnnulmentPanel({ matchId, onDone, onMessage }: {
  matchId: number
  onDone: () => void
  onMessage: (msg: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [reason, setReason] = useState('Nichtantritt der Gastmannschaft')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmArmed, setConfirmArmed] = useState(false)

  async function loadPreview() {
    setLoadingPreview(true)
    setPreview(null)
    setConfirmArmed(false)
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/annul`)
      const data = await res.json()
      if (!res.ok) { onMessage(`Fehler: ${data.error}`); return }
      setPreview(data)
    } finally {
      setLoadingPreview(false)
    }
  }

  async function execute() {
    if (!reason.trim()) { onMessage('Bitte einen Grund angeben.'); return }
    setExecuting(true)
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/annul`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json()
      if (!res.ok) { onMessage(`Fehler: ${data.error}`); return }
      onMessage(
        data.alreadyAnnulled
          ? 'Spiel war bereits annulliert — keine Änderungen vorgenommen.'
          : `Spiel annulliert: ${data.affectedSingles} Einzelwette(n), ${data.affectedComboLegs} Kombi-Legs betroffen, ${fmt(data.refundTotal)} Wildis erstattet/ausgezahlt${data.specialsVoided > 0 ? `, ${data.specialsVoided} Spieltag-Special(s) storniert` : ''}${data.anomalies > 0 ? ` — ⚠️ ${data.anomalies} Anomalie(n), bitte Audit-Log prüfen` : ''}.`
      )
      setExpanded(false)
      setPreview(null)
      setConfirmArmed(false)
      onDone()
    } finally {
      setExecuting(false)
    }
  }

  if (!expanded) {
    return (
      <Btn variant="danger" size="sm" onClick={() => setExpanded(true)}>
        Spiel annullieren (Nichtantritt)
      </Btn>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-dashed border-red-300 p-3">
      <div className="flex items-center justify-between">
        <Pill tone="critical">Annullierung — Quote 1,00</Pill>
        <button type="button" className="text-[13px] font-semibold text-gray-500" onClick={() => { setExpanded(false); setPreview(null); setConfirmArmed(false) }}>
          Abbrechen
        </button>
      </div>

      <Notice tone="critical">
        Neutralisiert jede noch offene Auswahl auf diesem Spiel (Quote 1,00, Einsatz erstattet).
        Bereits gewonnene/verlorene Kombi-Legs bleiben unverändert; bereits stornierte Scheine werden nicht angefasst.
        Diese Aktion ist final — das Spiel kann danach nie mehr normal abgerechnet werden.
      </Notice>

      <Field label="Grund (für die Admin-Dokumentation, nicht der Spieler-Hinweistext)">
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
      </Field>

      <Btn variant="secondary" size="sm" loading={loadingPreview} onClick={loadPreview}>
        Vorschau laden
      </Btn>

      {preview && preview.alreadyAnnulled && (
        <Notice tone="info">Dieses Spiel ist bereits annulliert — keine weitere Aktion nötig.</Notice>
      )}
      {preview && preview.blocked === 'MATCH_ALREADY_FINISHED' && (
        <Notice tone="critical">Dieses Spiel wurde bereits normal abgerechnet (Ergebnis eingetragen) — eine Annullierung ist nicht mehr möglich.</Notice>
      )}

      {preview && !preview.alreadyAnnulled && !preview.blocked && preview.counts && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">Einzelwetten</div><div className="text-lg font-bold">{preview.counts.affectedSingles}</div></div>
            <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">Offene Kombis</div><div className="text-lg font-bold">{preview.counts.openCombos}</div></div>
            <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">Bereits verloren</div><div className="text-lg font-bold">{preview.counts.lostCombos}</div></div>
            <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">Bereits storniert</div><div className="text-lg font-bold">{preview.counts.cancelledCombosUntouched}</div></div>
          </div>

          {preview.counts.anomalies > 0 && (
            <Notice tone="critical">
              ⚠️ {preview.counts.anomalies} Anomalie(n) gefunden — manuell prüfen, bevor fortgefahren wird:
              <ul className="mt-1 list-disc pl-5">
                {(preview.anomalyNotes ?? []).map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </Notice>
          )}

          {preview.specials && preview.specials.length > 0 && (
            <Notice tone="info">
              {preview.specials.length} Spieltag-Special(s) enthalten dieses Spiel und werden mit-storniert: {preview.specials.map((s) => s.title).join(', ')}
            </Notice>
          )}

          {preview.combos && preview.combos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-1 pr-2">Kombi</th>
                    <th className="py-1 pr-2">Spieler</th>
                    <th className="py-1 pr-2">Einsatz</th>
                    <th className="py-1 pr-2">Alte Quote</th>
                    <th className="py-1 pr-2">Neue Quote</th>
                    <th className="py-1 pr-2">Alter mögl. Payout</th>
                    <th className="py-1 pr-2">Neuer mögl. Payout</th>
                    <th className="py-1 pr-2">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.combos.map((c) => (
                    <tr key={c.comboId} className="border-t border-gray-100">
                      <td className="py-1 pr-2 font-mono">#{c.comboId}</td>
                      <td className="py-1 pr-2">{c.userName}{c.isRisky ? ' 🎲' : ''}</td>
                      <td className="py-1 pr-2">{fmt(c.stake)}</td>
                      <td className="py-1 pr-2">@{fmtOdds(c.oldTotalOdds)}</td>
                      <td className="py-1 pr-2">{c.newTotalOdds != null ? `@${fmtOdds(c.newTotalOdds)}` : '—'}</td>
                      <td className="py-1 pr-2">{fmt(c.oldPossiblePayout)}</td>
                      <td className="py-1 pr-2 font-semibold">{c.newPossiblePayout != null ? fmt(c.newPossiblePayout) : '—'}</td>
                      <td className="py-1 pr-2">{ACTION_LABEL[c.action]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.singles && preview.singles.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-1 pr-2">Einzelwette</th>
                    <th className="py-1 pr-2">Spieler</th>
                    <th className="py-1 pr-2">Einsatz</th>
                    <th className="py-1 pr-2">Quote</th>
                    <th className="py-1 pr-2">Erstattung</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.singles.map((s) => (
                    <tr key={s.betId} className="border-t border-gray-100">
                      <td className="py-1 pr-2 font-mono">#{s.betId}</td>
                      <td className="py-1 pr-2">{s.userName}</td>
                      <td className="py-1 pr-2">{fmt(s.stake)}</td>
                      <td className="py-1 pr-2">@{fmtOdds(s.oddsValue)}</td>
                      <td className="py-1 pr-2 font-semibold">{fmt(s.refund)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Notice tone="open">Gesamt-Erstattung/-Auszahlung: <b>{fmt(preview.totalRefund ?? 0)} Wildis</b></Notice>

          {!confirmArmed ? (
            <Btn variant="danger" block onClick={() => setConfirmArmed(true)}>
              Weiter zur Bestätigung
            </Btn>
          ) : (
            <div className="space-y-2 rounded-lg bg-red-50 p-3">
              <p className="text-[13px] font-semibold text-red-900">
                Sicher? Diese Aktion kann nicht rückgängig gemacht werden — das Spiel gilt danach final als annulliert.
              </p>
              <Btn variant="danger" block loading={executing} onClick={execute}>
                Jetzt annullieren — {preview.counts.affectedSingles} Einzelwette(n), {preview.counts.openCombos} offene Kombi(s)
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
