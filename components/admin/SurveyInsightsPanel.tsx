'use client'

import { useMemo, useState } from 'react'
import { ALL_QUESTIONS, QUESTION_BY_ID, SURVEY_SECTIONS, isQuestionVisible, type Answers } from '@/lib/survey'
import {
  computePerQuestionStats, type QuestionStat, type SurveyRow,
  type SingleChoiceStat, type MultiStat, type ScaleStat,
} from '@/lib/surveyAggregate'
import {
  computeSurveyDecisionInsights, inSurveySegment, SURVEY_SEGMENTS,
  type InsightRate, type InsightRank, type SurveySegment,
} from '@/lib/surveyInsights'

export interface InsightParticipant {
  userId: string
  username: string
  status: 'angefangen' | 'abgegeben'
  startedAt: string
  submittedAt: string | null
  updatedAt: string
  answers: Answers
}

const fmt = (n: number) => n.toLocaleString('de-DE')
const pct = (n: number | null) => n == null ? '—' : n.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %'
const euros = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €'

function TinyMetric({ label, rate, note }: { label: string; rate: InsightRate; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[12px] font-semibold leading-4 text-gray-600">{label}</div>
      <div className="mt-1 text-[26px] font-black tracking-tight text-gray-900">{pct(rate.pct)}</div>
      <div className="text-[11px] text-gray-500">{rate.base ? fmt(rate.count) + ' von ' + fmt(rate.base) : 'Keine gültigen Antworten'}</div>
      <div className="mt-1.5 text-[11px] leading-4 text-gray-500">{note}</div>
    </div>
  )
}

