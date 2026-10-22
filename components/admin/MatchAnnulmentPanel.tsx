'use client'

import { useState, useEffect } from 'react'
import { Btn, Field, Notice, Pill, inputCls } from '@/components/admin/ui'
import { ANNULMENT_TYPE_LABELS, suggestedOfficialScore, type AnnulmentType } from '@/lib/matchAnnulment'

/**
 * "Spiel annullieren (Quote 1,00)" — Nichtantritt/Annullierung. Mounted inside
 * PostponedMatchCard (components/admin/ResultCards.tsx) for a match whose
 * status is 'postponed' and will never get a real kickoff/result.
 *
 * Flow: strukturierte Auswahl (nie vorausgewählt) + Grund eingeben → Vorschau
 * laden (GET, rein lesend) → prüfen → erst nach explizitem Klick auf "Jetzt
 * annullieren" wird tatsächlich ausgeführt (POST, über die atomare RPC
 * neutralize_match — siehe supabase/match_annulment_official_score.sql).
 *
 * Die offizielle BFV-Wertung ist ein komplett SEPARATER, später nachtragbarer
 * Schritt (OfficialScoreForm unten, auch von AnnulledMatchCard verwendet) —
 * sie betrifft ausschließlich die Fußballtabelle, nie Wettscheine/Guthaben
 * (siehe docs/spielannullierung-regelwerk.md).
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
  annulmentType?: AnnulmentType | null
  officialHomeScore?: number | null
  officialAwayScore?: number | null
  officialConfirmedAt?: string | null
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

/**
 * Offizielle, vom BFV bestätigte Wertung — komplett getrennt von der Wettneutralisierung
 * (siehe Modulkommentar). Rührt ausschließlich `matches` an, nie bets/combo_bets — kann
 * beliebig oft aufgerufen werden (auch zum Zurücknehmen einer fehlerhaften Eingabe), ohne
 * je einen Wettschein erneut zu bearbeiten.
 */
export function OfficialScoreForm({
  matchId, annulmentType, initialHome, initialAway, confirmedAt, onSaved, onMessage,
}: {
  matchId: number
  annulmentType: AnnulmentType | null | undefined
  initialHome: number | null | undefined
  initialAway: number | null | undefined
  confirmedAt: string | null | undefined
  onSaved: () => void
  onMessage: (msg: string | null) => void
}) {
  const suggestion = annulmentType && annulmentType !== 'other' ? suggestedOfficialScore(annulmentType) : null
  const [home, setHome] = useState(initialHome != null ? String(initialHome) : (suggestion ? String(suggestion.home) : ''))
  const [away, setAway] = useState(initialAway != null ? String(initialAway) : (suggestion ? String(suggestion.away) : ''))
  const [saving, setSaving] = useState(false)
  const isConfirmed = confirmedAt != null

  async function save(clear: boolean) {
    const homeScore = clear ? null : parseInt(home, 10)
    const awayScore = clear ? null : parseInt(away, 10)
    if (!clear && (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || (homeScore as number) < 0 || (awayScore as number) < 0)) {
      onMessage('Bitte ein gültiges Ergebnis angeben (z.B. 2 und 0).')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/official-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeScore, awayScore }),
      })
      const data = await res.json()
      if (!res.ok) { onMessage(`Fehler: ${data.error}`); return }
      onMessage(clear ? 'Offizielle Wertung zurückgenommen.' : `Offizielle Wertung bestätigt: ${homeScore}:${awayScore} (Wertung) — zählt ab jetzt in der Tabelle.`)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-gray-700">Offizielle BFV-Wertung (nur für die Tabelle)</span>
        {isConfirmed ? <Pill tone="success">Bestätigt</Pill> : <Pill tone="neutral">Ausstehend</Pill>}
      </div>
      <Notice tone="info">
        Betrifft ausschließlich die Fußballtabelle/Teamstatistiken — niemals Wettscheine, Guthaben, das
        Quotenmodell oder Torschützenstatistiken. Erst eintragen, wenn die BFV-Entscheidung tatsächlich
        feststeht; solange sie aussteht, leer lassen.
      </Notice>
      {suggestion && !isConfirmed && (
        <p className="text-[12px] text-gray-500">
          Vorschlag gemäß § 29 BFV-Spielordnung 2026: <b>{suggestion.home}:{suggestion.away}</b> — wird NICHT automatisch übernommen.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tore Heim">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, '').slice(0, 2))} className={inputCls} />
        </Field>
        <Field label="Tore Gast">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, '').slice(0, 2))} className={inputCls} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Btn variant="primary" size="sm" loading={saving} disabled={!home || !away} onClick={() => save(false)}>
          {isConfirmed ? 'Korrigieren' : 'Amtlich bestätigen'}
        </Btn>
        {isConfirmed && (
          <Btn variant="secondary" size="sm" loading={saving} onClick={() => save(true)}>
            Zurücknehmen
          </Btn>
        )}
      </div>
    </div>
  )
}

