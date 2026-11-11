import { isSettled, modelProbability, type Slip } from '@/lib/recap/slips'

/**
 * Tipper-IQ V1.0 — „ein spielerischer Qualitätsindex, kein wissenschaftliches Maß".
 *
 * Reine Funktionen auf `Slip`s (lib/recap/slips.ts). Keine Datenbank, keine Zeitabhängigkeit:
 * dieselben Scheine liefern immer dieselben Zahlen (reproduzierbar), und für Rückrunde/Saison/
 * Monat genügt es, andere Scheine hineinzugeben (`filterSlipsByMatchdays`/`asOfMs` in buildSlips).
 *
 * ── Grundidee ────────────────────────────────────────────────────────────────────────────
 * Jeder Wettschein i hat eine Trefferwahrscheinlichkeit p_i. In V1.0 ist das das rohe 1/Quote
 * (Entscheidung des Betreibers, nachvollziehbar). Das ist ein bewusster Kompromiss: 1/Quote
 * enthält die Hausmarge (12 %, Torschützen 15 %) und ist deshalb im Schnitt etwas zu hoch
 * (Kombis: Marge multipliziert sich je Leg) – ein Tipper bekommt also etwas WENIGER Erwartung
 * gutgeschrieben, als ein margenbereinigtes Modell es täte. Die Alternativrechnung
 * `probability: 'marginAdjusted'` ist als Plausibilisierung eingebaut, ersetzt die offizielle
 * Punktzahl aber nicht.
 *
 * Aus den p_i entsteht gegen den Zufall gemessen ein z-Wert. Er wird NICHT als (Treffer −
 * Erwartung)/Streuung genähert – diese Normalnäherung überschätzt seltene Ereignisse stark (zwei
 * Treffer bei 0,36 erwarteten wären z = 2,8, die exakte Zufallswahrscheinlichkeit entspricht
 * aber nur z ≈ 1,5). Stattdessen: exakte Verteilung der gewichteten Trefferzahl (Poisson-Binomial,
 * Gitter 0,02), Mid-p-Wert, zurückgerechnet auf die Normalskala (`exactZ`). Das schützt kleine
 * Stichproben und seltene Außenseitertreffer ohne frei gewählte Schrumpfkonstante; zusätzlich
 * greifen die Mindestgrenzen. Abgebildet wird z auf 0–100 mit `100 · Φ(z / 2)`: 50 = genau so
 * viel getroffen, wie die Quoten erwarten lassen.
 *
 * ── Vier Bausteine ───────────────────────────────────────────────────────────────────────
 *  45 %  Quotenbereinigte Trefferqualität: z aus Σ w_i·(Treffer_i − p_i).
 *  20 %  Konstanz: an wie vielen aktiven Spieltagen erreichte der Tipper mindestens seine
 *        Spieltags-Erwartung? Gemessen gegen die exakte Wahrscheinlichkeit dafür (Poisson-
 *        Binomial) – nicht gegen eine feste Quote, sonst würde viel Tippen belohnt.
 *  20 %  Schwierige Treffer: pro Spieltag „mindestens ein Gewinnschein mit Quote ≥ 3,00"
 *        (und ≥ 5,00) gegen die Wahrscheinlichkeit, dass das zufällig passiert. Zählt je
 *        Spieltag nur einmal („an verschiedenen Spieltagen").
 *  15 %  Robustheit: dieselbe Trefferqualität OHNE den besten Spieltag.
 *
 * ── Überschneidungen (anteilige Gewichtung) ─────────────────────────────────────────────
 * Identisches Ereignis = gleiches Spiel + gleicher Markt + gleiche Auswahl. Taucht es bei einem
 * Tipper in k Scheinen auf, trägt jedes Auftreten 1/k Informationsgewicht. Ein Schein mit
 * mehreren Legs bekommt den Mittelwert der Leg-Gewichte: dreimal derselbe Ergebnistipp zählt
 * zusammen wie ein unabhängiger Tipp; eine Kombi A+B neben der Einzelwette A zählt 0,75 + 0,5.
 * Verschiedene Märkte auf dasselbe Spiel gelten NICHT als identisch (nur korreliert) und werden
 * nicht abgewertet; `correlatedSameMatchPairs` weist sie als Hinweis aus.
 * Die Gewichte gehen als Schrittweite in die exakte Verteilung ein (Treffer zählt w statt 1).
 */