function RankBars({ values, emptyText }: { values: InsightRank[]; emptyText?: string }) {
  if (!values.length) return <p className="text-sm text-gray-500">{emptyText ?? 'Noch keine Auswertung möglich.'}</p>
  return (
    <div className="space-y-3">
      {values.map((v, i) => (
        <div key={v.label}>
          <div className="flex items-start justify-between gap-3 text-[13px]">
            <span className="min-w-0 leading-5 text-gray-700"><span className="mr-2 font-bold text-gray-400">{i + 1}.</span>{v.label}</span>
            <span className="shrink-0 font-bold tabular-nums text-gray-900">{v.count} / {v.base}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-red-600" style={{ width: String(Math.max(0, Math.min(100, v.pct ?? 0))) + '%' }} />
            </div>
            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-gray-500">{pct(v.pct)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function distribution(stat: QuestionStat): { option: string; count: number; pct: number }[] {
  if (stat.type === 'single') {
    const s: SingleChoiceStat = stat.stat
    const answered = s.total - s.shownButUnanswered
    return s.options.map((o) => ({ option: o.option, count: o.count, pct: answered ? (o.count / answered) * 100 : 0 }))
  }
  if (stat.type === 'multi') {
    const s: MultiStat = stat.stat
    return s.options.map((o) => ({ option: o.option, count: o.count, pct: o.pctOfRespondents }))
  }
  if (stat.type === 'scale') {
    const s: ScaleStat = stat.stat
    return s.distribution.map((o) => ({ option: String(o.value), count: o.count, pct: s.total ? (o.count / s.total) * 100 : 0 }))
  }
  return []
}

function actualResponses(stat: QuestionStat): number {
  if (stat.type === 'single') return stat.stat.total - stat.stat.shownButUnanswered
  if (stat.type === 'multi') return stat.stat.respondents
  if (stat.type === 'scale') return stat.stat.total
  return stat.stat.entries.length
}

const controlCls = 'min-h-[44px] w-full rounded-xl border border-gray-300 bg-white px-3 text-[16px] text-gray-900 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20'

export function SurveyInsightsPanel({ participants }: { participants: InsightParticipant[] }) {
  const [segment, setSegment] = useState<SurveySegment>('all')
  const [questionId, setQuestionId] = useState('q_features')
  const [textQuestion, setTextQuestion] = useState('all')
  const [search, setSearch] = useState('')
  const [copyState, setCopyState] = useState('')

  const submitted = useMemo<SurveyRow[]>(() => participants
    .filter((p) => p.status === 'abgegeben' && !!p.submittedAt)
    .map((p) => ({
      user_id: p.userId,
      answers: p.answers,
      submitted_at: p.submittedAt,
      started_at: p.startedAt,
      updated_at: p.updatedAt,
    })), [participants])

  const selectedRows = useMemo(() => submitted.filter((r) => inSurveySegment(r.answers, segment)), [submitted, segment])
  const insights = useMemo(() => computeSurveyDecisionInsights(selectedRows), [selectedRows])
  const stats = useMemo(() => computePerQuestionStats(selectedRows, new Map()), [selectedRows])
  const allStats = useMemo(() => computePerQuestionStats(submitted, new Map()), [submitted])
  const stat = stats.find((q) => q.stat.questionId === questionId)
  const allStat = allStats.find((q) => q.stat.questionId === questionId)
  const question = QUESTION_BY_ID.get(questionId)
  const answerOptions = stat ? distribution(stat) : []
  const comparisonOptions = allStat ? new Map(distribution(allStat).map((o) => [o.option, o.pct])) : new Map<string, number>()

  const textEntries = useMemo(() => {
    const items: { key: string; questionId: string; question: string; answer: string; user: string; date: string }[] = []
    for (const p of participants) {
      if (p.status !== 'abgegeben' || !p.submittedAt || !inSurveySegment(p.answers, segment)) continue
      for (const q of ALL_QUESTIONS) {
        if (q.type !== 'freetext' || !isQuestionVisible(q, p.answers)) continue
        const answer = p.answers[q.id]
        if (typeof answer === 'string' && answer.trim()) {
          items.push({ key: p.userId + ':' + q.id, questionId: q.id, question: q.text, answer: answer.trim(), user: p.username, date: p.updatedAt })
        }
      }
    }
    return items.sort((a, b) => b.date.localeCompare(a.date))
  }, [participants, segment])

  const shownTextEntries = textEntries.filter((item) => {
    if (textQuestion !== 'all' && item.questionId !== textQuestion) return false
    const term = search.trim().toLocaleLowerCase('de')
    return !term || (item.answer + ' ' + item.question + ' ' + item.user).toLocaleLowerCase('de').includes(term)
  })
  const selectedLabel = SURVEY_SEGMENTS.find((s) => s.id === segment)?.label ?? 'Alle'
  const sampleSmall = selectedRows.length > 0 && selectedRows.length < 5

  const copyReport = async () => {
    const lines = [
      'WILDENROTH-TIPPSPIEL — WINTERUMFRAGE V2 · KURZBERICHT',
      'Segment: ' + selectedLabel + ' · Antworten: ' + selectedRows.length + ' von ' + submitted.length,
      'Zufriedenheit: ' + (insights.satisfactionAvg == null ? '—' : insights.satisfactionAvg.toFixed(1) + ' / 10'),
      'Wiederteilnahme nächste Saison: ' + pct(insights.returning.pct) + ' (' + insights.returning.count + '/' + insights.returning.base + ')',
      'Ausstiegsrisiko durch Startgeld: ' + pct(insights.feeExit.pct) + ' (' + insights.feeExit.count + '/' + insights.feeExit.base + ')',
      'Push-Probleme: ' + pct(insights.pushProblems.pct) + ' (' + insights.pushProblems.count + '/' + insights.pushProblems.base + ')',
      'Häufig als unrealistisch empfundene Quoten: ' + pct(insights.quotaProblems.pct) + ' (' + insights.quotaProblems.count + '/' + insights.quotaProblems.base + ')',
      'Top-Features: ' + (insights.topFeatures.slice(0, 3).map((v) => v.label + ' ' + v.count + '/' + v.base).join('; ') || '—'),
      'Neue Wettmärkte: ' + (insights.additionalMarkets.slice(0, 3).map((v) => v.label + ' ' + v.count + '/' + v.base).join('; ') || '—'),
      'Häufigste Hindernisse: ' + (insights.topObstacles.slice(0, 3).map((v) => v.label + ' ' + v.count + '/' + v.base).join('; ') || '—'),
      'Startgeld: Selbst angegebene Zahlungsbereitschaft, kein Einnahmeversprechen.',
      'Achtung: Kleine oder selektive Stichproben lassen keine repräsentativen Schlussfolgerungen zu.',
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopyState('Kurzbericht kopiert.')
    } catch {
      setCopyState('Kopieren ist hier nicht verfügbar.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-red-700">Umfrage-Cockpit · V2</p>
            <h3 className="mt-1 text-[19px] font-black leading-6 text-gray-900">Was sollten wir zur nächsten Saison verbessern?</h3>
            <p className="mt-1 text-[13px] leading-5 text-gray-600">Live berechnet aus vollständig abgegebenen Antworten. Alle Filter betreffen nur diese Ansicht.</p>
          </div>
          <button type="button" onClick={() => void copyReport()} disabled={selectedRows.length === 0}
            className="min-h-[40px] rounded-xl border border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:border-red-500 disabled:opacity-50">
            Kurzbericht kopieren
          </button>
        </div>
        {copyState && <p role="status" className="mt-2 text-[12px] text-gray-600">{copyState}</p>}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block text-[12px] font-semibold text-gray-700">
            Teilnehmergruppe vergleichen
            <select value={segment} onChange={(e) => setSegment(e.target.value as SurveySegment)} className={controlCls + ' mt-1'}>
              {SURVEY_SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-semibold text-gray-700">
            Basis: {selectedRows.length} von {submitted.length} Antworten
          </div>
        </div>
        {submitted.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-[13px] text-gray-600">
            Noch keine abgegebenen Antworten. Das Cockpit füllt sich automatisch, sobald die Umfrage startet.
          </p>
        ) : selectedRows.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-[13px] text-gray-600">In dieser Teilnehmergruppe liegen noch keine Antworten vor. Wähle eine andere Gruppe.</p>
        ) : sampleSmall ? (
          <p className="mt-3 text-[12px] text-amber-800">Kleine Teilgruppe (n={selectedRows.length}): Zahlen und Rankings sind nur Momentaufnahmen, keine belastbare Mehrheit.</p>
        ) : submitted.length < 10 ? (
          <p className="mt-3 text-[12px] text-gray-600">Noch kleine Stichprobe: Alle Prozentwerte immer gemeinsam mit den absoluten Stimmen lesen.</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <TinyMetric label="Wieder dabei 2027/28" rate={insights.returning} note="Ja oder eher ja bei Q30" />
        <TinyMetric label="Würde bei Startgeld aussteigen" rate={insights.feeExit} note="Explizite Ablehnung bei Q4" />
        <TinyMetric label="Probleme mit Push" rate={insights.pushProblems} note="Vier konkrete Problemantworten" />
        <TinyMetric label="Quoten häufig unrealistisch" rate={insights.quotaProblems} note="Häufig oder sehr häufig bei Q9" />
        <TinyMetric label="Liest die meisten Recaps" rate={insights.recapReaders} note="Bezugsgruppe: Q21a beantwortet" />
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-[12px] font-semibold text-gray-600">Ø Zufriedenheit</div>
          <div className="mt-1 text-[26px] font-black tracking-tight text-gray-900">{insights.satisfactionAvg == null ? '—' : insights.satisfactionAvg.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' / 10'}</div>
          <div className="mt-2 text-[11px] text-gray-500">Basiert auf den Antworten zur Zufriedenheit (Q1).</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-1 text-[15px] font-bold text-gray-900">Meistgewünschte neue Funktionen</h4>
          <p className="mb-3 text-[12px] text-gray-500">Anteil an Personen, die diese Mehrfachauswahl beantwortet haben.</p>
          <RankBars values={insights.topFeatures} />
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-1 text-[15px] font-bold text-gray-900">Häufigste Hindernisse beim Wetten</h4>
          <p className="mb-3 text-[12px] text-gray-500">Bewusst selektive Wetter sind kein Problem und werden hier nicht mitgezählt.</p>
          <RankBars values={insights.topObstacles} />
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-1 text-[15px] font-bold text-gray-900">Meistgewünschte neue Wettmärkte</h4>
          <p className="mb-3 text-[12px] text-gray-500">Drei konkrete Marktwünsche plus freiwillige eigene Vorschläge.</p>
          <RankBars values={insights.additionalMarkets} />
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-1 text-[15px] font-bold text-gray-900">Wettmärkte mit geringstem Stellenwert</h4>
          <p className="mb-3 text-[12px] text-gray-500">Verzichtbar bedeutet ausdrücklich nicht „abschaffen“.</p>
          <RankBars values={insights.expendableMarkets} />
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-1 text-[15px] font-bold text-gray-900">Startgeld-Szenarien</h4>
          <p className="mb-2 text-[12px] leading-4 text-gray-500">Mindestens so viele haben den Betrag ausdrücklich als akzeptabel angegeben. Keine Prognose echter Zahlungen.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-2">Startgeld</th><th className="py-2 text-right">Bereit</th><th className="py-2 text-right">Rechnerisches Budget</th></tr></thead>
              <tbody>{insights.prices.map((p) => (
                <tr key={p.price} className="border-b border-gray-100">
                  <td className="py-2 font-semibold text-gray-800">{euros(p.price)}</td>
                  <td className="py-2 text-right text-gray-700">{p.willing} / {p.population}</td>
                  <td className="py-2 text-right font-semibold text-gray-900">{euros(p.hypotheticalBudget)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-gray-500">Q5 wird nicht allen gezeigt. Nicht befragte und unentschlossene Personen zählen nicht als zahlungsbereit. Beträge sind eine rein rechnerische Obergrenze für diese Antwortgruppe.</p>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h4 className="text-[15px] font-bold text-gray-900">Worauf sollten wir schauen?</h4>
        <p className="mt-1 text-[12px] text-gray-500">Regelbasierte Prüfhinweise, keine automatische Entscheidung oder statistische Signifikanz.</p>
        {selectedRows.length < 5 ? (
          <p className="mt-3 text-[13px] text-gray-600">Ab mindestens fünf Antworten in dieser Gruppe werden erste Prüfhinweise angezeigt. Bis dahin bitte keine Schlüsse ziehen.</p>
        ) : insights.suggestions.length === 0 ? (
          <p className="mt-3 text-[13px] text-gray-600">Aktuell kein klarer Handlungsimpuls nach den festgelegten Schwellen. Die Einzelfragen trotzdem prüfen.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {insights.suggestions.map((s) => (
              <div key={s.title} className="rounded-xl border border-gray-200 px-3 py-3">
                <div className="text-[13px] font-bold text-gray-900">{s.title}</div>
                <p className="mt-1 text-[12px] leading-5 text-gray-600">{s.reason}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-[15px] font-bold text-gray-900">Interaktiver Fragen-Explorer</h4>
            <p className="text-[12px] text-gray-500">Jede der 42 Fragen prüfen; Segmentwerte mit allen Antworten vergleichen.</p>
          </div>
          <div className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600">42 Fragen</div>
        </div>
        <label className="mt-3 block text-[12px] font-semibold text-gray-700">
          Frage auswählen
          <select className={controlCls + ' mt-1'} value={questionId} onChange={(e) => setQuestionId(e.target.value)}>
            {SURVEY_SECTIONS.map((section) => (
              <optgroup key={section.id} label={section.id + '. ' + section.title}>
                {section.questions.map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {stat && question && (
          <div className="mt-4">
            <div className="text-[13px] font-bold leading-5 text-gray-800">{question.text}</div>
            <p className="mt-1 text-[12px] text-gray-500">{actualResponses(stat)} beantwortet · {stat.type === 'single' || stat.type === 'scale' ? stat.stat.total : stat.stat.visibleCount} sichtbar {stat.type === 'multi' ? '· Mehrfachauswahl, Summe kann über 100 % liegen' : ''}</p>
            {stat.type === 'scale' && <p className="mt-1 text-[12px] text-gray-600">Durchschnitt: {stat.stat.avg == null ? '—' : stat.stat.avg.toFixed(1)} · Median: {stat.stat.median == null ? '—' : stat.stat.median}</p>}
            {stat.type === 'freetext' ? (
              <p className="mt-2 text-[13px] text-gray-600">{stat.stat.entries.length} Textantworten – unten in der Freitext-Suche einzeln lesbar.</p>
            ) : actualResponses(stat) === 0 ? (
              <p className="mt-3 text-[13px] text-gray-500">Für diese Frage liegen in der gewählten Gruppe keine Antworten vor.</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {answerOptions.map((o) => {
                  const diff = segment === 'all' ? null : o.pct - (comparisonOptions.get(o.option) ?? 0)
                  return (
                    <div key={o.option}>
                      <div className="flex items-start justify-between gap-2 text-[12px]">
                        <span className="min-w-0 break-words leading-5 text-gray-700">{o.option}</span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums text-gray-700">{o.count} · {pct(o.pct)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-red-600" style={{ width: String(Math.min(100, Math.max(0, o.pct))) + '%' }} />
                        </div>
                        {diff !== null && <span className="w-20 text-right text-[11px] tabular-nums text-gray-500">{diff > 0 ? '+' : ''}{diff.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %-Pkt.</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {segment !== 'all' && <p className="mt-3 text-[11px] text-gray-500">Differenz gegenüber allen abgegebenen Antworten. Die Teilgruppe ist in der Gesamtgruppe enthalten; Prozentpunkt-Unterschiede sind keine Signifikanztests.</p>}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h4 className="text-[15px] font-bold text-gray-900">Freitext-Inbox</h4>
          <p className="text-[12px] text-gray-500">Alle freiwilligen Texte, inklusive Q31, durchsuchbar und nach Frage filterbar. Nur für Administratoren.</p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-gray-700">
            Thema
            <select value={textQuestion} onChange={(e) => setTextQuestion(e.target.value)} className={controlCls + ' mt-1'}>
              <option value="all">Alle Freitexte</option>
              {ALL_QUESTIONS.filter((q) => q.type === 'freetext').map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-gray-700">
            Suche
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Begriff oder Antwort suchen" className={controlCls + ' mt-1'} />
          </label>
        </div>
        <p className="mt-2 text-[12px] text-gray-500">{shownTextEntries.length} von {textEntries.length} Textantworten in dieser Teilnehmergruppe</p>
        {shownTextEntries.length === 0 ? <p className="mt-3 text-[13px] text-gray-500">Keine passenden Freitexte.</p> : (
          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {shownTextEntries.map((entry) => (
              <div key={entry.key} className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                <div className="text-[11px] font-semibold leading-4 text-gray-600">{entry.question}</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-gray-900">{entry.answer}</p>
                <p className="mt-2 text-[11px] text-gray-500">{entry.user} · {new Date(entry.date).toLocaleDateString('de-DE')}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="text-[11px] leading-4 text-gray-500">
        Datenstand: abgeschickte Antworten der aktuellen Umfrageversion. Die Segmente sind explorativ, keine repräsentative Stichprobe. Die Startgeld-Szenarien basieren auf Selbstangaben und enthalten keine Zahlungsgarantie.
      </p>
    </div>
  )
}
