'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toWetteData, canCancelItem, type HistoryItem } from '@/components/BetHistoryWithCancel'
import { WetteCard, fmt, type WetteData, type WetteLeg } from '@/components/WetteCard'
import { cappedPayout } from '@/lib/payout'
import type { SpecialDisplayInfo } from '@/lib/betDisplay'
import { slipGroupKey, slipGroupLabel, slipGroupRank, type SlipMatchday } from '@/components/meine-wetten/slipMatchday'
import { isVisibleComboStatus } from '@/lib/slipLifecycle'
import { Badge, Card, ChipBar, EmptyState, ErrorState, SectionTitle, cx } from '@/components/ui'

type Slip = { item: HistoryItem; wette: WetteData; md: SlipMatchday; cancellable: boolean }
type Group = { key: string; label: string; rank: number; mixed: boolean; list: Slip[] }
type Filter = 'alle' | 'won' | 'lost' | 'combo' | 'risky' | 'single'

const net = (w: WetteData) => (w.status === 'won' ? (w.payout ?? 0) - w.stake : w.status === 'lost' ? -w.stake : 0)
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`

const UNKNOWN_MD: SlipMatchday = { kind: 'unknown' }

/** Gruppiert Scheine nach Spieltag-Zuordnung; jüngster Spieltag (laut Spielplan, nicht BFV-Nummer) zuerst. */
function groupSlips(list: Slip[], order: readonly number[]): Group[] {
  const map = new Map<string, Group>()
  for (const s of list) {
    const key = slipGroupKey(s.md)
    const g = map.get(key)
    if (g) g.list.push(s)
    else map.set(key, { key, label: slipGroupLabel(s.md), rank: slipGroupRank(s.md, order), mixed: s.md.kind === 'mixed', list: [s] })
  }
  return [...map.values()].sort((a, b) => b.rank - a.rank)
}

/** Ein gemischter Kombischein zeigt je Leg zusätzlich dessen eigenen Spieltag
 *  (`legMatchdays`) — direkt im Matchnamen, damit WetteCard unverändert bleibt
 *  und keine zweite, meine-Wetten-eigene Kartenvariante entsteht. */
function legsWithMatchdayPrefix(wette: WetteData, md: SlipMatchday, legMatchdays: Record<string, number | null>): WetteLeg[] {
  if (md.kind !== 'mixed') return wette.legs
  return wette.legs.map((l) => {
    const leg = legMatchdays[`leg-${l.id}`]
    return leg != null ? { ...l, matchName: `${leg}. ST · ${l.matchName}` } : l
  })
}

export function MeineWettenClient({ items, slipMatchdays, legMatchdays, matchdayOrder, currentMatchday, playerNameMap, specialsById, highlight }: {
  items: HistoryItem[]
  /** Tippspiel-Spieltag je Schein (serverseitig wie in der Platzierungs-API ermittelt), Schlüssel `bet-<id>` / `combo-<id>`.
   *  `mixed` = Spiele aus mehreren Spieltagen – es wird kein Spieltag geraten. */
  slipMatchdays: Record<string, SlipMatchday>
  /** Spieltag je Einzeltipp (`leg-<betId>`), für die Anzeige gemischter Scheine. */
  legMatchdays: Record<string, number | null>
  /** Spieltage in tatsächlicher Spielreihenfolge (lib/season.ts, kreisligaMatchdaysDisplayOrder). */
  matchdayOrder: number[]
  /** Der Spieltag, den die App gerade als "aktuell" zeigt — dieselbe Logik wie
   *  die Tipps-Seite (app/_lib/currentMatchday.ts), NICHT aus offenen Scheinen
   *  abgeleitet: sonst verschwindet er, sobald alle seine Scheine entschieden sind. */
  currentMatchday: number
  playerNameMap?: Record<number, string>
  specialsById?: Record<number, SpecialDisplayInfo>
  highlight?: string
}) {
  const router = useRouter()
  const [tabChoice, setTab] = useState<'aktuell' | 'historie' | null>(null)
  const [filter, setFilter] = useState<Filter>('alle')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  // Stabil zwischen Renders: nur neu, wenn der Server neue Daten liefert (z. B. nach router.refresh()).
  // Defensive second filter, independent of the server: a void combo may
  // retain a neutralized leg for audit and must never reappear as won.
  const slips = useMemo<Slip[]>(() => items.filter(item =>
    item.kind === 'single' ? item.bet.status !== 'void' : isVisibleComboStatus(item.cb?.status)
  ).map((item) => {
    const wette = toWetteData(item, playerNameMap, specialsById)
    return { item, wette, cancellable: canCancelItem(item), md: slipMatchdays[wette.id] ?? UNKNOWN_MD }
  }), [items, playerNameMap, specialsById, slipMatchdays])

  // Aktueller Spieltag: ALLE Scheine (offen, gewonnen, verloren), die dort mitspielen — jeder
  // Schein genau einmal, auch gemischte Kombis über mehrere Spieltage hinweg.
  const current = useMemo(() => {
    const list = slips.filter((s) =>
      s.md.kind === 'single' ? s.md.matchday === currentMatchday
      : s.md.kind === 'mixed' && s.md.matchdays.includes(currentMatchday)
    )
    const order = { pending: 0, won: 1, lost: 2 } as Record<string, number>
    return [...list].sort((a, b) => (order[a.wette.status] ?? 3) - (order[b.wette.status] ?? 3))
  }, [slips, currentMatchday])
  const currentIds = useMemo(() => new Set(current.map((s) => s.wette.id)), [current])

  // Wichtiger Sonderfall: offene Scheine (oft Kombis), die NICHT zum aktuellen Spieltag gehören —
  // z. B. ein noch laufendes Spiel aus einem vergangenen oder gemischten Spieltag. Diese dürfen
  // nicht einfach verschwinden, nur weil sie keinen eigenen Reiter mehr haben.
  const otherOpen = useMemo(
    () => slips.filter((s) => s.wette.status === 'pending' && !currentIds.has(s.wette.id)),
    [slips, currentIds]
  )

  // Historie: alles Entschiedene außerhalb des aktuellen Spieltags, nach Spieltag gruppiert.
  const history = useMemo(
    () => slips.filter((s) => s.wette.status !== 'pending' && !currentIds.has(s.wette.id)),
    [slips, currentIds]
  )

  const tab = tabChoice ?? 'aktuell'

  // Push-Link ?highlight=…-<matchId>: den passenden Schein in die Mitte scrollen (einmal je Link).
  // Jeder Schein wird bereits standardmäßig vollständig dargestellt (siehe renderSlip), hier muss
  // also nur noch der richtige Reiter/die richtige Spieltagsgruppe geöffnet und hingescrollt werden.
  const highlightMatchId = highlight ? parseInt(highlight.split('-').at(-1) ?? '', 10) : NaN
  const hit = useMemo(() => isNaN(highlightMatchId)
    ? null
    : slips.find((s) => (s.item.kind === 'single' ? [s.item.bet] : s.item.legs).some((b) => b.match?.id === highlightMatchId)) ?? null,
  [slips, highlightMatchId])
  const hlRef = useRef<HTMLDivElement | null>(null)
  const handledHighlight = useRef<string | null>(null)
  useEffect(() => {
    if (!hit || handledHighlight.current === hit.wette.id) return
    setTab(currentIds.has(hit.wette.id) ? 'aktuell' : 'historie')
    setOpenGroups((g) => ({ ...g, [slipGroupKey(hit.md)]: true }))
    const t = setTimeout(() => { hlRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); handledHighlight.current = hit.wette.id }, 150)
    return () => clearTimeout(t)
  }, [hit, currentIds])

  const cancel = useCallback(async (betId?: number, comboId?: number) => {
    const key = betId ? `bet-${betId}` : `combo-${comboId}`
    setCancellingId(key)
    setError(null)
    try {
      const res = await fetch('/api/bets/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(betId ? { betId } : { comboId }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Stornierung fehlgeschlagen.')
      else router.refresh()
    } catch {
      // Unklares Netzwerkergebnis: nie blind wiederholen (Geldbewegung), stattdessen echten Stand laden.
      setError('Verbindung fehlgeschlagen. Bitte prüfe deine Wetten, bevor du die Stornierung erneut versuchst.')
      router.refresh()
    } finally {
      setCancellingId(null)
    }
  }, [router])

  const groups = useMemo(() => groupSlips(history.filter((s) => {
    const w = s.wette
    return filter === 'alle' ? true : filter === 'won' ? w.status === 'won' : filter === 'lost' ? w.status === 'lost'
      : filter === 'combo' ? w.type === 'combo' : filter === 'risky' ? !!w.isRisky : w.type === 'single'
  }), matchdayOrder), [history, filter, matchdayOrder])

  const wonCount = history.filter((s) => s.wette.status === 'won').length
  const lostCount = history.length - wonCount

  // Jeder Schein wird von sich aus vollständig dargestellt (defaultOpen) — sobald er überhaupt
  // sichtbar ist (im aktuellen Spieltag, oder innerhalb einer vom Nutzer geöffneten
  // Historien-Spieltagsgruppe), ist keine weitere Interaktion nötig, um ihn zu lesen.
  const renderSlip = (s: Slip) => (
    <div key={s.wette.id} ref={s.wette.id === hit?.wette.id ? hlRef : undefined}>
      <WetteCard
        wette={{ ...s.wette, legs: legsWithMatchdayPrefix(s.wette, s.md, legMatchdays) }}
        defaultOpen
        onCancel={cancel}
        cancellingId={cancellingId}
        isDeadlinePassed={!s.cancellable}
      />
      {s.md.kind === 'single' && s.md.partial && (
        <p className="mt-1 px-1 text-[11px] text-gray-500 dark:text-gray-400">Mindestens ein Spiel ist keinem Spieltag zugeordnet.</p>
      )}
    </div>
  )

  return (
    <div className="space-y-4 px-4 py-4">
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-gray-100 dark:bg-gray-800 p-1">
        {([['aktuell', `${currentMatchday}. Spieltag`], ['historie', 'Historie']] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={cx('rounded-xl py-2.5 text-[15px] font-bold transition-colors',
              tab === value ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400')}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <ErrorState title="Stornierung nicht möglich" action={<button className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-red-700 border border-red-200" onClick={() => setError(null)}>Schließen</button>}>{error}</ErrorState>
      )}

      {tab === 'aktuell' ? (
        <CurrentMatchday md={currentMatchday} list={current} otherOpen={otherOpen} renderSlip={renderSlip} />
      ) : history.length === 0 ? (
        <EmptyState title="Noch nichts ausgewertet" action={<Link href="/tipps" className="rounded-xl bg-[#CC0000] px-5 py-2.5 text-[15px] font-bold text-white">Zu den Tipps</Link>}>
          Sobald ein Spieltag abgerechnet ist, findest du hier deine Gewinne und Verluste – nach Spieltag sortiert.
        </EmptyState>
      ) : (
        <>
          <ChipBar<Filter> value={filter} onChange={setFilter} items={[
            { value: 'alle', label: 'Alle' }, { value: 'won', label: 'Gewonnen' }, { value: 'lost', label: 'Verloren' },
            { value: 'combo', label: 'Kombi' }, { value: 'risky', label: 'Risky' }, { value: 'single', label: 'Einzel' },
          ]} />
          <Card className="px-4 py-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="img" aria-label={`${wonCount} gewonnen, ${lostCount} verloren`}>
              <div className="bg-green-600" style={{ width: `${(wonCount / Math.max(1, wonCount + lostCount)) * 100}%` }} />
              <div className="bg-red-400" style={{ width: `${(lostCount / Math.max(1, wonCount + lostCount)) * 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[13px]">
              <span><b className="text-green-700 dark:text-green-400">{wonCount}</b> <span className="text-gray-600 dark:text-gray-400">gewonnen</span></span>
              <span><b className="text-red-700 dark:text-red-400">{lostCount}</b> <span className="text-gray-600 dark:text-gray-400">verloren</span></span>
            </div>
          </Card>
          {groups.length === 0 ? (
            <EmptyState title="Hier ist nichts">Probier oben einen anderen Filter.</EmptyState>
          ) : groups.map(({ key, label, mixed, list }) => {
            const sum = list.reduce((a, s) => a + net(s.wette), 0)
            const isOpen = openGroups[key] ?? false
            return (
              <Card key={key} className="overflow-hidden">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpenGroups((g) => ({ ...g, [key]: !isOpen }))}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                  <span className="section-title text-[20px] text-gray-900 dark:text-gray-100">{label}</span>
                  <span className="text-[13px] text-gray-600 dark:text-gray-400">{list.length} {list.length === 1 ? 'Schein' : 'Scheine'}</span>
                  <span className={cx('ml-auto font-display text-[22px] font-bold tabular-nums', sum > 0 ? 'text-green-700 dark:text-green-400' : sum < 0 ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100')}>{signed(sum)}</span>
                  <svg viewBox="0 0 24 24" className={cx('h-4 w-4 shrink-0 text-gray-600 transition-transform dark:text-gray-400', isOpen && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                    {mixed && <p className="text-[12px] text-gray-600 dark:text-gray-400">Kombis über mehrere Spieltage zählen in jedem davon.</p>}
                    {list.map(renderSlip)}
                  </div>
                )}
              </Card>
            )
          })}
        </>
      )}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <div className="min-w-0 rounded-xl bg-gray-100 px-2.5 py-2 dark:bg-gray-700/60">
      <div className="truncate text-[11px] text-gray-600 dark:text-gray-400">{label}</div>
      <div className={cx('truncate font-display text-[20px] font-bold leading-tight tabular-nums', tone === 'green' ? 'text-green-700 dark:text-green-400' : tone === 'red' ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100')}>{value}</div>
    </div>
  )
}

