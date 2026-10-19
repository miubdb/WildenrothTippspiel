'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '@/components/ui'

/** "1 Wildi" / "2 Wildis" — ehemals page-lokal in app/admin/page.tsx, jetzt hier, weil sowohl
 *  die Seite als auch components/admin/AdminBetsTab.tsx sie brauchen (ohne dass eine Komponente
 *  von der Seite importiert). */
export function wl(n: number): string {
  return Math.abs(n) === 1 ? 'Wildi' : 'Wildis'
}

/**
 * Geteilte Admin-Bausteine (nur Darstellung, 1:1 aus dem alten, verworfenen Admin-Redesign
 * übernommen, an die hier bereits vorhandene `useConfirm()`/`onMessage`-Konvention angepasst statt
 * eines eigenen Toast-Systems). Wachsen Tab für Tab mit, so wie jeder Tab tatsächlich modernisiert
 * wird — kein Vorrat an unbenutztem Code.
 */

// ── Statusfarben ────────────────────────────────────────────────────────────
// open      = wartet auf eine Aktion des Admins (Ergebnis eintragen, abrechnen)
// critical  = überfällig / braucht jetzt Aufmerksamkeit (Anpfiff vorbei, Ergebnis fehlt)
// success   = erledigt und gespeichert (abgerechnet)
// done      = abgeschlossen, ohne Handlungsbedarf (neutral)
// info      = Hinweis / geplant / verschoben
export type Tone = 'open' | 'critical' | 'success' | 'done' | 'info' | 'neutral'

const TONE_PILL: Record<Tone, string> = {
  open: 'bg-amber-100 text-amber-900 border-amber-300',
  critical: 'bg-red-100 text-red-900 border-red-300',
  success: 'bg-green-100 text-green-900 border-green-300',
  done: 'bg-gray-100 text-gray-700 border-gray-300',
  info: 'bg-sky-100 text-sky-900 border-sky-300',
  neutral: 'bg-white text-gray-700 border-gray-300',
}
const TONE_EDGE: Record<Tone, string> = {
  open: 'border-l-amber-500',
  critical: 'border-l-red-600',
  success: 'border-l-green-600',
  done: 'border-l-gray-300',
  info: 'border-l-sky-500',
  neutral: 'border-l-gray-300',
}

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-bold leading-5 whitespace-nowrap', TONE_PILL[tone], className)}>
      {children}
    </span>
  )
}

// ── Karten & Abschnitte ─────────────────────────────────────────────────────
export function Panel({ children, className, tone, as: Tag = 'div' }: { children: ReactNode; className?: string; tone?: Tone; as?: 'div' | 'section' | 'article' }) {
  return (
    <Tag className={cx('rounded-2xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(20,22,26,0.05)]', tone && cx('border-l-4', TONE_EDGE[tone]), className)}>
      {children}
    </Tag>
  )
}

// Einziges sticky Element im Admin-Bereich ist die dunkle "Zurück zur App"-Leiste aus
// app/admin/layout.tsx (~56px + safe-area-inset-top) — scroll-mt-24 (96px) deckt das mit
// Reserve ab, statt den alten Redesign-Wert (scroll-mt-28, für einen anderen Header kalibriert)
// ungeprüft zu übernehmen.
export function AreaTitle({ children, aside, id, hint }: { children: ReactNode; aside?: ReactNode; id?: string; hint?: ReactNode }) {
  return (
    <div id={id} className="mb-2 scroll-mt-24">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[20px] font-bold uppercase leading-6 tracking-wide text-gray-900">{children}</h2>
        {aside != null && <span className="shrink-0 text-[13px] font-semibold text-gray-600">{aside}</span>}
      </div>
      {hint && <p className="mt-0.5 text-[13px] text-gray-600">{hint}</p>}
    </div>
  )
}

/** Einklappbarer Abschnitt (native <details> – zugänglich, ohne eigenen Zustand). `id` erlaubt Sprungziele
 *  (AdminShellNav#jumpTo klappt ihn beim Anspringen automatisch auf). */
export function Section({ id, title, subtitle, badge, defaultOpen = false, tone, children }: {
  id?: string; title: string; subtitle?: string; badge?: ReactNode; defaultOpen?: boolean; tone?: Tone; children: ReactNode
}) {
  return (
    <details id={id} open={defaultOpen} className={cx('group scroll-mt-24 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(20,22,26,0.05)]', tone && cx('border-l-4', TONE_EDGE[tone]))}>
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold leading-5 text-gray-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] leading-4 text-gray-600">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          <svg className="h-5 w-5 text-gray-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </summary>
      <div className="border-t border-gray-200 px-4 py-4">{children}</div>
    </details>
  )
}

// ── Formularelemente ────────────────────────────────────────────────────────
// 16 px Schrift: iOS zoomt beim Fokussieren kleinerer Felder die Seite heran.
export const inputCls =
  'w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 text-[16px] text-gray-900 placeholder:text-gray-500 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/30 disabled:bg-gray-100 disabled:text-gray-500'
