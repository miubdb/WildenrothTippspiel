'use client'

import { useEffect, useMemo, useState } from 'react'
import { AreaTitle, Btn, Chips, EmptyNote, Notice, Panel } from '@/components/admin/ui'
import { MatchdayPicker } from '@/components/admin/MatchdayPicker'
import type { MatchRow, ScorerDraft } from '@/components/admin/types'
import { CupSettlementPreview, EMPTY_CUP, MatchSettleCard, PostponedMatchCard, SettledMatchRow, type CupInput, type SettleMode } from '@/components/admin/ResultCards'
import type { EffectiveMatchdayIndex } from '@/lib/season'

/**
 * Visuelle Übernahme des alten, verworfenen Admin-Redesigns (components/admin/ErgebnisseTab.tsx
 * dort) — bewusst OHNE dessen eigene Datenabruf-/Abrechnungslogik (eigene settleMatch()/
 * postponeMatch()/changeCategory()-Implementierungen, eigener Supabase-Client, eigenes
 * useAdminFeedback()): all das bliebe sonst eine zweite, unabhängige Kopie neben den
 * bestehenden, bereits produktiv laufenden Handlern in app/admin/page.tsx — genau das Risiko,
 * das diese Übernahme ausdrücklich vermeiden soll. Diese Komponente bekommt alle Daten und
 * Handler als Props von AdminPage, filtert/gruppiert sie nur noch für die Darstellung und
 * besitzt ausschließlich reinen UI-Zustand (Liga-/Spieltag-/Status-Filter, "weitere anzeigen").
 *
 * Neu gegenüber der bisherigen Darstellung (rein clientseitige Sortierung bereits geladener
 * Daten, keine neue Abfrage, keine geänderte Fachregel):
 *  - Status-Filter (Ergebnis fehlt / nicht abgerechnet / bevorstehend / verschoben /
 *    abgerechnet) zusätzlich zum bestehenden Liga-/Spieltag-Filter.
 *  - Die drei Übersichts-Kacheln sind jetzt klickbare Filter-Setzer statt nur Anzeige.
 *  - "Ergebnis fehlt" und "Ergebnis da, nicht abgerechnet" werden als zwei separate
 *    Abschnitte geführt (beide zusammen sind exakt die bisherige "Ausstehende Ergebnisse"-
 *    Menge — reine Aufteilung derselben, bereits geladenen matches-Liste nach
 *    home_score/away_score, keine neue Abfrage).
 *
 * Admin 3.0, Punkt 3 (Entschlackung): Startansicht ist jetzt "Handlungsbedarf" statt "Alle" —
 * zeigt sofort nur, was zu erledigen ist (fehlendes Ergebnis + nicht abgerechnet), nicht mehr
 * automatisch auch Bevorstehendes/Verschobenes/Abgerechnetes gleichzeitig. Die bisherigen 6
 * Status-Werte sind zu 4 schnellen Umschaltern gruppiert (Handlungsbedarf/Bevorstehend/
 * Abgerechnet/Alle) — Liga- und Spieltag-Filter sind jetzt unter "Weitere Filter" eingeklappt,
 * nicht mehr permanent sichtbar. Reine Default-/Gruppierungsänderung, keine neue Abfrage.
 */

type Comp = 'all' | 'kreisliga' | 'b-klasse'
type StatusFilter = 'handlungsbedarf' | 'bevorstehend' | 'abgerechnet' | 'alle'

// Kein eigener "Wildenroth II"-Eintrag mehr — Wildenroth II spielt in der
// B-Klasse, daher deckt der B-Klasse-Filter diese Spiele mit ab (siehe
// matchesComp unten). Die separate match_category='wildenroth_ii' bleibt für
// Anzeige/Quotenmodell unverändert bestehen (CATEGORY_LABEL, lib/odds.ts,
// …) — nur dieser redundante, zusätzliche UI-Filter entfällt.
const COMP_ITEMS: Array<{ value: Comp; label: string }> = [
  { value: 'all', label: 'Alle Ligen' }, { value: 'kreisliga', label: 'Kreisliga' },
  { value: 'b-klasse', label: 'B-Klasse' },
]

function matchesComp(m: MatchRow, comp: Comp) {
  if (comp === 'all') return true
  if (comp === 'kreisliga') return !m.match_category || m.match_category === 'kreisliga'
  // „B-Klasse“ umfasst normale B-Klasse-Spiele, das markierte Topspiel UND
  // Wildenroth II (das in der B-Klasse spielt, siehe Kommentar oben) — wie
  // bisher matchesCompFilter in page.tsx, nur jetzt auch wildenroth_ii dabei.
  return m.match_category === 'b-klasse' || m.match_category === 'bklasse_topspiel' || m.match_category === 'wildenroth_ii'
}

