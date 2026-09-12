'use client'

import { useCallback, useEffect, useState } from 'react'
import { SURVEY_SECTIONS, SURVEY_VERSION, visibleQuestionsForAnswers, type Answers } from '@/lib/survey'
import type {
  SurveyOverview, QuestionStat, SurveyCrossTabs, SingleChoiceStat, ScaleStat, MultiStat, FreetextStat,
} from '@/lib/surveyAggregate'

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
  settings: { surveyMode: string; allowReset: boolean; isProduction: boolean }
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

export function SurveyTab() {
  const [data, setData] = useState<SurveyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<{ userId: string; username: string } | null>(null)
  const [confirmResetAll, setConfirmResetAll] = useState(false)
  const [viewParticipant, setViewParticipant] = useState<Participant | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/survey')
      const json = await res.json()
      if (res.ok) setData(json)
      else setMessage(`Fehler: ${json.error ?? 'Laden fehlgeschlagen.'}`)
    } catch {
      setMessage('Fehler: Netzwerkfehler.')
    } finally {
      setLoading(false)
    }
  }, [])

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
        setMessage(`Fehler: ${json.error ?? 'Aktion fehlgeschlagen.'}`)
        return false
      }
      return true
    } catch {
      setMessage('Fehler: Netzwerkfehler.')
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
    if (await postAction({ action: 'delete_response', userId })) {
      setConfirmDeleteUser(null)
      await load()
    }
  }

  async function resetAll() {
    if (await postAction({ action: 'reset_all' })) {
      setConfirmResetAll(false)
      await load()
    }
  }

  if (loading && !data) return <div className="text-center text-sm text-gray-400 py-8">Lädt…</div>
  if (!data) return <div className="text-center text-sm text-red-500 py-8">{message ?? 'Keine Daten.'}</div>

  const { settings, overview, perQuestion, crossTabs, participants } = data
  const statById = new Map(perQuestion.map((s) => [s.stat.questionId, s]))

  return (
    <div className="space-y-4">
      {message && (
        <div className="px-4 py-3 rounded-xl text-sm font-medium bg-red-50 text-red-700 border border-red-100">
          {message}
          <button onClick={() => setMessage(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Rollout config */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h3 className="font-bold text-gray-900 mb-3">Sichtbarkeit &amp; Konfiguration</h3>
        <div className="flex bg-gray-50 border border-gray-200 rounded-xl p-1 mb-3">
          {(['hidden', 'help_only', 'prominent'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={busy}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                settings.surveyMode === m ? 'bg-red-700 text-white shadow' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Aktuell: <strong>{MODE_LABEL[settings.surveyMode] ?? settings.surveyMode}</strong> ·
          {' '}„Nur unter Hilfe&rdquo; = nur über Hilfe → Feedback &amp; Umfrage erreichbar, kein Hinweis auf der Startseite.
          „Prominent&rdquo; zeigt zusätzlich einen Banner auf der Startseite.
        </p>
        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Bulk-Reset erlaubt (Testphase)</div>
            <div className="text-xs text-gray-500 mt-0.5">Schaltet den Button „Alle Testantworten löschen&rdquo; unten frei/aus.</div>
          </div>
          <button
            onClick={() => setAllowReset(!settings.allowReset)}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${settings.allowReset ? 'bg-gray-500 hover:bg-gray-600' : 'bg-red-700 hover:bg-red-800'}`}
          >
            {settings.allowReset ? 'Deaktivieren' : 'Aktivieren'}
          </button>
        </div>
      </div>

      {/* Overview */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h3 className="font-bold text-gray-900 mb-3">Übersicht</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Metric label="Aktive User" value={overview.activeUsers} />
          <Metric label="Umfrage begonnen" value={overview.started} />
          <Metric label="Vollständig abgegeben" value={overview.submitted} highlight="green" />
          <Metric label="Noch nicht teilgenommen" value={overview.notStarted} />
          <Metric label="Teilnahmequote" value={fmtPct(overview.participationRatePct)} />
          <Metric label="Ø Zufriedenheit (Q1)" value={fmtNum(overview.avgQ1, 1)} />
          <Metric label="Ø Wiederteilnahme (Q30)" value={fmtNum(overview.avgQ30, 1)} />
        </div>
        {overview.startedNotSubmitted > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            <strong>{overview.startedNotSubmitted}</strong> Person(en) haben begonnen, aber noch nicht abgegeben.
          </div>
        )}
      </div>

      {/* Cross-tabs */}
      <CrossTabsSection crossTabs={crossTabs} />

      {/* Per-question stats, grouped by section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h3 className="font-bold text-gray-900 mb-1">Auswertung je Frage</h3>
        <p className="text-xs text-gray-500 mb-3">Basierend auf {overview.submitted} vollständig abgegebenen Antworten.</p>
        <div className="space-y-4">
          {SURVEY_SECTIONS.map((section) => (
            <details key={section.id} className="group border border-gray-100 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
                <span className="font-semibold text-sm text-gray-800">{section.id}. {section.title}</span>
                <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </summary>
              <div className="p-4 space-y-4">
                {section.questions.map((q) => {
                  const stat = statById.get(q.id)
                  if (!stat) return null
                  return <QuestionStatBlock key={q.id} stat={stat} />
                })}
              </div>
            </details>
          ))}
        </div>
      </div>

      {/* Individual participants */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900">Einzelantworten</h3>
          <a href="/api/admin/survey/export" className="text-xs font-semibold text-red-700 hover:underline">CSV Export</a>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100">
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
                <tr key={p.userId} className="border-b border-gray-50">
                  <td className="py-2 pr-2 font-medium text-gray-800">{p.username}</td>
                  <td className="py-2 pr-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.status === 'abgegeben' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-gray-500">{fmtDate(p.startedAt)}</td>
                  <td className="py-2 pr-2 text-gray-500">{fmtDate(p.submittedAt)}</td>
                  <td className="py-2 pr-2 text-gray-500">{fmtDate(p.updatedAt)}</td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-1.5 justify-end">
                      <button onClick={() => setViewParticipant(p)} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">Ansehen</button>
                      <button onClick={() => setConfirmDeleteUser({ userId: p.userId, username: p.username })} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-red-100 text-red-700 hover:bg-red-200">Löschen</button>
                    </div>
                  </td>
                </tr>
              ))}
              {participants.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-gray-400">Noch keine Antworten.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Danger zone */}
      <div className="border border-red-200 rounded-2xl p-4 bg-red-50">
        <h4 className="font-bold text-red-800 mb-1 text-sm">Testphase — Alle Antworten löschen</h4>
        <p className="text-xs text-red-700 mb-3">
          Löscht alle Umfrageantworten der Version {SURVEY_VERSION} unwiderruflich. Nur für die Testphase gedacht —
          über „Bulk-Reset erlaubt&rdquo; oben deaktivierbar, bevor die Winterpause beginnt.
        </p>
        {settings.isProduction && (
          <p className="text-xs font-semibold text-red-800 mb-3">
            ⚠️ Auf Production (main) ist der Bulk-Reset immer gesperrt, unabhängig vom Schalter oben — Schutz gegen versehentliches Löschen echter Antworten.
          </p>
        )}
        <button
          onClick={() => setConfirmResetAll(true)}
          disabled={!settings.allowReset || settings.isProduction || busy}
          className="w-full py-2.5 bg-red-700 hover:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-colors text-sm"
        >
          {settings.isProduction ? 'Auf Production gesperrt' : settings.allowReset ? 'Alle Testantworten löschen' : 'Bulk-Reset deaktiviert'}
        </button>
      </div>

      {/* Confirm: delete one participant */}
      {confirmDeleteUser && (
        <ConfirmDialog
          title="Antworten löschen?"
          text={`Möchtest du die Umfrageantworten von ${confirmDeleteUser.username} wirklich löschen? Der Nutzer kann die Umfrage anschließend erneut von vorne ausfüllen.`}
          confirmLabel="Antworten löschen"
          busy={busy}
          onCancel={() => setConfirmDeleteUser(null)}
          onConfirm={() => deleteResponse(confirmDeleteUser.userId)}
        />
      )}

      {/* Confirm: bulk reset */}
      {confirmResetAll && (
        <ConfirmDialog
          title="Wirklich alle Antworten löschen?"
          text={`Wirklich alle Antworten der Umfrage ${SURVEY_VERSION} löschen?`}
          confirmLabel="Alle löschen"
          busy={busy}
          onCancel={() => setConfirmResetAll(false)}
          onConfirm={resetAll}
        />
      )}

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

function CrossTabsSection({ crossTabs }: { crossTabs: SurveyCrossTabs }) {
  const { wettoeffnung, startgeld, preise, teilnahme, mechanik, auszahlungsdeckel, kommunikation, statsMarkets, bKlasse } = crossTabs
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <h3 className="font-bold text-gray-900 mb-3">Kombinierte Auswertungen</h3>
      <div className="space-y-4">
        <details className="group border border-gray-100 rounded-xl overflow-hidden" open>
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Wettöffnung (Q3)</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 text-xs">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-50 rounded-lg px-2 py-2 text-center">
                <div className="text-lg font-bold text-gray-700">{fmtPct(wettoeffnung.frueherPct)}</div>
                <div className="text-[9px] text-gray-400">wollen früher öffnen</div>
              </div>
              <div className="bg-gray-50 rounded-lg px-2 py-2 text-center">
                <div className="text-lg font-bold text-gray-700">{fmtPct(wettoeffnung.passtPct)}</div>
                <div className="text-[9px] text-gray-400">passt genau</div>
              </div>
              <div className="bg-gray-50 rounded-lg px-2 py-2 text-center">
                <div className="text-lg font-bold text-gray-700">{fmtPct(wettoeffnung.spaeterPct)}</div>
                <div className="text-[9px] text-gray-400">wollen später öffnen</div>
              </div>
            </div>
            <div className="text-[10px] text-gray-400 mt-1.5">n={wettoeffnung.total} — die vollständige Optionsverteilung steht unten bei den Einzelfragen (Abschnitt 1).</div>
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden" open>
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Startgeld</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 space-y-3 text-xs">
            <div>
              <div className="font-semibold text-gray-600 mb-1">Bereitschaft (Q4)</div>
              {startgeld.shareQ4.map((o) => (
                <div key={o.option} className="flex items-center gap-2 mb-1">
                  <span className="w-36 flex-shrink-0 text-gray-600">{o.option}</span>
                  <Bar pct={o.pct} />
                  <span className="w-16 text-right text-gray-500">{o.count} ({fmtPct(o.pct)})</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Wunsch-Höhe (Q5, nur Ja/Kommt auf die Höhe an)</div>
              {startgeld.q5Distribution.map((o) => (
                <div key={o.option} className="flex items-center gap-2 mb-1">
                  <span className="w-36 flex-shrink-0 text-gray-600">{o.option}</span>
                  <Bar pct={o.pct} />
                  <span className="w-16 text-right text-gray-500">{o.count} ({fmtPct(o.pct)})</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Kumulativ würden mitmachen bis maximal…</div>
              <div className="grid grid-cols-4 gap-1.5">
                {startgeld.cumulativeAtThreshold.map((t) => (
                  <div key={t.threshold} className="bg-gray-50 rounded-lg px-1.5 py-1.5 text-center">
                    <div className="text-sm font-bold text-gray-700">{t.count}</div>
                    <div className="text-[9px] text-gray-400">bis {t.threshold} €</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Ø Wiederteilnahme (Q30) nach Q4</div>
              {startgeld.avgQ30ByQ4.map((g) => (
                <div key={g.group} className="flex justify-between text-gray-600 mb-0.5">
                  <span>{g.group}</span><span>{fmtNum(g.avg, 1)} ({g.count})</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Ø Zufriedenheit (Q1) nach Q4</div>
              {startgeld.avgQ1ByQ4.map((g) => (
                <div key={g.group} className="flex justify-between text-gray-600 mb-0.5">
                  <span>{g.group}</span><span>{fmtNum(g.avg, 1)} ({g.count})</span>
                </div>
              ))}
            </div>
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Preise</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 space-y-3 text-xs">
            <div>
              <div className="font-semibold text-gray-600 mb-1">Beliebteste Preisart (Q7)</div>
              {preise.q7.map((o) => (
                <div key={o.option} className="flex items-center gap-2 mb-1">
                  <span className="w-36 flex-shrink-0 text-gray-600">{o.option}</span>
                  <Bar pct={o.pctOfRespondents} />
                  <span className="w-16 text-right text-gray-500">{o.count}×</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Gewünschte Verteilung (Q8)</div>
              {preise.q8.map((o) => (
                <div key={o.option} className="flex items-center gap-2 mb-1">
                  <span className="w-36 flex-shrink-0 text-gray-600">{o.option}</span>
                  <Bar pct={o.pct} />
                  <span className="w-16 text-right text-gray-500">{o.count} ({fmtPct(o.pct)})</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Startgeld (Q4) × Preisart (Q7) — Top-Kombinationen</div>
              <div className="space-y-0.5">
                {preise.q4xQ7.slice(0, 8).map((c, i) => (
                  <div key={i} className="flex justify-between text-gray-600">
                    <span>{c.q4Option} → {c.q7Option}</span><span>{c.count}×</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Teilnahme / Bindung</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 space-y-3 text-xs">
            <div>
              <div className="font-semibold text-gray-600 mb-1">Häufigste Gründe fürs Nicht-Wetten (Q29)</div>
              {teilnahme.reasonsRanked.map((o) => (
                <div key={o.option} className="flex items-center gap-2 mb-1">
                  <span className="w-40 flex-shrink-0 text-gray-600 truncate" title={o.option}>{o.option}</span>
                  <Bar pct={o.pctOfRespondents} />
                  <span className="w-16 text-right text-gray-500">{o.count}×</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Ø Wiederteilnahme (Q30) je Grund</div>
              {teilnahme.avgQ30ByReason.filter((g) => g.count > 0).map((g) => (
                <div key={g.reason} className="flex justify-between text-gray-600 mb-0.5">
                  <span className="truncate mr-2" title={g.reason}>{g.reason}</span><span className="flex-shrink-0">{fmtNum(g.avg, 1)} ({g.count})</span>
                </div>
              ))}
            </div>
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Spielmechanik (Übersicht)</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-xs min-w-[480px]">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100">
                  <th className="py-1.5 pr-2 font-semibold">Frage</th>
                  <th className="py-1.5 pr-2 font-semibold">Häufigste Antwort</th>
                  <th className="py-1.5 pr-2 font-semibold">Antworten</th>
                  <th className="py-1.5 pr-2 font-semibold">Änderungswunsch</th>
                </tr>
              </thead>
              <tbody>
                {mechanik.map((m) => (
                  <tr key={m.questionId} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 text-gray-700 max-w-[220px] truncate" title={m.text}>{m.text}</td>
                    <td className="py-1.5 pr-2 text-gray-500">{m.topOption ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-gray-500">{m.total}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.wantsChange ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                        {fmtPct(m.wantsChangePct)}{m.wantsChange ? ' ⚠️' : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Auszahlungsdeckel</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 space-y-3 text-xs">
            <div>
              <div className="font-semibold text-gray-600 mb-1">Bekanntheit (Q14)</div>
              <SingleBlock stat={auszahlungsdeckel.bekanntheit} />
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Bewertung — alle (Q14_follow)</div>
              <SingleBlock stat={auszahlungsdeckel.bewertung} />
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Bewertung — kannte den Deckel vorher (Ja)</div>
              {auszahlungsdeckel.bewertungByBekanntheit.knew.map((o) => (
                <div key={o.option} className="flex items-center gap-2 mb-1">
                  <span className="w-36 flex-shrink-0 text-gray-600">{o.option}</span>
                  <Bar pct={o.pct} />
                  <span className="w-16 text-right text-gray-500">{o.count} ({fmtPct(o.pct)})</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Bewertung — kannte den Deckel vorher nicht (Nein)</div>
              {auszahlungsdeckel.bewertungByBekanntheit.didNotKnow.map((o) => (
                <div key={o.option} className="flex items-center gap-2 mb-1">
                  <span className="w-36 flex-shrink-0 text-gray-600">{o.option}</span>
                  <Bar pct={o.pct} />
                  <span className="w-16 text-right text-gray-500">{o.count} ({fmtPct(o.pct)})</span>
                </div>
              ))}
            </div>
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">B-Klasse (Q28)</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 text-xs">
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
                <div className="text-sm font-bold text-gray-700">{fmtPct(bKlasse.wenigerPct)}</div>
                <div className="text-[9px] text-gray-400">weniger als aktuell</div>
              </div>
              <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
                <div className="text-sm font-bold text-gray-700">{fmtPct(bKlasse.aktuellPct)}</div>
                <div className="text-[9px] text-gray-400">aktuelles Modell</div>
              </div>
              <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
                <div className="text-sm font-bold text-gray-700">{fmtPct(bKlasse.mehrPct)}</div>
                <div className="text-[9px] text-gray-400">mehr als aktuell</div>
              </div>
              <div className="bg-gray-50 rounded-lg px-1.5 py-2 text-center">
                <div className="text-sm font-bold text-gray-700">{fmtPct(bKlasse.komplettPct)}</div>
                <div className="text-[9px] text-gray-400">komplette B-Klasse</div>
              </div>
            </div>
            <div className="text-[10px] text-gray-400 mb-2">n={bKlasse.total} — restliche Antworten ("interessiert mich kaum" / "egal") sind hier nicht mitgezählt, volle Verteilung unten:</div>
            <SingleBlock stat={bKlasse.raw} />
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Kommunikation</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 space-y-3 text-xs">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800">
              {fmtPct(kommunikation.pushProblemPct)} hatten Probleme mit Push-Benachrichtigungen.
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-800">
              {fmtPct(kommunikation.recapRarelyOrNeverPct)} lesen die Spieltags-Recaps selten oder gar nicht.
            </div>
            <SingleBlock stat={kommunikation.q20} />
            <div>
              <div className="font-semibold text-gray-600 mb-1">Wusste, dass Recaps auch in der App sind</div>
              <SingleBlock stat={kommunikation.recapKnown} />
            </div>
            <div>
              <div className="font-semibold text-gray-600 mb-1">Tatsächlicher Nutzungskanal</div>
              <SingleBlock stat={kommunikation.recapChannel} />
            </div>
            <SingleBlock stat={kommunikation.q22} />
          </div>
        </details>

        <details className="group border border-gray-100 rounded-xl overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-800">Statistiken &amp; Wettmärkte</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="p-4 space-y-3 text-xs">
            <SingleBlock stat={statsMarkets.q23} />
            <FreetextBlock stat={statsMarkets.q23_text} />
            <MultiBlock stat={statsMarkets.q24} />
            <MultiBlock stat={statsMarkets.q25} />
            <FreetextBlock stat={statsMarkets.q26} />
          </div>
        </details>
      </div>
    </div>
  )
}

function ConfirmDialog({ title, text, confirmLabel, busy, onCancel, onConfirm }: {
  title: string; text: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h4 className="font-bold text-gray-900 mb-2">{title}</h4>
        <p className="text-sm text-gray-600 mb-4">{text}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700">Abbrechen</button>
          <button onClick={onConfirm} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white text-sm font-bold">{confirmLabel}</button>
        </div>
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