export function MatchAnnulmentPanel({ matchId, onDone, onMessage, autoLoad = false }: {
  matchId: number
  onDone: () => void
  onMessage: (msg: string | null) => void
  /** true für ein Spiel, das schon status='annulled' ist (siehe AnnulledMatchCard,
   *  components/admin/ResultCards.tsx) — lädt die Vorschau sofort statt erst nach Klick auf
   *  den "Spiel annullieren"-Button, der für ein bereits annulliertes Spiel keinen Sinn mehr
   *  ergäbe. */
  autoLoad?: boolean
}) {
  const [expanded, setExpanded] = useState(autoLoad)
  const [reason, setReason] = useState('')
  const [annulmentType, setAnnulmentType] = useState<AnnulmentType | ''>('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmArmed, setConfirmArmed] = useState(false)

  useEffect(() => {
    if (autoLoad) void loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!annulmentType) { onMessage('Bitte bewusst auswählen: Nichtantritt Gastmannschaft, Nichtantritt Heimmannschaft oder Anderer Grund.'); return }
    setExecuting(true)
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/annul`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, annulmentType }),
      })
      const data = await res.json()
      if (!res.ok) { onMessage(`Fehler: ${data.error}`); return }
      onMessage(
        data.alreadyAnnulled
          ? 'Spiel war bereits annulliert — keine Änderungen vorgenommen.'
          : `Spiel annulliert: ${data.affectedSingles} Einzelwette(n), ${data.affectedComboLegs} Kombi-Legs betroffen, ${fmt(data.refundTotal)} Wildis erstattet (reine Refunds — etwaige Payouts aus Kombis, die nur durch die Annullierung gewinnen, sind hier NICHT mitgezählt)${data.specialsVoided > 0 ? `, ${data.specialsVoided} Spieltag-Special(s) storniert` : ''}${data.anomalies > 0 ? ` — ⚠️ ${data.anomalies} Anomalie(n), bitte Audit-Log prüfen` : ''}.`
      )
      setConfirmArmed(false)
      await loadPreview() // zeigt jetzt den "bereits annulliert"-Zustand inkl. offizieller Wertung
      onDone()
    } finally {
      setExecuting(false)
    }
  }

  if (!expanded && !preview) {
    return (
      <Btn variant="danger" size="sm" onClick={() => { setExpanded(true); loadPreview() }}>
        Spiel annullieren (Nichtantritt)
      </Btn>
    )
  }

  if (loadingPreview && !preview) {
    return <Btn variant="danger" size="sm" loading>Spiel annullieren (Nichtantritt)</Btn>
  }

  // Spiel ist bereits annulliert — zeigt den strukturierten Grund + die offizielle Wertung,
  // kein erneuter Annullierungs-Dialog mehr nötig/möglich.
  if (preview?.alreadyAnnulled) {
    return (
      <div className="space-y-3 rounded-xl border-2 border-dashed border-gray-300 p-3">
        <div className="flex items-center justify-between">
          <Pill tone="neutral">Annulliert{preview.annulmentType ? ` — ${ANNULMENT_TYPE_LABELS[preview.annulmentType]}` : ''}</Pill>
        </div>
        <OfficialScoreForm
          matchId={matchId}
          annulmentType={preview.annulmentType}
          initialHome={preview.officialHomeScore}
          initialAway={preview.officialAwayScore}
          confirmedAt={preview.officialConfirmedAt}
          onSaved={() => { loadPreview(); onDone() }}
          onMessage={onMessage}
        />
      </div>
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

      {preview?.blocked === 'MATCH_ALREADY_FINISHED' ? (
        <Notice tone="critical">Dieses Spiel wurde bereits normal abgerechnet (Ergebnis eingetragen) — eine Annullierung ist nicht mehr möglich.</Notice>
      ) : (
        <>
          <Notice tone="critical">
            Neutralisiert jede noch offene Auswahl auf diesem Spiel (Quote 1,00, Einsatz erstattet).
            Bereits gewonnene/verlorene Kombi-Legs bleiben unverändert; bereits stornierte Scheine werden nicht angefasst.
            Diese Aktion ist final — das Spiel kann danach nie mehr normal abgerechnet werden.
          </Notice>

          <Field label="Grund des Spielausfalls — bewusst auswählen, keine Vorauswahl" hint="Nichtantritt-Auswahl löst nur einen Quoten-1,00-Vorschlag für die später separat zu bestätigende Tabellenwertung aus (§ 29 BFV-Spielordnung 2026) — nie automatisch gespeichert.">
            <div className="space-y-1.5">
              {(['away_no_show', 'home_no_show', 'other'] as const).map((t) => (
                <label key={t} className="flex items-center gap-2 text-[14px] text-gray-800">
                  <input type="radio" name="annulmentType" checked={annulmentType === t} onChange={() => setAnnulmentType(t)} />
                  {ANNULMENT_TYPE_LABELS[t]}
                  {t !== 'other' && suggestedOfficialScore(t) && (
                    <span className="text-[12px] text-gray-400">
                      (Vorschlag {suggestedOfficialScore(t)!.home}:{suggestedOfficialScore(t)!.away})
                    </span>
                  )}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Grund (für die Admin-Dokumentation, nicht der Spieler-Hinweistext)">
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z.B. Nichtantritt der Gastmannschaft" className={inputCls} />
          </Field>

          {preview?.counts && (
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

              <Notice tone="open">Gesamt-Erstattung: <b>{fmt(preview.totalRefund ?? 0)} Wildis</b></Notice>

              {!confirmArmed ? (
                <Btn variant="danger" block disabled={!annulmentType || !reason.trim()} onClick={() => setConfirmArmed(true)}>
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
        </>
      )}
    </div>
  )
}
