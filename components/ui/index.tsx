import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

/* Gemeinsame UI-Bausteine des Redesigns (reine Darstellung, keine Geschäftslogik). */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function Card({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' }) {
  return (
    <Tag className={cx('bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-[0_1px_2px_rgba(20,22,26,0.04)]', className)}>
      {children}
    </Tag>
  )
}

/** Abschnittsüberschrift im Prototyp-Stil (Barlow Condensed, Großbuchstaben) mit optionalem Zusatz rechts. */
export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-baseline justify-between px-1 mb-2 mt-5 first:mt-0', className)}>
      <h2 className="section-title text-[17px] text-gray-900 dark:text-gray-100">{children}</h2>
      {aside != null && <span className="text-xs text-gray-600 dark:text-gray-400">{aside}</span>}
    </div>
  )
}

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'dark'
const TONES: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  dark: 'bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900',
}
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold leading-4', TONES[tone], className)}>{children}</span>
}

/** Große Kennzahl-Kachel (z. B. „Gebunden“, „Mögliche Auszahlung“). */
export function StatTile({ label, value, tone, className }: { label: string; value: ReactNode; tone?: 'green' | 'red'; className?: string }) {
  return (
    <Card className={cx('px-4 py-3', className)}>
      <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
      <div className={cx('font-display text-[26px] font-bold leading-tight tabular-nums', tone === 'green' ? 'text-green-700 dark:text-green-400' : tone === 'red' ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100')}>{value}</div>
    </Card>
  )
}

/** Zwei- bis dreiteiliger Umschalter (Offen / Abgeschlossen, Gesamt / Spieltag). Reine Links. */
export function SegmentedLinks({ items }: { items: Array<{ href: string; label: ReactNode; active: boolean }> }) {
  return (
    <div role="tablist" className="grid gap-1 rounded-2xl bg-gray-100 dark:bg-gray-800 p-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it, i) => (
        <Link key={i} href={it.href} role="tab" aria-selected={it.active} replace scroll={false}
          className={cx('text-center rounded-xl py-2.5 text-[15px] font-bold transition-colors',
            it.active ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400')}>
          {it.label}
        </Link>
      ))}
    </div>
  )
}

export function SegmentedButtons<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode }> }) {
  return (
    <div role="tablist" className="grid gap-1 rounded-2xl bg-gray-100 dark:bg-gray-800 p-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <button key={it.value} type="button" role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx('rounded-xl py-2.5 text-[15px] font-bold transition-colors',
            value === it.value ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400')}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

/** Horizontale Chip-Leiste (Filter). */
export function ChipBar<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode }>; className?: string }) {
  return (
    <div className={cx('flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 py-1', className)}>
      {items.map((it) => (
        <button key={it.value} type="button" aria-pressed={value === it.value} onClick={() => onChange(it.value)}
          className={cx('shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition-colors',
            value === it.value
              ? 'bg-slate-600 border-slate-600 text-white'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100')}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

/* ───────────── einheitliche Zustände: leer, Fehler, gesperrt, lädt ───────────── */

function StateShell({ icon, title, children, action, tone, plain }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode; tone?: 'amber' | 'red'; plain?: boolean }) {
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={cx('rounded-2xl border px-5 py-8 text-center',
      tone === 'amber' ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900'
        : tone === 'red' ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900'
        : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700')}>
      <div className={cx('mx-auto mb-3 flex items-center justify-center rounded-full', plain ? '' : 'h-12 w-12',
        plain ? '' : tone === 'amber' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
          : tone === 'red' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300')}>{icon}</div>
      <div className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</div>
      {children != null && <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">{children}</div>}
      {action != null && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)
export const Icons = {
  ticket: ico('M3 9a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v6a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2V9zM9 7v10'),
  lock: ico('M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5z'),
  alert: ico('M12 9v4m0 4h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'),
  clock: ico('M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'),
  search: ico('M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z'),
}

/** Wildi-Münze als freundliches Maskottchen für leere Zustände. */
export const WildiCoin = ({ size = 56 }: { size?: number }) => (
  <Image src="/wildi-coin.png" alt="" width={size} height={size} className="rounded-full" style={{ width: size, height: size }} />
)

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return <StateShell icon={icon ?? <WildiCoin size={56} />} title={title} action={action} plain>{children}</StateShell>
}
/** Gesperrt (z. B. Quoten/Märkte noch nicht offen oder bereits geschlossen). */
export function LockedState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <StateShell tone="amber" icon={Icons.lock} title={title} action={action}>{children}</StateShell>
}
export function ErrorState({ title = 'Das hat nicht geklappt', children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return <StateShell tone="red" icon={Icons.alert} title={title} action={action}>{children}</StateShell>
}

/** Kompakter Hinweis innerhalb einer Karte (z. B. „Quoten öffnen Montag 12:00“). */
export function InlineNotice({ children, tone = 'amber', icon }: { children: ReactNode; tone?: 'amber' | 'red' | 'neutral' | 'green'; icon?: ReactNode }) {
  const t = {
    amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
    red: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200',
    neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200',
    green: 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200',
  }[tone]
  return <div className={cx('flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium', t)}>{icon}<span>{children}</span></div>
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton', className)} />
}
/** Ladezustand einer Listenseite (Karten-Skelette). */
export function ListSkeleton({ rows = 3, tall }: { rows?: number; tall?: boolean }) {
  return (
    <div role="status" aria-label="Wird geladen" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i} className="p-4 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className={tall ? 'h-20' : 'h-12'} />
          <Skeleton className="h-9" />
        </Card>
      ))}
    </div>
  )
}

/* ───────────── Listenzeilen („Konto & App“) ───────────── */

export function RowIcon({ children }: { children: ReactNode }) {
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">{children}</span>
}

const rowCls = 'flex w-full items-center gap-3 px-4 py-3 text-left'
/** Zeile mit Icon, Titel, Untertitel und frei wählbarem rechten Teil (Chevron, Schalter, …). */
export function SettingsRow({ icon, title, sub, right, href, onClick, as }: {
  icon: ReactNode; title: string; sub?: string; right?: ReactNode; href?: string; onClick?: () => void; as?: 'div'
}) {
  const inner = (
    <>
      <RowIcon>{icon}</RowIcon>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold leading-tight text-gray-900 dark:text-gray-100">{title}</span>
        {sub && <span className="block truncate text-[13px] text-gray-600 dark:text-gray-400">{sub}</span>}
      </span>
      {right}
    </>
  )
  if (href) return <Link href={href} className={rowCls}>{inner}</Link>
  if (as === 'div') return <div className={rowCls}>{inner}</div>
  return <button type="button" onClick={onClick} className={rowCls}>{inner}</button>
}
export const Chevron = (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
)

/** Schalter (role=switch). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cx('relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-slate-600' : 'bg-gray-300 dark:bg-gray-600')}>
      <span className={cx('absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[21px]' : 'left-[3px]')} />
    </button>
  )
}

export const RowIcons = {
  help: ico('M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'),
  gear: ico('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
  moon: ico('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'),
  bell: ico('M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0'),
  edit: ico('M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z'),
  chart: ico('M4 20h16M7 16v-5M12 16V6M17 16v-8'),
  out: ico('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'),
}