export const IQ_VERSION = '1.0'
export const IQ_MIN_SLIPS = 18
export const IQ_MIN_MATCHDAYS = 10
export const IQ_DIFFICULT_ODDS = [3, 5] as const

export interface IqWeights { hit: number; consistency: number; difficult: number; robust: number }
export const IQ_WEIGHTS_DEFAULT: IqWeights = { hit: 0.45, consistency: 0.2, difficult: 0.2, robust: 0.15 }

/** Vier Alternativgewichtungen für den Stabilitätstest (nie als offizielle Punktzahl gedacht). */
export const IQ_ALT_WEIGHTS: Record<string, IqWeights> = {
  'gleichverteilt (25/25/25/25)': { hit: 0.25, consistency: 0.25, difficult: 0.25, robust: 0.25 },
  'trefferlastig (60/15/15/10)': { hit: 0.6, consistency: 0.15, difficult: 0.15, robust: 0.1 },
  'ohne schwierige Treffer (55/25/0/20)': { hit: 0.55, consistency: 0.25, difficult: 0, robust: 0.2 },
  'robustheitslastig (35/15/15/35)': { hit: 0.35, consistency: 0.15, difficult: 0.15, robust: 0.35 },
}

export interface IqOptions {
  weights?: IqWeights
  /** 'raw' = 1/Quote (offiziell V1.0). 'marginAdjusted' = Alternativrechnung zur Plausibilisierung. */
  probability?: 'raw' | 'marginAdjusted'
  /** 'weighted' = anteilige Gewichtung (offiziell). 'none' = jeder Schein zählt voll (Vergleich). */
  overlap?: 'weighted' | 'none'
  minSlips?: number
  minMatchdays?: number
  /** Spieltag aus der Rechnung nehmen (Leave-one-out-Test). */
  excludeMatchday?: number
  /** Kombis mit teilweise neutralisierten Legs ausschließen (Sensitivität, Standard: einbeziehen). */
  excludePartiallyNeutralized?: boolean
}

export interface IqComponents { hit: number; consistency: number; difficult: number; robust: number }
export interface IqZ { hit: number; consistency: number; difficult3: number; difficult5: number; robust: number }

export interface TipperIqResult {
  userId: string
  iq: number
  components: IqComponents
  z: IqZ
  /** Echte (ungewichtete) Zahl der gewerteten, abgerechneten Scheine – Basis der Mindestgrenze. */
  slipsConsidered: number
  /** Σ w_i: wie viele UNABHÄNGIGE Scheine nach der Überschneidungs-Gewichtung übrig bleiben. */
  effectiveSlips: number
  activeMatchdays: number
  wonSlips: number
  /** Σ p_i über alle gewerteten Scheine (ungewichtet) – das, was „1/Quote" erwarten lässt. */
  expectedHits: number
  weightedHits: number
  weightedExpectedHits: number
  difficult3WonSlips: number
  difficult3Matchdays: number
  difficult5WonSlips: number
  difficult5Matchdays: number
  consistentMatchdays: number
  profitableMatchdays: number
  bestMatchday: number | null
  /** Anzahl Scheine mit einem Ereignis, das bei diesem Tipper mehrfach vorkommt. */
  overlappingSlips: number
  /** Paare von Scheinen mit verschiedenen Märkten auf demselben Spiel (Hinweis auf Korrelation). */
  correlatedSameMatchPairs: number
  eligible: boolean
  /** Warum noch nicht gewertet (null, wenn eligible). */
  notRatedReason: string | null
  /** Offizieller Ranglistenplatz, nur für eligible. */
  rank: number | null
}

