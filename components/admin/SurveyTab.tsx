'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { SURVEY_SECTIONS, visibleQuestionsForAnswers, type Answers } from '@/lib/survey'
import type {
  SurveyOverview, QuestionStat, SurveyCrossTabs, SingleChoiceStat, ScaleStat, MultiStat, FreetextStat,
} from '@/lib/surveyAggregate'
import { Btn, EmptyNote, LoadingBlock, Notice, Panel, Pill, Section, useConfirm } from '@/components/admin/ui'

interface Participant {
  userId: string
  username: string
  status: 'angefangen' | 'abgegeben'
  startedAt: string
  submittedAt: string | null
  updatedAt: string
  answers: Answers
}

interface SurveyData {
  settings: { surveyMode: string; surveyModeKey: string; surveyVersion: string; allowReset: boolean; isProduction: boolean }
  overview: SurveyOverview
  perQuestion: QuestionStat[]
  crossTabs: SurveyCrossTabs
  participants: Participant[]
}

const MODE_LABEL: Record<string, string> = { hidden: 'Versteckt', help_only: 'Nur unter Hilfe', prominent: 'Prominent (Startseite)' }

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtNum(n: number | null, digits = 2) {
  if (n == null) return '—'
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtPct(n: number) {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`
}

/** `onMessage` ersetzt die frühere eigene `message`-Mini-Leiste (immer rot, egal ob Erfolg oder
 *  Fehler, mit eigenem ✕-Dismiss) — läuft jetzt über dieselbe globale Banner-Stelle wie überall
 *  sonst im Admin-Bereich. Die beiden `ConfirmDialog`-Aufrufe (eigenes natives Modal) sind durch
 *  `useConfirm()` ersetzt, denselben Dialog, der an jeder anderen destruktiven Aktion im Admin-
 *  Bereich bereits verwendet wird. Alle Datenabrufe/Aktionen (`load`, `postAction`,
 *  `setMode`/`setAllowReset`/`deleteResponse`/`resetAll`) sind unverändert. */
export function SurveyTab({ onMessage }: { onMessage: (m: string | null) => void }) {
  const confirmDialog = useConfirm()
  const [data, setData] = useState<SurveyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [viewParticipant, setViewParticipant] = useState<Participant | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/survey')
      const json = await res.json()
      if (res.ok) { setData(json); setLoadFailed(false) } else {
        onMessage(`Fehler: ${json.error ?? 'Laden fehlgeschlagen.'}`)
        setLoadFailed(true)
      }
    } catch {
      onMessage('Fehler: Netzwerkfehler.')
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [onMessage])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async data fetch on mount, same pattern used throughout app/admin/page.tsx
    void load()
  }, [load])

  async function postAction(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        onMessage(`Fehler: ${json.error ?? 'Aktion fehlgeschlagen.'}`)
        return false
      }
      return true
    } catch {
      onMessage('Fehler: Netzwerkfehler.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function setMode(mode: string) {
    if (await postAction({ action: 'set_mode', mode })) await load()
  }

  async function setAllowReset(value: boolean) {
    if (await postAction({ action: 'set_allow_reset', value })) await load()
  }

  async function deleteResponse(userId: string) {
    if (await postAction({ action: 'delete_response', userId })) await load()
  }

  async function confirmDeleteResponse(userId: string, username: string) {
    if (!(await confirmDialog({
      title: 'Antworten löschen?',
      message: `Möchtest du die Umfrageantworten von ${username} wirklich löschen? Der Nutzer kann die Umfrage anschließend erneut von vorne ausfüllen.`,
      confirmLabel: 'Antworten löschen', tone: 'danger',
    }))) return
    await deleteResponse(userId)
  }

  async function resetAll() {
    if (await postAction({ action: 'reset_all' })) await load()
  }

  async function confirmResetAll() {
    // Admin 3.0, Punkt 11: besonders absichern — bewusst eingetippte Bestätigung statt nur
    // eines Tastendrucks, wie beim Saison-Reset (app/admin/page.tsx#resetSeasonBalances).
    if (!(await confirmDialog({
      title: 'Wirklich alle Antworten löschen?',
      message: `Wirklich alle Antworten der Umfrage ${data?.settings.surveyVersion ?? ''} löschen?`,
      confirmLabel: 'Alle löschen', tone: 'danger', requireText: 'LÖSCHEN',
    }))) return
    await resetAll()
  }

  if (loading && !data) return <LoadingBlock label="Umfragedaten werden geladen …" />
  if (!data) return (
    <Panel tone="critical" className="space-y-2 p-4">
      <Notice tone="critical" action={<Btn size="sm" onClick={load}>Erneut laden</Btn>}>
        {loadFailed ? 'Umfragedaten konnten nicht geladen werden.' : 'Keine Daten.'}
      </Notice>
    </Panel>
  )

  const { settings, overview, perQuestion, crossTabs, participants } = data
  const statById = new Map(perQuestion.map((s) => [s.stat.questionId, s]))

  return (
    <div className="space-y-4">
      <Section id="uf-sichtbarkeit" title="Sichtbarkeit & Konfiguration" subtitle="Umfrage-Rollout steuern (V2)" defaultOpen>
        <div className="space-y-3">
          <Notice tone="info">
            Dieser Schalter steuert ausschließlich <code>app_settings.{settings.surveyModeKey}</code>,
            <strong> nur für die Umgebung, in der dieses Admin-Panel gerade läuft</strong> ({settings.isProduction ? 'Production (main)' : 'Preview/integration'}).
            Production und Preview/integration haben JEWEILS ihren eigenen, komplett getrennten
            Schlüssel (<code>survey_mode_v2</code> bzw. <code>survey_mode_v2_preview</code>) in derselben
            Datenbank — eine Freigabe hier wirkt sich nie auf die jeweils andere Umgebung aus, weder
            sichtbar noch tatsächlich freigeschaltet. Ebenso speichert diese Umgebung ihre Antworten
            unter einer eigenen Umfrageversion: aktuell <strong><code>{settings.surveyVersion}</code></strong>{' '}
            — auch Export, Einzel-Löschung und Komplettreset betreffen ausschließlich diese Version, nie
            die der anderen Umgebung. Das alte <code>survey_mode</code>/<code>winter_2026_v1</code> (V1)
            bleibt davon unberührt und wird hier nicht mehr angezeigt/gesteuert; V1 hat bisher keine
            abgegebenen Antworten. Solange hier nichts geändert wird, bleibt V2 in beiden Umgebungen auf
            „Versteckt&rdquo; — keine Freischaltung ohne ausdrückliche Freigabe für genau diese Umgebung.
          </Notice>
          <div className="flex gap-2">
            {(['hidden', 'help_only', 'prominent'] as const).map((m) => (
              <Btn key={m} variant={settings.surveyMode === m ? 'primary' : 'secondary'} size="sm" className="flex-1" disabled={busy} onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </Btn>
            ))}
          </div>
          <p className="text-[13px] leading-5 text-gray-600">
            Aktuell ({settings.isProduction ? 'Production' : 'Preview/integration'}): <strong>{MODE_LABEL[settings.surveyMode] ?? settings.surveyMode}</strong> ·
            {' '}„Nur unter Hilfe&rdquo; = nur über Hilfe → Feedback &amp; Umfrage erreichbar, kein Hinweis auf der Startseite.
            „Prominent&rdquo; zeigt zusätzlich einen Banner auf der Startseite.
          </p>
          <div className="flex flex-col gap-3 rounded-xl bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[15px] font-bold text-gray-900">Bulk-Reset erlaubt (Testphase)</div>
              <div className="text-[13px] text-gray-600">Schaltet den Button „Alle Testantworten löschen&rdquo; unten frei/aus.</div>
            </div>
            <Btn variant={settings.allowReset ? 'secondary' : 'primary'} disabled={busy} onClick={() => setAllowReset(!settings.allowReset)}>
              {settings.allowReset ? 'Deaktivieren' : 'Aktivieren'}
            </Btn>
          </div>
        </div>
      </Section>

      <Section id="uf-uebersicht" title="Übersicht" subtitle="Teilnahme & kombinierte Auswertungen" defaultOpen badge={<Pill tone="neutral">{overview.submitted} abgegeben</Pill>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric label="Aktive User" value={overview.activeUsers} />
            <Metric label="Umfrage begonnen" value={overview.started} />
            <Metric label="Vollständig abgegeben" value={overview.submitted} highlight="green" />
            <Metric label="Noch nicht teilgenommen" value={overview.notStarted} />
            <Metric label="Teilnahmequote" value={fmtPct(overview.participationRatePct)} />
            <Metric label="Ø Zufriedenheit (Q1)" value={fmtNum(overview.avgQ1, 1)} />
            <Metric label="Ø Wiederteilnahme (Q30)" value={fmtNum(overview.avgQ30, 1)} />
          </div>
          {overview.startedNotSubmitted > 0 && (
            <Notice tone="open"><strong>{overview.startedNotSubmitted}</strong> Person(en) haben begonnen, aber noch nicht abgegeben.</Notice>
          )}
          <CrossTabsSection crossTabs={crossTabs} />
        </div>
      </Section>

      <Section id="uf-fragen" title="Auswertung je Frage" subtitle={`Basierend auf ${overview.submitted} vollständig abgegebenen Antworten`}>
        <div className="space-y-3">
          {SURVEY_SECTIONS.map((section) => (
            <details key={section.id} className="group rounded-xl border border-gray-200">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 text-[14px] font-semibold text-gray-800 select-none [&::-webkit-details-marker]:hidden">
                {section.id}. {section.title}
                <svg className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </summary>
              <div className="space-y-4 border-t border-gray-200 p-4">
                {section.questions.map((q) => {
                  const stat = statById.get(q.id)
                  if (!stat) return null
                  return <QuestionStatBlock key={q.id} stat={stat} />
                })}
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section id="uf-antworten" title="Einzelantworten" subtitle="Je Teilnehmer ansehen oder löschen" badge={<Pill tone="neutral">{participants.length}</Pill>}>
        <div className="space-y-3">
          <a href="/api/admin/survey/export" className="text-[13px] font-semibold text-red-700 hover:underline">CSV Export</a>
          {participants.length === 0 ? <EmptyNote>Noch keine Antworten.</EmptyNote> : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 pr-2 font-semibold">Nutzer</th>
                    <th className="py-2 pr-2 font-semibold">Status</th>
                    <th className="py-2 pr-2 font-semibold">Gestartet</th>
                    <th className="py-2 pr-2 font-semibold">Abgegeben</th>
                    <th className="py-2 pr-2 font-semibold">Geändert</th>
                    <th className="py-2 pr-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.userId} className="border-b border-gray-100">
                      <td className="py-2 pr-2 font-medium text-gray-800">{p.username}</td>
                      <td className="py-2 pr-2">
                        <Pill tone={p.status === 'abgegeben' ? 'success' : 'open'}>{p.status}</Pill>
                      </td>
                      <td className="py-2 pr-2 text-gray-500">{fmtDate(p.startedAt)}</td>
                      <td className="py-2 pr-2 text-gray-500">{fmtDate(p.submittedAt)}</td>
                      <td className="py-2 pr-2 text-gray-500">{fmtDate(p.updatedAt)}</td>
                      <td className="py-2 pr-2">
                        <div className="flex justify-end gap-1.5">
                          <Btn size="sm" variant="secondary" onClick={() => setViewParticipant(p)}>Ansehen</Btn>
                          <Btn size="sm" variant="danger" onClick={() => confirmDeleteResponse(p.userId, p.username)}>Löschen</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      <Section id="uf-danger" title="Testphase — Alle Antworten löschen" subtitle="Unwiderruflich, nur für die Testphase" tone="critical">
        <div className="space-y-3">
          <p className="text-[14px] leading-6 text-red-900">
            Löscht alle Umfrageantworten der Version {settings.surveyVersion} unwiderruflich (ausschließlich diese Umgebung, nie die der jeweils anderen). Nur für die Testphase gedacht —
            über „Bulk-Reset erlaubt&rdquo; oben deaktivierbar, bevor die Winterpause beginnt.
          </p>
          {settings.isProduction && (
            <Notice tone="critical">
              Auf Production (main) ist der Bulk-Reset immer gesperrt, unabhängig vom Schalter oben — Schutz gegen versehentliches Löschen echter Antworten.
            </Notice>
          )}
          <Btn variant="danger" block disabled={!settings.allowReset || settings.isProduction || busy} onClick={confirmResetAll}>
            {settings.isProduction ? 'Auf Production gesperrt' : settings.allowReset ? 'Alle Testantworten löschen' : 'Bulk-Reset deaktiviert'}
          </Btn>
        </div>
      </Section>

      {/* Participant detail */}
      {viewParticipant && (
        <ParticipantDetail participant={viewParticipant} onClose={() => setViewParticipant(null)} />
      )}
    </div>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string | number; highlight?: 'green' }) {
  return (
    <div className={`rounded-xl px-3 py-3 text-center border ${highlight === 'green' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className={`text-xl font-black ${highlight === 'green' ? 'text-green-700' : 'text-gray-800'}`}>{value}</div>
      <div className="text-[10px] text-gray-500 font-semibold mt-0.5 leading-tight">{label}</div>
    </div>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden flex-1">
      <div className="h-full bg-red-600 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

function QuestionStatBlock({ stat }: { stat: QuestionStat }) {
  if (stat.type === 'single') return <SingleBlock stat={stat.stat} />
  if (stat.type === 'scale') return <ScaleBlock stat={stat.stat} />
  if (stat.type === 'multi') return <MultiBlock stat={stat.stat} />
  return <FreetextBlock stat={stat.stat} />
}

function SingleBlock({ stat }: { stat: SingleChoiceStat }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-800 mb-1.5">{stat.text}</div>
      <div className="text-[11px] text-gray-400 mb-1.5">{stat.total} Antworten</div>
      <div className="space-y-1.5">
        {stat.options.map((o) => (
          <div key={o.option} className="flex items-center gap-2 text-xs">
            <span className="w-28 sm:w-40 flex-shrink-0 text-gray-600 truncate" title={o.option}>{o.option}</span>
            <Bar pct={o.pct} />
            <span className="w-16 flex-shrink-0 text-right text-gray-500">{o.count} ({fmtPct(o.pct)})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScaleBlock({ stat }: { stat: ScaleStat }) {
  const maxCount = Math.max(1, ...stat.distribution.map((d) => d.count))
  return (
    <div>
      <div className="text-sm font-semibold text-gray-800 mb-1.5">{stat.text}</div>
      <div className="text-[11px] text-gray-400 mb-1.5">
        {stat.total} Antworten · Ø {fmtNum(stat.avg, 2)} · Median {fmtNum(stat.median, 1)}
      </div>
      <div className="flex items-end gap-1 h-16">
        {stat.distribution.map((d) => (
          <div key={d.value} className="flex-1 flex flex-col items-center justify-end gap-0.5">
            <div className="w-full bg-red-500 rounded-t" style={{ height: `${(d.count / maxCount) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }} />
            <span className="text-[9px] text-gray-400">{d.value}</span>
          </div>
        ))}
      </div>
      {stat.buckets && (
        <div className="grid grid-cols-4 gap-1.5 mt-2">
          {stat.buckets.map((b) => (
            <div key={b.label} className="bg-gray-50 rounded-lg px-1.5 py-1.5 text-center">
              <div className="text-xs font-bold text-gray-700">{fmtPct(b.pct)}</div>
              <div className="text-[9px] text-gray-400">{b.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MultiBlock({ stat }: { stat: MultiStat }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-800 mb-1.5">{stat.text}</div>
      <div className="text-[11px] text-gray-400 mb-1.5">{stat.respondents} Antworten (Mehrfachauswahl)</div>
      <div className="space-y-1.5">
        {stat.options.map((o) => (
          <div key={o.option} className="flex items-center gap-2 text-xs">
            <span className="w-28 sm:w-40 flex-shrink-0 text-gray-600 truncate" title={o.option}>{o.option}</span>
            <Bar pct={o.pctOfRespondents} />
            <span className="w-24 flex-shrink-0 text-right text-gray-500">{o.count}× ({fmtPct(o.pctOfRespondents)})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FreetextBlock({ stat }: { stat: FreetextStat }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-800 mb-1.5">{stat.text}</div>
      <div className="text-[11px] text-gray-400 mb-1.5">
        {stat.entries.length} Antworten (freiwillig) · Frage war für {stat.visibleCount} Teilnehmer sichtbar
      </div>
      {stat.entries.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Keine Antworten.</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {stat.entries.map((e, i) => (
            <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
              <div className="text-xs text-gray-700">{e.answer}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{e.user} · {fmtDate(e.date)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="group border border-gray-100 rounded-xl overflow-hidden" open={defaultOpen}>
      <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
        <span className="font-semibold text-sm text-gray-800">{title}</span>
        <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </summary>
      <div className="p-4 space-y-3 text-xs">{children}</div>
    </details>
  )
}

function OptionBars({ options, pctKey }: { options: { option: string; count: number; pct?: number; pctOfRespondents?: number }[]; pctKey: 'pct' | 'pctOfRespondents' }) {
  return (
    <>
      {options.map((o) => (
        <div key={o.option} className="flex items-center gap-2 mb-1">
          <span className="w-40 flex-shrink-0 text-gray-600 truncate" title={o.option}>{o.option}</span>
          <Bar pct={o[pctKey] ?? 0} />
          <span className="w-20 flex-shrink-0 text-right text-gray-500">{o.count} ({fmtPct(o[pctKey] ?? 0)})</span>
        </div>
      ))}
    </>
  )
}

function CrossTabsSection({ crossTabs }: { crossTabs: SurveyCrossTabs }) {
  const { allgemein, risky, fairness, wettmaerkte, kommunikation, startgeldPreise, zukunft } = crossTabs
  return (
    <div>
      <h4 className="mb-2 text-[14px] font-bold text-gray-900">Kombinierte Auswertungen</h4>
      <div className="space-y-3">
        <DetailSection title="Allgemeiner Eindruck & Bedienung" defaultOpen>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Schwer nachvollziehbar (Mehrfachauswahl, max. 2)</div>
            <div className="text-[10px] text-gray-400 mb-1">n={allgemein.comprehensibility.respondents} Antwortende von {allgemein.comprehensibility.visibleCount} — Prozent je Option bezogen auf Antwortende.</div>
            <OptionBars options={allgemein.comprehensibility.options} pctKey="pctOfRespondents" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Was macht am meisten Spaß (freiwillig, max. 2)</div>
            <div className="text-[10px] text-gray-400 mb-1">n={allgemein.motivation.respondents} Antwortende von {allgemein.motivation.visibleCount} sichtbar (freiwillig, kann niedriger sein).</div>
            <OptionBars options={allgemein.motivation.options} pctKey="pctOfRespondents" />
          </div>
        </DetailSection>

        <DetailSection title="Risky-Wetten (Q12/Q13/Auszahlung)" defaultOpen>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
              <div className="text-sm font-bold text-gray-700">{fmtPct(risky.q12Groups.abolishPct)}</div>
              <div className="text-[9px] text-gray-400">abschaffen (Q13/Auszahlung ausgeblendet)</div>
            </div>
            <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
              <div className="text-sm font-bold text-gray-700">{fmtPct(risky.q12Groups.positivePct)}</div>
              <div className="text-[9px] text-gray-400">konkrete Anzahl (Q13/Auszahlung Pflicht)</div>
            </div>
            <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
              <div className="text-sm font-bold text-gray-700">{fmtPct(risky.q12Groups.neutralPct)}</div>
              <div className="text-[9px] text-gray-400">egal/unklar (Q13/Auszahlung freiwillig)</div>
            </div>
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Verteilung Q12 (n={risky.q12.total})</div>
            <OptionBars options={risky.q12.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Mindest-Gesamtquote Q13 (n={risky.q13.total} sichtbar{risky.q13.shownButUnanswered > 0 ? `, ${risky.q13.shownButUnanswered} freiwillig unbeantwortet` : ''})</div>
            <OptionBars options={risky.q13.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Max. Auszahlung normal (n={risky.payoutNormal.total})</div>
            <OptionBars options={risky.payoutNormal.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Max. Auszahlung Risky (n={risky.payoutRisky.total} sichtbar{risky.payoutRisky.shownButUnanswered > 0 ? `, ${risky.payoutRisky.shownButUnanswered} freiwillig unbeantwortet` : ''})</div>
            <OptionBars options={risky.payoutRisky.options} pctKey="pct" />
          </div>
        </DetailSection>

        <DetailSection title="Fairness & Abrechnung (Q17/Q19)">
          <div>
            <div className="font-semibold text-gray-600 mb-1">Wettbeschränkungen eigenes Team (Q17)</div>
            <OptionBars options={fairness.q17.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Unstimmigkeiten bei Abrechnung/Guthaben (Q19)</div>
            <OptionBars options={fairness.q19.options} pctKey="pct" />
          </div>
        </DetailSection>

        <DetailSection title="Wettmärkte & Spielauswahl (Q25/Q27/Q28)">
          <div className="grid grid-cols-3 gap-1.5">
            <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
              <div className="text-sm font-bold text-gray-700">{fmtPct(wettmaerkte.wouldDropAtLeastOnePct)}</div>
              <div className="text-[9px] text-gray-400">könnten auf ≥1 Markt verzichten</div>
            </div>
            <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
              <div className="text-sm font-bold text-gray-700">{fmtPct(wettmaerkte.keepAllPct)}</div>
              <div className="text-[9px] text-gray-400">möchten alle behalten</div>
            </div>
            <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
              <div className="text-sm font-bold text-gray-700">{fmtPct(wettmaerkte.cantJudgePct)}</div>
              <div className="text-[9px] text-gray-400">kann ich nicht beurteilen</div>
            </div>
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Verzichtbare Märkte (Q25, n={wettmaerkte.q25.respondents})</div>
            <OptionBars options={wettmaerkte.q25.options} pctKey="pctOfRespondents" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Kreisliga-Spielumfang (Q27)</div>
            <OptionBars options={wettmaerkte.q27.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">B-Klasse-Spielumfang (Q28)</div>
            <OptionBars options={wettmaerkte.q28.options} pctKey="pct" />
          </div>
        </DetailSection>

        <DetailSection title="Kommunikation & Statistiken (Q20/Q21/Q22/Q23)">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800">
            {fmtPct(kommunikation.pushProblemPct)} haben ein Problem mit Push-Benachrichtigungen (zu viele, unzuverlässig, kaum hilfreich oder Einrichtung fehlgeschlagen).
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Push-Nutzung (Q20)</div>
            <SingleBlock stat={kommunikation.q20} />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Spieltags-Recaps — Kanal (Q21, freiwillig, n={kommunikation.recapChannel.total})</div>
            <OptionBars options={kommunikation.recapChannel.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Gewünschter Benachrichtigungskanal (Q22)</div>
            <SingleBlock stat={kommunikation.q22} />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Persönliche Wettstatistiken (Q23, freiwillig, n={kommunikation.q23.total})</div>
            <OptionBars options={kommunikation.q23.options} pctKey="pct" />
          </div>
          <FreetextBlock stat={kommunikation.q23_text} />
        </DetailSection>

        <DetailSection title="Startgeld & Preise (Q4/Q5/Q7/Q8)" defaultOpen>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Einstellung zum Startgeld (Q4) — 5 Segmente</div>
            <OptionBars options={startgeldPreise.q4.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Max. Betrag (Q5, nur sichtbar bei Q4 = 2/3/4; n={startgeldPreise.q5.total})</div>
            <OptionBars options={startgeldPreise.q5.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Kumulative Zahlungsbereitschaft — würden mindestens diesen Betrag zahlen</div>
            <div className="text-[10px] text-gray-400 mb-1">Basis: {startgeldPreise.q5RespondentsCount} beantwortete Q5 (ein Maximum von 20&nbsp;€ zählt auch bei 5/10/15&nbsp;€ mit; &quot;kann ich noch nicht beurteilen&quot; zählt bei keinem Schwellenwert).</div>
            <div className="grid grid-cols-4 gap-1.5">
              {startgeldPreise.cumulativeWillingness.map((t) => (
                <div key={t.threshold} className="bg-gray-50 rounded-lg px-1.5 py-1.5 text-center">
                  <div className="text-sm font-bold text-gray-700">{t.count}</div>
                  <div className="text-[9px] text-gray-400">ab {t.threshold} € ({fmtPct(t.pctOfQ5Respondents)})</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Gewünschte Preisarten (Q7, max. 2 + „Keine Präferenz&rdquo;, n={startgeldPreise.q7.respondents})</div>
            <OptionBars options={startgeldPreise.q7.options} pctKey="pctOfRespondents" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Gewünschte Preisverteilung (Q8)</div>
            <OptionBars options={startgeldPreise.q8.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Ø Zufriedenheit (Q1) nach Q4</div>
            {startgeldPreise.avgQ1ByQ4.map((g) => (
              <div key={g.group} className="flex justify-between text-gray-600 mb-0.5">
                <span className="truncate mr-2" title={g.group}>{g.group}</span><span className="flex-shrink-0">{fmtNum(g.avg, 1)} ({g.count})</span>
              </div>
            ))}
          </div>
        </DetailSection>

        <DetailSection title="Zukunft & Verbesserungen (Q29/Q30/Features)" defaultOpen>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Gründe für weniger Wetten (Q29, max. 3, n={zukunft.q29.respondents})</div>
            <div className="text-[10px] text-gray-400 mb-1">{fmtPct(zukunft.satisfiedPct)} davon sind mit ihrer Wettaktivität bereits zufrieden (exklusive Option).</div>
            <OptionBars options={zukunft.q29.options} pctKey="pctOfRespondents" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Teilnahme 2027/28 (Q30)</div>
            <OptionBars options={zukunft.q30.options} pctKey="pct" />
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Q30-Verteilung je Grund (Q29)</div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {zukunft.q30ByReason.filter((g) => g.count > 0).map((g) => (
                <div key={g.reason} className="bg-gray-50 rounded-lg px-2 py-1.5">
                  <div className="text-gray-700 truncate mb-0.5" title={g.reason}>{g.reason} (n={g.count})</div>
                  <div className="text-gray-500">
                    {g.distribution.filter((o) => o.count > 0).map((o) => `${o.option}: ${o.count}`).join(' · ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="font-semibold text-gray-600 mb-1">Feature-Wünsche (max. 3, n={zukunft.features.respondents}) — {fmtPct(zukunft.featuresNonePct)} „Keine dieser Funktionen&rdquo;</div>
            <OptionBars options={zukunft.features.options} pctKey="pctOfRespondents" />
          </div>
        </DetailSection>
      </div>
    </div>
  )
}


function ParticipantDetail({ participant, onClose }: { participant: Participant; onClose: () => void }) {
  const visibleQs = visibleQuestionsForAnswers(participant.answers)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4 py-8" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 max-w-lg w-full shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-bold text-gray-900">{participant.username}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="text-xs text-gray-500 mb-4 space-y-0.5">
          <div>Gestartet: {fmtDate(participant.startedAt)}</div>
          <div>Abgegeben: {fmtDate(participant.submittedAt)}</div>
          <div>Zuletzt geändert: {fmtDate(participant.updatedAt)}</div>
        </div>
        <div className="space-y-3">
          {visibleQs.map((q) => {
            const v = participant.answers[q.id]
            const answered = Array.isArray(v) ? v.length > 0 : (typeof v === 'string' ? v.trim().length > 0 : typeof v === 'number')
            return (
              <div key={q.id} className="border-b border-gray-50 pb-2">
                <div className="text-xs font-semibold text-gray-700">{q.text}</div>
                <div className="text-sm text-gray-600 mt-0.5">
                  {!answered ? <span className="text-gray-300 italic">Keine Antwort</span> : Array.isArray(v) ? v.join(', ') : String(v)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