const hasScore = (m: MatchRow) => m.home_score != null && m.away_score != null
const isOpenStatus = (m: MatchRow) => m.status === 'scheduled' || m.status === 'live'

export function ErgebnisseTabView({
  matches, loading, mdIndex, currentMatchday, pendingByMatch, matchdayForFilter, playerSuggestions,
  scores, onScoreChange, cupInputs, onCupInputChange, onSettle, onPostpone, settleLoading,
  scorers, onScorersChange, onMessage, onRescheduled,
}: {
  matches: MatchRow[]
  loading: boolean
  mdIndex: EffectiveMatchdayIndex
  currentMatchday: number | null
  pendingByMatch: Record<number, number>
  matchdayForFilter: (m: MatchRow) => number | null
  playerSuggestions: string[]
  scores: Record<number, { home: string; away: string }>
  onScoreChange: (matchId: number, side: 'home' | 'away', val: string) => void
  cupInputs: Record<number, CupInput>
  onCupInputChange: (matchId: number, field: keyof CupInput, val: string) => void
  onSettle: (matchId: number) => void
  onPostpone: (matchId: number) => void
  settleLoading: number | null
  scorers: Record<number, ScorerDraft[]>
  onScorersChange: (matchId: number, draft: ScorerDraft[]) => void
  onMessage: (m: string | null) => void
  onRescheduled: () => void
}) {
  const [comp, setComp] = useState<Comp>('all')
  // null = dem aktuellen Spieltag folgen (solange der Admin nichts wählt); 'all' = alle Spieltage
  const [mdChoice, setMdChoice] = useState<number | 'all' | null>(null)
  // Admin 3.0, Punkt 3: Default ist "Handlungsbedarf", nicht mehr "Alle" — siehe Kommentar oben.
  const [status, setStatus] = useState<StatusFilter>('handlungsbedarf')
  const [settledShown, setSettledShown] = useState(10)
  const mdFilter: number | 'all' = mdChoice ?? currentMatchday ?? 'all'

  // Nur für die "seit X Std."-Anzeige auf der "Ergebnis fehlt"-Pille — tickt einmal pro Minute,
  // keine neue Abfrage, keine Fachlogik.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const availableMatchdays = useMemo(
    () => [...mdIndex.kreisligaMatchdaysDisplayOrder, ...(matches.some((m) => m.matchday === 999) ? [999] : [])],
    [mdIndex, matches],
  )

  const view = useMemo(() => {
    const scoped = matches.filter((m) => matchesComp(m, comp) && (mdFilter === 'all' || matchdayForFilter(m) === mdFilter))
    const byDate = (a: MatchRow, b: MatchRow) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime()
    const open = scoped.filter(isOpenStatus)
    const missing = open.filter((m) => !hasScore(m) && new Date(m.match_date).getTime() <= now).sort(byDate)
    const unsettled = open.filter(hasScore).sort(byDate)
    const upcoming = open.filter((m) => !hasScore(m) && new Date(m.match_date).getTime() > now).sort(byDate)
    const postponed = scoped.filter((m) => m.status === 'postponed').sort(byDate)
    const settled = scoped.filter((m) => m.status === 'finished').sort((a, b) => byDate(b, a))
    return { scoped, missing, unsettled, upcoming, postponed, settled }
  }, [matches, comp, mdFilter, matchdayForFilter, now])

  // Gesamtübersicht über ALLE Spiele (unabhängig von den Filtern) — wie bisher auf dieser Seite.
  const overall = useMemo(() => ({
    noResult: matches.filter((m) => isOpenStatus(m) && !hasScore(m) && new Date(m.match_date).getTime() <= now).length,
    unsettled: matches.filter((m) => hasScore(m) && m.status !== 'finished').length,
    openBets: Object.values(pendingByMatch).reduce((a, b) => a + b, 0),
  }), [matches, pendingByMatch, now])

  function scoreOf(m: MatchRow) {
    return scores[m.id] ?? (hasScore(m) ? { home: String(m.home_score), away: String(m.away_score) } : { home: '', away: '' })
  }

  if (loading && matches.length === 0) return <div className="text-center py-8 text-gray-400">Lade Spiele...</div>

  // Admin 3.0, Punkt 3: 4 Schnell-Umschalter statt 6 Einzelwerte — "Handlungsbedarf" fasst
  // "Ergebnis fehlt" + "Nicht abgerechnet" zusammen, "Bevorstehend" fasst "Bevorstehend" +
  // "Verschoben" zusammen (reine Anzeige-Gruppierung derselben, längst geladenen Daten).
  const show = (s: 'missing' | 'unsettled' | 'upcoming' | 'postponed' | 'settled') => {
    if (status === 'alle') return true
    if (status === 'handlungsbedarf') return s === 'missing' || s === 'unsettled'
    if (status === 'bevorstehend') return s === 'upcoming' || s === 'postponed'
    return s === 'settled'
  }
  const mdLabel = (md: number) => (md === 999 ? 'Test' : `Spieltag ${md}`)
  const doneInScope = view.settled.length
  const totalInScope = view.scoped.filter((m) => m.status !== 'postponed').length

  const renderSettleCard = (m: MatchRow, mode: SettleMode) => (
    <MatchSettleCard
      key={m.id} match={m} mode={mode} now={now}
      score={scoreOf(m)} onChange={(side, val) => onScoreChange(m.id, side, val)}
      cupInput={cupInputs[m.id] ?? EMPTY_CUP} onCupInputChange={(field, val) => onCupInputChange(m.id, field, val)}
      onSettle={() => onSettle(m.id)} onPostpone={() => onPostpone(m.id)}
      loading={settleLoading === m.id} pendingBets={pendingByMatch[m.id]}
      scorerDraft={scorers[m.id]} onScorersChange={(draft) => onScorersChange(m.id, draft)}
      effectiveMatchday={matchdayForFilter(m)}
      cupSettlementPreview={<CupSettlementPreview match={m} score={scoreOf(m)} cupInput={cupInputs[m.id] ?? EMPTY_CUP} />}
    />
  )

  return (
    <div className="space-y-5">
      {/* Gesamtübersicht – Tippen setzt den passenden Filter */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <button type="button" onClick={() => { setStatus('handlungsbedarf'); setMdChoice('all'); setComp('all') }}
          className={`rounded-2xl border-2 px-2 py-3 text-center ${overall.noResult > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
          <div className={`font-display text-[30px] font-extrabold leading-none tabular-nums ${overall.noResult > 0 ? 'text-red-700' : 'text-gray-900'}`}>{overall.noResult}</div>
          <div className="mt-1 text-[12px] font-semibold leading-tight text-gray-800">Ergebnis fehlt</div>
        </button>
        <button type="button" onClick={() => { setStatus('handlungsbedarf'); setMdChoice('all'); setComp('all') }}
          className={`rounded-2xl border-2 px-2 py-3 text-center ${overall.unsettled > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
          <div className={`font-display text-[30px] font-extrabold leading-none tabular-nums ${overall.unsettled > 0 ? 'text-amber-800' : 'text-gray-900'}`}>{overall.unsettled}</div>
          <div className="mt-1 text-[12px] font-semibold leading-tight text-gray-800">Nicht abgerechnet</div>
        </button>
        <div className="rounded-2xl border-2 border-sky-200 bg-sky-50 px-2 py-3 text-center">
          <div className="font-display text-[30px] font-extrabold leading-none tabular-nums text-sky-800">{overall.openBets}</div>
          <div className="mt-1 text-[12px] font-semibold leading-tight text-gray-800">Offene Wetten</div>
        </div>
      </div>

      {/* Filter — Admin 3.0: nur noch der Status-Schnellumschalter ist permanent sichtbar;
          Liga/Spieltag sind seltener gebraucht und stehen unter "Weitere Filter". */}
      <Panel className="space-y-3 p-4">
        <Chips<StatusFilter> label="Status" value={status} onChange={(v) => { setStatus(v); setSettledShown(10) }} items={[
          { value: 'handlungsbedarf', label: `Handlungsbedarf · ${view.missing.length + view.unsettled.length}` },
          { value: 'bevorstehend', label: `Bevorstehend · ${view.upcoming.length + view.postponed.length}` },
          { value: 'abgerechnet', label: `Abgerechnet · ${view.settled.length}` },
          { value: 'alle', label: 'Alle Spiele' },
        ]} />
        <details className="group rounded-xl border border-gray-200">
          <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between px-3 text-[13px] font-semibold text-gray-600 select-none [&::-webkit-details-marker]:hidden">
            Weitere Filter (Liga, Spieltag)
            <svg className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="space-y-3 border-t border-gray-200 p-3">
            <Chips<Comp> label="Liga" value={comp} onChange={(v) => { setComp(v); setSettledShown(10) }} items={COMP_ITEMS} />
            <MatchdayPicker all value={mdFilter} options={availableMatchdays} current={currentMatchday} onChange={(v) => { setMdChoice(v); setSettledShown(10) }} />
          </div>
        </details>
        {totalInScope > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-[13px] text-gray-700">
              <span>{typeof mdFilter === 'number' ? mdLabel(mdFilter) : 'Auswahl'}: <b>{doneInScope}</b> von <b>{totalInScope}</b> abgerechnet</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200" role="img" aria-label={`${doneInScope} von ${totalInScope} Spielen abgerechnet`}>
              <div className="h-full rounded-full bg-green-600" style={{ width: `${(doneInScope / totalInScope) * 100}%` }} />
            </div>
          </div>
        )}
      </Panel>

      {view.scoped.length === 0 && <EmptyNote>Keine Spiele für diese Auswahl. Wähle oben eine andere Liga oder einen anderen Spieltag.</EmptyNote>}

      {show('missing') && view.missing.length > 0 && (
        <section aria-label="Ergebnis fehlt">
          <AreaTitle aside={view.missing.length} hint="Anpfiff ist vorbei, es ist noch kein Ergebnis eingetragen.">Ergebnis fehlt</AreaTitle>
          <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">{view.missing.map((m) => renderSettleCard(m, 'missing'))}</div>
        </section>
      )}

      {show('unsettled') && view.unsettled.length > 0 && (
        <section aria-label="Nicht abgerechnet">
          <AreaTitle aside={view.unsettled.length} hint="Ein Ergebnis ist gespeichert, die Wetten sind aber noch nicht abgerechnet.">Nicht abgerechnet</AreaTitle>
          <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">{view.unsettled.map((m) => renderSettleCard(m, 'unsettled'))}</div>
        </section>
      )}

      {show('postponed') && view.postponed.length > 0 && (
        <section aria-label="Verschobene Spiele">
          <AreaTitle aside={view.postponed.length} hint="Sobald ein neuer Termin feststeht, hier eintragen — das Spiel gilt dann wieder als geplant.">Verschobene Spiele</AreaTitle>
          <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            {view.postponed.map((m) => <PostponedMatchCard key={m.id} match={m} onRescheduled={onRescheduled} onMessage={onMessage} />)}
          </div>
        </section>
      )}

      {show('upcoming') && view.upcoming.length > 0 && (
        <section aria-label="Bevorstehende Spiele">
          <AreaTitle aside={view.upcoming.length} hint="Verlegt und früher gespielt? Das Ergebnis kann auch vorab eingetragen werden.">Bevorstehende Spiele</AreaTitle>
          <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">{view.upcoming.map((m) => renderSettleCard(m, 'upcoming'))}</div>
        </section>
      )}

      {show('settled') && view.settled.length > 0 && (
        <section aria-label="Abgerechnete Spiele">
          <AreaTitle aside={view.settled.length} hint="Neueste zuerst.">Abgerechnete Spiele</AreaTitle>
          <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            {view.settled.slice(0, settledShown).map((m) => (
              <SettledMatchRow key={m.id} match={m} playerSuggestions={playerSuggestions} effectiveMatchday={matchdayForFilter(m)} />
            ))}
          </div>
          {settledShown < view.settled.length && (
            <Btn block className="mt-3" onClick={() => setSettledShown((n) => n + 20)}>Weitere anzeigen ({view.settled.length - settledShown} übrig)</Btn>
          )}
        </section>
      )}

      {status !== 'alle' && view.scoped.length > 0 && (
        { handlungsbedarf: view.missing.length + view.unsettled.length, bevorstehend: view.upcoming.length + view.postponed.length, abgerechnet: view.settled.length }[status] === 0
      ) && (
        status === 'handlungsbedarf'
          ? <Notice tone="success">Alles erledigt: In dieser Auswahl fehlt kein Ergebnis und nichts ist unabgerechnet.</Notice>
          : <EmptyNote>In dieser Auswahl gibt es nichts mit diesem Status.</EmptyNote>
      )}

      {status === 'alle' && view.scoped.length > 0 && view.missing.length + view.unsettled.length === 0 && view.settled.length > 0 && (
        <Notice tone="success">Alles erledigt: In dieser Auswahl fehlt kein Ergebnis und nichts ist unabgerechnet.</Notice>
      )}
    </div>
  )
}