const SQRT2 = Math.SQRT2
/** Standardnormal-CDF (Abramowitz/Stegun 7.1.26 über erf, Fehler < 1,5e-7). */
export function normalCdf(x: number): number {
  const z = x / SQRT2
  const sign = z < 0 ? -1 : 1
  const a = Math.abs(z)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return 0.5 * (1 + sign * y)
}
export const scoreFromZ = (z: number): number => 100 * normalCdf(z / 2)

/** Gewertet wird: abgerechnet (won/lost), kein Bonus-Tipp, kein mehrspieliges Spieltags-Special,
 *  Spieltag bekannt. Stornierte/offene/neutralisierte Scheine fallen über den Status heraus. */
export function isIqEligibleSlip(s: Slip, opts: Pick<IqOptions, 'excludePartiallyNeutralized'> = {}): boolean {
  if (!isSettled(s)) return false
  if (s.isBonus) return false
  if (s.ownerMatchday == null) return false
  if (s.legs.some((l) => l.marketType === 'matchday_special')) return false
  const active = s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void')
  if (active.length === 0) return false
  if (opts.excludePartiallyNeutralized && active.length !== s.legs.length) return false
  return true
}

export function filterSlipsByMatchdays(slips: Slip[], from: number, to: number): Slip[] {
  return slips.filter((s) => s.ownerMatchday != null && s.ownerMatchday >= from && s.ownerMatchday <= to)
}

const eventKey = (l: Slip['legs'][number]) => `${l.matchId ?? 'x'}|${l.marketType}|${l.selection}`

/** Anteil „neuer Information" je Schein: Mittel über die aktiven Legs von 1/k (k = Auftreten desselben
 *  Ereignisses in den gewerteten Scheinen DES TIPPERS). */