/** Aktueller Spieltag: erst offen, dann gewonnen, dann verloren — plus, falls vorhanden,
 *  noch laufende Scheine aus anderen Spieltagen, damit nichts aus dem alten "Offen"-Reiter
 *  verschwindet. */
function CurrentMatchday({ md, list, otherOpen, renderSlip }: { md: number; list: Slip[]; otherOpen: Slip[]; renderSlip: (s: Slip) => React.ReactNode }) {
  const pending = list.filter((s) => s.wette.status === 'pending')
  const won = list.filter((s) => s.wette.status === 'won')
  const lost = list.filter((s) => s.wette.status === 'lost')
  const staked = list.reduce((a, s) => a + s.wette.stake, 0)
  const settledNet = [...won, ...lost].reduce((a, s) => a + net(s.wette), 0)
  const stillPossible = pending.reduce((a, s) => a + cappedPayout(s.wette.stake, s.wette.totalOdds, !!s.wette.isRisky), 0)
  const parts: [string, Slip[]][] = [['Noch im Rennen', pending], ['Gewonnen 🎉', won], ['Verloren', lost]]

  if (list.length === 0 && otherOpen.length === 0) {
    return (
      <EmptyState title="Noch kein Schein im Rennen" action={<Link href="/tipps" className="rounded-xl bg-[#CC0000] px-5 py-2.5 text-[15px] font-bold text-white">Jetzt tippen</Link>}>
        Gib deinen Tipp ab – Wildi drückt dir die Daumen.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4">
      {list.length > 0 && (
        <Card className="px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="section-title text-[22px] text-gray-900 dark:text-gray-100">{md}. Spieltag</span>
            <span className="text-[13px] text-gray-600 dark:text-gray-400">{list.length} {list.length === 1 ? 'Schein' : 'Scheine'}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniStat label="Eingesetzt" value={fmt(staked)} />
            <MiniStat label="Bilanz" value={signed(settledNet)} tone={settledNet > 0 ? 'green' : settledNet < 0 ? 'red' : undefined} />
            <MiniStat label="Noch möglich" value={fmt(stillPossible)} tone={stillPossible > 0 ? 'green' : undefined} />
          </div>
        </Card>
      )}
      {parts.filter(([, l]) => l.length > 0).map(([label, l]) => (
        <section key={label}>
          <SectionTitle aside={`${l.length}`}>{label}</SectionTitle>
          <div className="space-y-3">{l.map(renderSlip)}</div>
        </section>
      ))}
      {otherOpen.length > 0 && (
        <section>
          <SectionTitle aside={`${otherOpen.length}`}>
            <span className="inline-flex items-center gap-1.5">
              Weitere laufende Wetten
              <Badge tone="neutral">andere Spieltage</Badge>
            </span>
          </SectionTitle>
          <div className="space-y-3">{otherOpen.map(renderSlip)}</div>
        </section>
      )}
    </div>
  )
}