export const selectCls = cx(inputCls, 'pr-8')

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  // <label> umschließt das Feld: damit ist es ohne id/htmlFor korrekt zugeordnet (Screenreader, Tippen auf die Beschriftung).
  return (
    <div className={className}>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold text-gray-700">{label}</span>
        {children}
      </label>
      {hint && <p className="mt-1 text-[12px] text-gray-600">{hint}</p>}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-900 disabled:bg-gray-300 disabled:text-gray-600',
  secondary: 'bg-white text-gray-900 border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200',
  danger: 'bg-white text-red-700 border-2 border-red-300 hover:bg-red-50 active:bg-red-100 disabled:text-red-300 disabled:border-red-100',
  success: 'bg-green-700 text-white hover:bg-green-800 active:bg-green-900 disabled:bg-gray-300 disabled:text-gray-600',
  ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 disabled:text-gray-400',
}

export function Btn({ variant = 'secondary', size = 'md', loading, block, className, children, disabled, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: 'md' | 'sm'; loading?: boolean; block?: boolean
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
        size === 'md' ? 'min-h-[44px] rounded-xl px-4 text-[15px]' : 'min-h-[40px] rounded-lg px-3 text-[14px]',
        block && 'w-full', VARIANT[variant], className,
      )}
      {...rest}
    >
      {loading && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  )
}

/** Umbrechende Filter-Chips (kein horizontales Scrollen, nichts wird abgeschnitten). */
export function Chips<T extends string | number>({ value, onChange, items, label }: {
  value: T; onChange: (v: T) => void; label: string
  items: Array<{ value: T; label: ReactNode }>
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = it.value === value
        return (
          <button key={String(it.value)} type="button" aria-pressed={active} onClick={() => onChange(it.value)}
            className={cx('min-h-[40px] rounded-full border-2 px-3.5 text-[14px] font-bold transition-colors',
              active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50')}>
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'open' | 'critical' | 'success'; children: ReactNode; action?: ReactNode }) {
  const t = { info: 'bg-sky-50 border-sky-200 text-sky-900', open: 'bg-amber-50 border-amber-300 text-amber-900', critical: 'bg-red-50 border-red-300 text-red-900', success: 'bg-green-50 border-green-300 text-green-900' }[tone]
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-[14px] leading-5', t)}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border-2 border-dashed border-gray-300 px-4 py-6 text-center text-[14px] text-gray-600">{children}</div>
}

export function LoadingBlock({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <div role="status" className="space-y-3" aria-label={label}>
      <div className="skeleton h-14 rounded-2xl" aria-hidden />
      <div className="skeleton h-40 rounded-2xl" aria-hidden />
      <div className="skeleton h-40 rounded-2xl" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}

// ── Tab-Icons (rein darstellend, aus dem alten, verworfenen Admin-Redesign übernommen) ──
const icon = (d: string) => function Icon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}
export const ADMIN_TAB_ICONS = {
  ergebnisse: icon('M9 11l2 2 4-4M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z'),
  spieltag: icon('M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z'),
  quoten: icon('M5 19L19 5M7.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM16.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'),
  verwaltung: icon('M17 20h5v-2a4 4 0 00-3-3.9M9 20H4v-2a4 4 0 014-4h2a4 4 0 014 4v2zM12 7a3 3 0 11-6 0 3 3 0 016 0zM17 4.5a3 3 0 010 5.5'),
  umfrage: icon('M4 20V10M10 20V4M16 20v-7M22 20H2'),
} as const

/** Zähl-Badge auf einem Reiter (z. B. neue Registrierungen bei „Verwaltung“). */
export function AdminTabBadge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null
  return (
    <span
      aria-label={`${n} neue Registrierung${n === 1 ? '' : 'en'}`}
      className={cx('flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-bold leading-none text-white', className)}
    >
      {n}
    </span>
  )
}

// ── Bestätigungsdialog (ersetzt window.confirm — gleiche Ja/Nein-Semantik, nur modernere Darstellung) ──
type ConfirmOptions = {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>
const ConfirmContext = createContext<ConfirmFn>(async () => false)
export const useConfirm = () => useContext(ConfirmContext)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const confirm = useCallback<ConfirmFn>((o) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })), [])
  const close = useCallback((v: boolean) => setReq((r) => { r?.resolve(v); return null }), [])

  useEffect(() => {
    if (!req) return
    // Sicherer Standard: Fokus auf „Abbrechen“, damit Enter nichts Unbeabsichtigtes auslöst.
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [req, close])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => close(false)}>
          <div
            role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"
          >
            <h2 id="admin-confirm-title" className="text-[18px] font-bold text-gray-900">{req.title}</h2>
            {req.message && <div className="mt-2 text-[15px] leading-6 text-gray-700">{req.message}</div>}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                ref={cancelRef} type="button" onClick={() => close(false)}
                className="min-h-[48px] rounded-xl border-2 border-gray-300 bg-white px-4 text-[15px] font-bold text-gray-900 hover:bg-gray-50"
              >
                {req.cancelLabel ?? 'Abbrechen'}
              </button>
              <button
                type="button" onClick={() => close(true)}
                className={cx(
                  'min-h-[48px] rounded-xl px-4 text-[15px] font-bold text-white',
                  req.tone === 'danger' ? 'bg-red-800 hover:bg-red-900' : 'bg-red-700 hover:bg-red-800'
                )}
              >
                {req.confirmLabel ?? 'Bestätigen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