export function computeOverlapWeights(userSlips: Slip[]): Map<string, number> {
  const count = new Map<string, number>()
  for (const s of userSlips) {
    for (const k of new Set(s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void').map(eventKey))) {
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  const out = new Map<string, number>()
  for (const s of userSlips) {
    const keys = [...new Set(s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void').map(eventKey))]
    out.set(s.key, keys.length === 0 ? 0 : keys.reduce((a, k) => a + 1 / (count.get(k) ?? 1), 0) / keys.length)
  }
  return out
}

/** Exakte Wahrscheinlichkeit P(Σ w_i·X_i ≥ target) für unabhängige X_i ~ Bernoulli(p_i). */
export function probSumAtLeast(items: { w: number; p: number }[], target: number): number {
  let dist = new Map<number, number>([[0, 1]])
  for (const { w, p } of items) {
    const next = new Map<number, number>()
    for (const [sum, pr] of dist) {
      const lo = Math.round(sum * 1e9) / 1e9
      next.set(lo, (next.get(lo) ?? 0) + pr * (1 - p))
      const hi = Math.round((sum + w) * 1e9) / 1e9
      next.set(hi, (next.get(hi) ?? 0) + pr * p)
    }
    dist = next
  }
  let q = 0
  for (const [sum, pr] of dist) if (sum >= target - 1e-9) q += pr
  return q
}


/** Inverse Standardnormal-CDF (Acklam, rel. Fehler < 1,2e-9). */
export function normalInv(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
  const lo = 0.02425
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  const q = p - 0.5, r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

const GRID = 0.02
/**
 * Exakter z-Wert: Verteilung von S = Σ w_i·X_i (X_i ~ Bernoulli(p_i), unabhängig) auf einem Gitter
 * der Weite 0,02; Mid-p-Wert P(S > obs) + ½·P(S = obs); z = Φ⁻¹(1 − midp). Positiv = mehr
 * getroffen als erwartet. Ohne Streuung (keine Scheine / alle p ∈ {0,1}) → 0.
 */
export function exactZ(items: { w: number; p: number }[], observed: number): number {
  const live = items.filter((it) => it.w > 1e-9 && it.p > 1e-9 && it.p < 1 - 1e-9)
  if (live.length === 0) return 0
  const steps = live.map((it) => Math.max(1, Math.round(it.w / GRID)))
  const total = steps.reduce((a, b) => a + b, 0)
  let dist = new Float64Array(total + 1)
  dist[0] = 1
  let reach = 0
  live.forEach((it, i) => {
    const st = steps[i]
    const next = new Float64Array(total + 1)
    for (let k = 0; k <= reach; k++) {
      const pr = dist[k]
      if (pr === 0) continue
      next[k] += pr * (1 - it.p)
      next[k + st] += pr * it.p
    }
    reach += st
    dist = next
  })
  const obsIdx = Math.max(0, Math.min(total, Math.round(observed / GRID)))
  let above = 0
  for (let k = obsIdx + 1; k <= total; k++) above += dist[k]
  const midp = Math.min(1 - 1e-7, Math.max(1e-7, above + 0.5 * dist[obsIdx]))
  return normalInv(1 - midp)
}

interface Item { slip: Slip; w: number; p: number; hit: number; md: number }

function hitZ(items: Item[]): { z: number; w: number; e: number } {
  let w = 0, e = 0
  for (const it of items) { w += it.w * it.hit; e += it.w * it.p }
  return { z: exactZ(items.map((it) => ({ w: it.w, p: it.p })), w), w, e }
}

function groupByMd(items: Item[]): Map<number, Item[]> {
  const m = new Map<number, Item[]>()
  for (const it of items) { const a = m.get(it.md); if (a) a.push(it); else m.set(it.md, [it]) }
  return m
}

export function computeUserIq(userId: string, userSlipsAll: Slip[], options: IqOptions = {}): TipperIqResult {
  const weights = options.weights ?? IQ_WEIGHTS_DEFAULT
  const minSlips = options.minSlips ?? IQ_MIN_SLIPS
  const minMds = options.minMatchdays ?? IQ_MIN_MATCHDAYS
  const slips = userSlipsAll.filter((s) =>
    isIqEligibleSlip(s, options) && (options.excludeMatchday == null || s.ownerMatchday !== options.excludeMatchday))
  const ow = options.overlap === 'none' ? null : computeOverlapWeights(slips)
  const items: Item[] = slips.map((s) => ({
    slip: s,
    w: ow ? (ow.get(s.key) ?? 1) : 1,
    p: options.probability === 'marginAdjusted' ? modelProbability(s) : Math.min(1 / s.odds, 0.995),
    hit: s.status === 'won' ? 1 : 0,
    md: s.ownerMatchday as number,
  }))
  const byMd = groupByMd(items)
  const activeMds = byMd.size

  const main = hitZ(items)

  // Konstanz
  const cItems: { w: number; p: number }[] = []
  let cObs = 0, consistent = 0
  for (const arr of byMd.values()) {
    const e = arr.reduce((a, it) => a + it.w * it.p, 0)
    const h = arr.reduce((a, it) => a + it.w * it.hit, 0)
    const q = probSumAtLeast(arr.map((it) => ({ w: it.w, p: it.p })), e)
    const ok = h >= e - 1e-9
    if (ok) consistent++
    cObs += ok ? 1 : 0; cItems.push({ w: 1, p: q })
  }
  const zConsistency = exactZ(cItems, cObs)

  // Schwierige Treffer (je Schwelle: Spieltage mit ≥ 1 Gewinnschein)
  const difficult: Record<number, { z: number; mds: number; slips: number }> = {}
  for (const T of IQ_DIFFICULT_ODDS) {
    let obs = 0, wonSlips = 0
    const dItems: { w: number; p: number }[] = []
    for (const arr of byMd.values()) {
      const pool = arr.filter((it) => it.slip.odds >= T)
      if (pool.length === 0) continue
      // Doppelte Ereignisse wirken wie ein Schein: (1−p)^w statt (1−p).
      const q = 1 - pool.reduce((a, it) => a * Math.pow(1 - it.p, it.w), 1)
      const won = pool.filter((it) => it.hit)
      wonSlips += won.length
      obs += won.length > 0 ? 1 : 0; dItems.push({ w: 1, p: q })
    }
    difficult[T] = { z: exactZ(dItems, obs), mds: obs, slips: wonSlips }
  }
  const zDifficult = (difficult[3].z + difficult[5].z) / 2

  // Robustheit: ohne den Spieltag mit dem größten Überschuss (Treffer − Erwartung)
  let bestMd: number | null = null, bestDelta = -Infinity
  for (const [md, arr] of [...byMd.entries()].sort((a, b) => a[0] - b[0])) {
    const d = arr.reduce((a, it) => a + it.w * (it.hit - it.p), 0)
    if (d > bestDelta + 1e-12) { bestDelta = d; bestMd = md }
  }
  const zRobust = byMd.size > 1 ? hitZ(items.filter((it) => it.md !== bestMd)).z : 0

  const components: IqComponents = {
    hit: scoreFromZ(main.z), consistency: scoreFromZ(zConsistency),
    difficult: scoreFromZ(zDifficult), robust: scoreFromZ(zRobust),
  }
  const wsum = weights.hit + weights.consistency + weights.difficult + weights.robust
  const iq = Math.max(0, Math.min(100,
    (components.hit * weights.hit + components.consistency * weights.consistency
      + components.difficult * weights.difficult + components.robust * weights.robust) / (wsum || 1)))

  // Diagnostik
  const perMdNet = new Map<number, number>()
  for (const it of items) perMdNet.set(it.md, (perMdNet.get(it.md) ?? 0) + it.slip.net)
  const eventSlipCount = new Map<string, number>()
  for (const s of slips) for (const k of new Set(s.legs.filter((l) => l.status !== 'neutralized').map(eventKey))) eventSlipCount.set(k, (eventSlipCount.get(k) ?? 0) + 1)
  const overlappingSlips = slips.filter((s) => s.legs.some((l) => (eventSlipCount.get(eventKey(l)) ?? 0) > 1)).length
  let correlated = 0
  const byMatch = new Map<number, Set<string>>() // matchId -> slip keys
  for (const s of slips) for (const id of new Set(s.legs.map((l) => l.matchId).filter((x): x is number => x != null))) {
    const set = byMatch.get(id); if (set) set.add(s.key); else byMatch.set(id, new Set([s.key]))
  }
  const slipByKey = new Map(slips.map((s) => [s.key, s]))
  for (const [id, keys] of byMatch) {
    const arr = [...keys]
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = slipByKey.get(arr[i])!.legs.filter((l) => l.matchId === id).map(eventKey)
      const b = slipByKey.get(arr[j])!.legs.filter((l) => l.matchId === id).map(eventKey)
      if (!a.some((k) => b.includes(k))) correlated++
    }
  }

  let reason: string | null = null
  if (slips.length < minSlips) reason = `Noch nicht für die offizielle Rangliste qualifiziert: erst ${slips.length} von ${minSlips} nötigen abgerechneten Wettscheinen`
  else if (activeMds < minMds) reason = `Noch nicht für die offizielle Rangliste qualifiziert: erst ${activeMds} von ${minMds} nötigen aktiven Spieltagen`

  return {
    userId, iq, components,
    z: { hit: main.z, consistency: zConsistency, difficult3: difficult[3].z, difficult5: difficult[5].z, robust: zRobust },
    slipsConsidered: slips.length,
    effectiveSlips: items.reduce((a, it) => a + it.w, 0),
    activeMatchdays: activeMds,
    wonSlips: items.filter((it) => it.hit).length,
    expectedHits: items.reduce((a, it) => a + it.p, 0),
    weightedHits: main.w, weightedExpectedHits: main.e,
    difficult3WonSlips: difficult[3].slips, difficult3Matchdays: difficult[3].mds,
    difficult5WonSlips: difficult[5].slips, difficult5Matchdays: difficult[5].mds,
    consistentMatchdays: consistent,
    profitableMatchdays: [...perMdNet.values()].filter((v) => v > 0).length,
    bestMatchday: bestMd,
    overlappingSlips, correlatedSameMatchPairs: correlated,
    eligible: reason == null, notRatedReason: reason, rank: null,
  }
}

/** Tipper-IQ für alle Tipper; Ranglistenplätze nur für Wertbare (≥ Mindestgrenzen). */
export function computeTipperIqRanking(slips: Slip[], options: IqOptions = {}): TipperIqResult[] {
  const byUser = new Map<string, Slip[]>()
  for (const s of slips) { const a = byUser.get(s.userId); if (a) a.push(s); else byUser.set(s.userId, [s]) }
  const results = [...byUser.entries()]
    .map(([u, arr]) => computeUserIq(u, arr, options))
    .filter((r) => r.slipsConsidered > 0)
  const rated = results.filter((r) => r.eligible)
    .sort((a, b) => b.iq - a.iq || b.z.hit - a.z.hit || a.userId.localeCompare(b.userId))
  rated.forEach((r, i) => { r.rank = i + 1 })
  const unrated = results.filter((r) => !r.eligible).sort((a, b) => b.iq - a.iq)
  return [...rated, ...unrated]
}

const de1 = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Leicht verständliche Begründung („Warum dieser IQ?"). Nennt nur belegte Zahlen. */
export function explainIq(r: TipperIqResult): string[] {
  const lines: string[] = []
  const diff = r.wonSlips - r.expectedHits
  lines.push(`${r.wonSlips} von ${r.slipsConsidered} Scheinen gewonnen – die Quoten ließen etwa ${de1(r.expectedHits)} Treffer erwarten (${diff >= 0 ? '+' : '−'}${de1(Math.abs(diff))}).`)
  lines.push(`An ${r.consistentMatchdays} von ${r.activeMatchdays} Spieltagen mindestens so viel getroffen wie erwartet.`)
  if (r.difficult3WonSlips > 0) lines.push(`${r.difficult3WonSlips} Gewinnscheine mit Quote ≥ 3,00 an ${r.difficult3Matchdays} verschiedenen Spieltagen${r.difficult5WonSlips > 0 ? `, davon ${r.difficult5WonSlips} mit Quote ≥ 5,00` : ''}.`)
  else lines.push('Noch kein Gewinnschein mit Quote ≥ 3,00.')
  lines.push(r.z.robust >= r.z.hit - 0.75
    ? `Auch ohne den besten Spieltag${r.bestMatchday != null ? ` (Spieltag ${r.bestMatchday})` : ''} bleibt die Trefferquote stark – kein Ausreißer-Ergebnis.`
    : `Ohne den besten Spieltag${r.bestMatchday != null ? ` (Spieltag ${r.bestMatchday})` : ''} sinkt die Trefferqualität deutlich.`)
  if (r.overlappingSlips > 0) lines.push(`${r.overlappingSlips} Scheine enthalten dieselben Tipps mehrfach und zählen deshalb nur anteilig.`)
  return lines
}

export interface IqVariant { name: string; ranking: TipperIqResult[] }

/** Sensitivitätsanalyse für die Qualitätssicherung (ändert nie die offizielle Punktzahl). */
export function computeIqSensitivity(slips: Slip[], matchdays: number[]): IqVariant[] {
  const v: IqVariant[] = [
    { name: 'offiziell V1.0', ranking: computeTipperIqRanking(slips) },
    { name: 'ohne Überschneidungs-Gewichtung', ranking: computeTipperIqRanking(slips, { overlap: 'none' }) },
    { name: 'margenbereinigte Wahrscheinlichkeit', ranking: computeTipperIqRanking(slips, { probability: 'marginAdjusted' }) },
    { name: 'ohne teil-neutralisierte Kombis', ranking: computeTipperIqRanking(slips, { excludePartiallyNeutralized: true }) },
  ]
  for (const [name, weights] of Object.entries(IQ_ALT_WEIGHTS)) v.push({ name: `Gewichtung ${name}`, ranking: computeTipperIqRanking(slips, { weights }) })
  for (const md of matchdays) v.push({ name: `ohne Spieltag ${md}`, ranking: computeTipperIqRanking(slips, { excludeMatchday: md, minMatchdays: IQ_MIN_MATCHDAYS - 1 }) })
  return v
}
